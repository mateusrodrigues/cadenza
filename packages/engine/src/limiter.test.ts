import { ProviderError } from '@cadenza/providers';
import { describe, expect, it, vi } from 'vitest';
import { RequestLimiter } from './limiter.js';

function deferred() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('RequestLimiter', () => {
  it('runs at most N at once and starts queued work as slots free up', async () => {
    const limiter = new RequestLimiter(1);
    const a = deferred();
    const started: string[] = [];
    const signal = new AbortController().signal;
    const pa = limiter.run(() => {
      started.push('a');
      return a.promise;
    }, signal);
    const pb = limiter.run(async () => {
      started.push('b');
      return 'b';
    }, signal);
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['a']);
    a.resolve('a');
    expect(await Promise.all([pa, pb])).toEqual(['a', 'b']);
    expect(started).toEqual(['a', 'b']);
  });

  it('drops queued work whose signal aborts, without running it', async () => {
    const limiter = new RequestLimiter(1);
    const a = deferred();
    const fn = vi.fn(async () => 'b');
    const pa = limiter.run(() => a.promise, new AbortController().signal);
    const ctrl = new AbortController();
    const pb = limiter.run(fn, ctrl.signal);
    ctrl.abort();
    await expect(pb).rejects.toMatchObject({ kind: 'cancelled' });
    a.resolve('a');
    await pa;
    expect(fn).not.toHaveBeenCalled();
  });

  it('pauses and retries once after a rate limit', async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RequestLimiter(2);
      let calls = 0;
      const p = limiter.run(async () => {
        calls++;
        if (calls === 1)
          throw new ProviderError('rate_limited', 'slow down', { retryAfterMs: 2000 });
        return 'ok';
      }, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(1999);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(p).resolves.toBe('ok');
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after the retry and reports the rate limit', async () => {
    const limiter = new RequestLimiter(1, { defaultBackoffMs: 1 });
    const p = limiter.run(async () => {
      throw new ProviderError('rate_limited', 'slow down');
    }, new AbortController().signal);
    await expect(p).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});
