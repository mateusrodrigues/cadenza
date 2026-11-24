import { ProviderError } from '@cadenza/providers';
import type { Paragraph, Suggestion } from '@cadenza/shared';
import type { CheckOutcome } from './check.js';
import { hash } from './paragraphs.js';

/** A suggestion with offsets relative to the start of its paragraph. */
export type CachedSuggestion = Omit<Suggestion, 'id' | 'pid'>;
type Relative = CachedSuggestion;

/**
 * A second cache level that outlives the scheduler, e.g. the extension's session storage, so
 * results survive the browser suspending an idle service worker.
 */
export interface CacheStore {
  load(keys: string[]): Promise<Map<string, CachedSuggestion[]>>;
  save(entries: [string, CachedSuggestion[]][]): Promise<void>;
}

/** Runs one model call for a batch of paragraphs (with `start` set to 0). */
export type BatchRunner = (paragraphs: Paragraph[], signal: AbortSignal) => Promise<CheckOutcome>;

export interface ScheduleRequest {
  /** Who is asking, e.g. a tab/frame/field key. A newer request replaces the older one. */
  requester: string;
  /** Everything that affects results besides the text: provider, model, settings, prompt. */
  configKey: string;
  paragraphs: Paragraph[];
  run: BatchRunner;
  /** Most uncached paragraphs to send in one call. Default: all of them. */
  maxNew?: number;
  /** Paragraph ids to send first (e.g. the paragraph with the caret). */
  priority?: string[];
}

export interface ScheduleResult {
  suggestions: Suggestion[];
  /** Paragraphs left unchecked because of `maxNew`; ask again to continue. */
  pending: number;
  /** Outcome of the model call this request started, if any. */
  outcome: CheckOutcome | null;
}

interface Batch {
  keys: Set<string>;
  controller: AbortController;
  promise: Promise<Map<string, Relative[]>>;
  wanters: Set<string>;
}

/**
 * Per-paragraph result cache plus in-flight de-duplication.
 *
 * - Results are cached by paragraph text and config, so only new or edited paragraphs are
 *   sent to the model.
 * - A paragraph already being checked (for any requester) is awaited, not re-sent.
 * - An in-flight call is aborted only when no requester still needs any of its paragraphs,
 *   so a slow local model can finish a paragraph while the user keeps typing elsewhere.
 */
export class CheckScheduler {
  private readonly cache = new Map<string, Relative[]>();
  private readonly inflight = new Map<string, Batch>();
  private readonly byRequester = new Map<string, Set<Batch>>();

  constructor(
    private readonly maxCacheEntries = 2000,
    private readonly store?: CacheStore,
  ) {}

  async check(req: ScheduleRequest): Promise<ScheduleResult> {
    const keyOf = (p: Paragraph) => `${req.configKey}|${hash(p.text)}|${p.text.length}`;
    const wanted = new Set(req.paragraphs.map(keyOf));
    this.release(req.requester, wanted);
    await this.loadStored(req.paragraphs.map(keyOf));

    const joined = new Set<Batch>();
    const toSend: Paragraph[] = [];
    const sendKeys = new Set<string>();
    for (const p of req.paragraphs) {
      const key = keyOf(p);
      if (this.cache.has(key) || sendKeys.has(key)) continue;
      const batch = this.inflight.get(key);
      if (batch) {
        joined.add(batch);
      } else {
        toSend.push(p);
        sendKeys.add(key);
      }
    }

    const priority = new Set(req.priority ?? []);
    toSend.sort((a, b) => Number(priority.has(b.pid)) - Number(priority.has(a.pid)));
    const sending = toSend.slice(0, req.maxNew ?? toSend.length);
    const pending = toSend.length - sending.length;

    let outcome: CheckOutcome | null = null;
    if (sending.length > 0) {
      joined.add(
        this.startBatch(sending, keyOf, req, (o) => {
          outcome = o;
        }),
      );
    }
    for (const batch of joined) {
      batch.wanters.add(req.requester);
      this.trackRequester(req.requester, batch);
    }

    const results = await Promise.allSettled([...joined].map((b) => b.promise));
    const failure = results.find((r) => r.status === 'rejected');
    if (failure) throw (failure as PromiseRejectedResult).reason;

    const suggestions: Suggestion[] = [];
    for (const p of req.paragraphs) {
      const rel = this.cache.get(keyOf(p));
      if (!rel) continue;
      this.touch(keyOf(p), rel);
      for (const s of rel) {
        const start = p.start + s.start;
        const end = p.start + s.end;
        suggestions.push({
          ...s,
          pid: p.pid,
          start,
          end,
          id: `${p.pid}:${start}:${end}:${hash(s.replacement)}`,
        });
      }
    }
    return { suggestions, pending, outcome };
  }

