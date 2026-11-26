import { ProviderError } from '@cadenza/providers';
import type { Paragraph } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import type { CheckOutcome } from './check.js';
import { splitParagraphs } from './paragraphs.js';
import {
  type BatchRunner,
  type CachedSuggestion,
  type CacheStore,
  CheckScheduler,
} from './scheduler.js';

/** A runner that flags every "teh" and records what it was asked to check. */
function makeRunner() {
  const calls: string[][] = [];
  const gates: (() => void)[] = [];
  let gated = false;
  const runner: BatchRunner = async (paragraphs, signal) => {
    calls.push(paragraphs.map((p) => p.text));
    if (gated) {
      await new Promise<void>((resolve, reject) => {
        gates.push(resolve);
        signal.addEventListener('abort', () => reject(new ProviderError('cancelled', 'x')));
      });
    }
    return outcomeFor(paragraphs);
  };
  return {
    runner,
    calls,
    gate() {
      gated = true;
    },
    openAll() {
      for (const g of gates.splice(0)) g();
    },
  };
}

function outcomeFor(paragraphs: Paragraph[]): CheckOutcome {
  const suggestions = paragraphs.flatMap((p) => {
    const i = p.text.indexOf('teh');
    if (i === -1) return [];
    return [
      {
        id: 'x',
        pid: p.pid,
        start: p.start + i,
        end: p.start + i + 3,
        original: 'teh',
        replacement: 'the',
        category: 'correctness' as const,
        subtype: null,
        explanation: null,
      },
    ];
  });
  return {
    suggestions,
    tier: 'json_schema',
    usage: null,
    dropped: 0,
    items: [],
    reasoned: false,
    thinkingFellBack: false,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('CheckScheduler', () => {
  it('sends only uncached paragraphs and rebases cached results to new offsets', async () => {
    const s = new CheckScheduler();
    const { runner, calls } = makeRunner();
    const base = { requester: 'f1', configKey: 'c', run: runner };

    const first = await s.check({ ...base, paragraphs: splitParagraphs('Read teh book.\nOk.') });
    expect(first.suggestions.map((x) => [x.start, x.end])).toEqual([[5, 8]]);

    const text = 'New first line.\nRead teh book.\nOk.';
    const second = await s.check({ ...base, paragraphs: splitParagraphs(text) });
    expect(calls).toEqual([['Read teh book.', 'Ok.'], ['New first line.']]);
    expect(second.suggestions.map((x) => text.slice(x.start, x.end))).toEqual(['teh']);
  });

  it('caches per config: a different model or setting re-checks', async () => {
    const s = new CheckScheduler();
    const { runner, calls } = makeRunner();
    const paragraphs = splitParagraphs('Same text.');
    await s.check({ requester: 'f', configKey: 'a', paragraphs, run: runner });
    await s.check({ requester: 'f', configKey: 'b', paragraphs, run: runner });
    expect(calls).toHaveLength(2);
  });

  it('limits new paragraphs per call, priority first, and reports what is pending', async () => {
    const s = new CheckScheduler();
    const { runner, calls } = makeRunner();
    const paragraphs = splitParagraphs('One.\nTwo.\nThree.');
    const req = {
      requester: 'f',
      configKey: 'c',
      paragraphs,
      run: runner,
      maxNew: 1,
      priority: [paragraphs[2]?.pid ?? ''],
    };
    expect((await s.check(req)).pending).toBe(2);
    expect((await s.check(req)).pending).toBe(1);
    expect((await s.check(req)).pending).toBe(0);
    expect(calls).toEqual([['Three.'], ['One.'], ['Two.']]);
  });

  it('keeps an in-flight call running while the requester still needs one of its paragraphs', async () => {
    const s = new CheckScheduler();
    const r = makeRunner();
    r.gate();
    const first = s.check({
      requester: 'f',
      configKey: 'c',
      paragraphs: splitParagraphs('Fix teh first.'),
      run: r.runner,
    });
    await tick();
    // The user edits a different paragraph; the first one is unchanged.
    const second = s.check({
      requester: 'f',
      configKey: 'c',
      paragraphs: splitParagraphs('Fix teh first.\nAnd a second.'),
      run: r.runner,
    });
    await tick();
    r.openAll();
    await expect(first).resolves.toBeDefined();
    const result = await second;
    expect(r.calls).toEqual([['Fix teh first.'], ['And a second.']]);
    expect(result.suggestions).toHaveLength(1);
  });

  it('aborts an in-flight call nobody needs any more', async () => {
    const s = new CheckScheduler();
    const r = makeRunner();
    r.gate();
    const stale = s.check({
      requester: 'f',
      configKey: 'c',
      paragraphs: splitParagraphs('Old text.'),
      run: r.runner,
    });
    await tick();
    const fresh = s.check({
      requester: 'f',
      configKey: 'c',
      paragraphs: splitParagraphs('Completely new text.'),
      run: r.runner,
    });
    await expect(stale).rejects.toMatchObject({ kind: 'cancelled' });
    await tick();
    r.openAll();
    await expect(fresh).resolves.toMatchObject({ pending: 0 });
  });

  it('shares an in-flight paragraph between requesters instead of sending it twice', async () => {
    const s = new CheckScheduler();
    const r = makeRunner();
    r.gate();
    const paragraphs = splitParagraphs('Shared teh text.');
    const a = s.check({ requester: 'a', configKey: 'c', paragraphs, run: r.runner });
    await tick();
    const b = s.check({ requester: 'b', configKey: 'c', paragraphs, run: r.runner });
    await tick();
    r.openAll();
    await Promise.all([a, b]);
    expect(r.calls).toHaveLength(1);
  });

  it('does not cache failures', async () => {
    const s = new CheckScheduler();
    let fail = true;
    const run: BatchRunner = async (paragraphs) => {
      if (fail) throw new ProviderError('rate_limited', 'slow down');
      return outcomeFor(paragraphs);
    };
    const req = { requester: 'f', configKey: 'c', paragraphs: splitParagraphs('Teh.'), run };
    await expect(s.check(req)).rejects.toMatchObject({ kind: 'rate_limited' });
    fail = false;
    await expect(s.check(req)).resolves.toMatchObject({ pending: 0 });
  });
});

describe('CheckScheduler with the real pipeline', () => {
  it('keeps suggestions from every paragraph of a batch', async () => {
    const { createProvider } = await import('@cadenza/providers');
    const { checkParagraphs } = await import('./check.js');
    const provider = createProvider({
      presetId: 'mock',
      kind: 'mock',
      baseURL: '',
      apiKey: null,
      model: 'mock-rules',
    });
    const scheduler = new CheckScheduler();
    const text = 'Their going to the store tomorow.\nThis is very unique.';
    const { suggestions } = await scheduler.check({
      requester: 'r',
      configKey: 'k',
      paragraphs: splitParagraphs(text),
      run: (paragraphs, signal) =>
        checkParagraphs({
          provider,
          model: 'mock-rules',
          paragraphs,
          settings: {
            dialect: 'en-US',
            categories: ['correctness', 'clarity', 'style'],
            explanations: false,
          },
          signal,
        }),
    });
    expect(suggestions.map((s) => text.slice(s.start, s.end))).toEqual([
      'Their going',
      'tomorow',
      'very unique',
    ]);
  });
});

describe('CheckScheduler with a persistent store', () => {
  it('reuses results from the store instead of calling the model again', async () => {
    const saved = new Map<string, CachedSuggestion[]>();
    const store: CacheStore = {
      load: async (keys) =>
        new Map(keys.flatMap((k) => (saved.has(k) ? [[k, saved.get(k) ?? []]] : []))),
      save: async (entries) => {
        for (const [k, v] of entries) saved.set(k, v);
      },
    };
    const text = 'Fix teh typo.';
    const first = makeRunner();
    await new CheckScheduler(100, store).check({
      requester: 'r',
      configKey: 'k',
      paragraphs: splitParagraphs(text),
      run: first.runner,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(saved.size).toBe(1);

    // A new scheduler, as after the service worker restarts.
    const second = makeRunner();
    const { suggestions } = await new CheckScheduler(100, store).check({
      requester: 'r',
      configKey: 'k',
      paragraphs: splitParagraphs(text),
      run: second.runner,
    });
    expect(second.calls).toEqual([]);
    expect(suggestions.map((s) => text.slice(s.start, s.end))).toEqual(['teh']);
  });
});
