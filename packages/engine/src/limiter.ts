import { ProviderError } from '@cadenza/providers';

/**
 * Limits how many requests run at once against one provider, and pauses everyone after a
 * rate-limit response. Queued work whose signal aborts leaves the queue without ever being
 * sent, which matters for slow local models where a stale request costs a minute.
 */
export class RequestLimiter {
  private running = 0;
  private readonly queue: {
    start: () => void;
    signal: AbortSignal;
    reject: (e: unknown) => void;
  }[] = [];
  private pausedUntil = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly opts: {
      defaultBackoffMs?: number;
      maxBackoffMs?: number;
      retries?: number;
    } = {},
  ) {}

  async run<T>(fn: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    const retries = this.opts.retries ?? 1;
    for (let attempt = 0; ; attempt++) {
      await this.acquire(signal);
      try {
        await this.waitForPause(signal);
        return await fn(signal);
      } catch (err) {
        if (err instanceof ProviderError && err.kind === 'rate_limited' && attempt < retries) {
          this.pause(err.retryAfterMs);
          continue;
        }
        throw err;
      } finally {
        this.release();
      }
    }
  }

  private pause(retryAfterMs: number | null) {
    const ms = Math.min(
      retryAfterMs ?? this.opts.defaultBackoffMs ?? 5_000,
      this.opts.maxBackoffMs ?? 60_000,
    );
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  private async waitForPause(signal: AbortSignal) {
    const wait = this.pausedUntil - Date.now();
    if (wait <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, wait);
      function done() {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }
      function onAbort() {
        clearTimeout(timer);
        reject(cancelled(signal));
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(cancelled(signal));
    if (this.running < this.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = {
        signal,
        reject,
        start: () => {
          signal.removeEventListener('abort', onAbort);
          this.running++;
          resolve();
        },
      };
      const onAbort = () => {
        const i = this.queue.indexOf(entry);
        if (i !== -1) this.queue.splice(i, 1);
        reject(cancelled(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.queue.push(entry);
    });
  }

  private release() {
    this.running--;
    this.queue.shift()?.start();
  }
}

function cancelled(signal: AbortSignal): unknown {
  return signal.reason instanceof ProviderError
    ? signal.reason
    : new ProviderError('cancelled', 'No longer needed');
}
