import type { Usage } from '@cadenza/providers';
import { browser } from 'wxt/browser';

/**
 * Requests and tokens per provider per day, for the settings page and the daily limit. Only
 * counts; never any text. Written by the worker alone, one update at a time.
 */
export interface DayUsage {
  name: string;
  checks: number;
  inputTokens: number;
  outputTokens: number;
}

/** Local date ("2026-11-24") → provider id → usage. */
export type UsageLog = Record<string, Record<string, DayUsage>>;

const KEY = 'usage';
const KEEP_DAYS = 31;

export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function loadUsage(): Promise<UsageLog> {
  const stored = (await browser.storage.local.get(KEY))[KEY];
  return stored && typeof stored === 'object' ? (stored as UsageLog) : {};
}

let queue: Promise<unknown> = Promise.resolve();

/** Count one request. Serialized so concurrent checks don't overwrite each other. */
export function recordUsage(
  provider: { id: string; name: string },
  usage: Usage | null,
): Promise<void> {
  const next = queue.then(async () => {
    const log = addUsage(await loadUsage(), today(), provider, usage);
    await browser.storage.local.set({ [KEY]: log });
  });
  queue = next.catch(() => {});
  return next;
}

export function addUsage(
  log: UsageLog,
  day: string,
  provider: { id: string; name: string },
  usage: Usage | null,
): UsageLog {
  const days = { ...log };
  const entry = { ...(days[day] ?? {}) };
  const prev = entry[provider.id] ?? {
    name: provider.name,
    checks: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  entry[provider.id] = {
    name: provider.name,
    checks: prev.checks + 1,
    inputTokens: prev.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: prev.outputTokens + (usage?.outputTokens ?? 0),
  };
  days[day] = entry;
  for (const d of Object.keys(days).sort().slice(0, -KEEP_DAYS)) delete days[d];
  return days;
}

/** Checks sent today to the given providers. */
export function checksToday(log: UsageLog, providerIds: Set<string>, day = today()): number {
  let n = 0;
  for (const [id, u] of Object.entries(log[day] ?? {})) if (providerIds.has(id)) n += u.checks;
  return n;
}