  /** Forget a requester entirely (e.g. its field was removed). */
  forget(requester: string): void {
    this.release(requester, new Set());
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async loadStored(keys: string[]) {
    if (!this.store) return;
    const missing = keys.filter((k) => !this.cache.has(k) && !this.inflight.has(k));
    if (missing.length === 0) return;
    try {
      for (const [key, rel] of await this.store.load(missing)) this.touch(key, rel);
    } catch {
      // The store is only an optimization.
    }
  }

  private startBatch(
    paragraphs: Paragraph[],
    keyOf: (p: Paragraph) => string,
    req: ScheduleRequest,
    onOutcome: (o: CheckOutcome) => void,
  ): Batch {
    const controller = new AbortController();
    const keys = new Set(paragraphs.map(keyOf));
    // Lay the paragraphs out end to end so suggestions in different paragraphs never look like
    // they overlap; results are cached relative to their paragraph.
    let offset = 0;
    const local = paragraphs.map((p) => {
      const placed = { ...p, start: offset };
      offset += p.text.length + 1;
      return placed;
    });
    const startOf = new Map(local.map((p) => [p.pid, p.start]));
    const batch: Batch = {
      keys,
      controller,
      wanters: new Set(),
      promise: req.run(local, controller.signal).then(
        (outcome) => {
          onOutcome(outcome);
          const byPid = new Map<string, Relative[]>(local.map((p) => [p.pid, []]));
          for (const { id: _id, pid, ...abs } of outcome.suggestions) {
            const base = startOf.get(pid) ?? 0;
            byPid.get(pid)?.push({ ...abs, start: abs.start - base, end: abs.end - base });
          }
          const out = new Map<string, Relative[]>();
          for (const p of local) {
            const rel = byPid.get(p.pid) ?? [];
            const key = keyOf(p);
            out.set(key, rel);
            this.touch(key, rel);
          }
          this.store?.save([...out]).catch(() => {});
          this.finish(batch);
          return out;
        },
        (err: unknown) => {
          this.finish(batch);
          throw err;
        },
      ),
    };
    for (const key of keys) this.inflight.set(key, batch);
    return batch;
  }

  private finish(batch: Batch): void {
    for (const key of batch.keys) {
      if (this.inflight.get(key) === batch) this.inflight.delete(key);
    }
    for (const r of batch.wanters) this.byRequester.get(r)?.delete(batch);
  }

  private release(requester: string, wanted: Set<string>): void {
    const batches = this.byRequester.get(requester);
    if (!batches) return;
    for (const batch of [...batches]) {
      if ([...batch.keys].some((k) => wanted.has(k))) continue;
      batches.delete(batch);
      batch.wanters.delete(requester);
      if (batch.wanters.size === 0) {
        batch.controller.abort(new ProviderError('cancelled', 'No longer needed'));
      }
    }
    if (batches.size === 0) this.byRequester.delete(requester);
  }

  private trackRequester(requester: string, batch: Batch): void {
    let set = this.byRequester.get(requester);
    if (!set) {
      set = new Set();
      this.byRequester.set(requester, set);
    }
    set.add(batch);
  }

  /** Insert or refresh an entry, evicting the least recently used beyond the limit. */
  private touch(key: string, value: Relative[]): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
