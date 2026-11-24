import type { CachedSuggestion, CacheStore } from '@cadenza/engine';
import { browser } from 'wxt/browser';

const PREFIX = 'check:';
/** storage.session allows 10 MB; start over well before that. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Check results kept in `storage.session`: in memory only, never written to disk, cleared when
 * the browser closes, and readable only by the extension's own pages and worker. It lets
 * results survive Chrome suspending the idle service worker, so text isn't re-checked (slow
 * on local models) after every pause in typing.
 */
export const sessionCacheStore: CacheStore = {
  async load(keys) {
    const got = await browser.storage.session.get(keys.map((k) => PREFIX + k));
    const out = new Map<string, CachedSuggestion[]>();
    for (const [k, v] of Object.entries(got))
      out.set(k.slice(PREFIX.length), v as CachedSuggestion[]);
    return out;
  },
  async save(entries) {
    if (entries.length === 0) return;
    if ((await browser.storage.session.getBytesInUse(null)) > MAX_BYTES) {
      const all = await browser.storage.session.get(null);
      await browser.storage.session.remove(Object.keys(all).filter((k) => k.startsWith(PREFIX)));
    }
    await browser.storage.session.set(Object.fromEntries(entries.map(([k, v]) => [PREFIX + k, v])));
  },
};
