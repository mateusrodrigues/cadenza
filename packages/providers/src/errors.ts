export type ProviderErrorKind =
  | 'auth'
  | 'rate_limited'
  | 'context_too_long'
  /** The requested output tier (e.g. json_schema) isn't supported; try a lower tier. */
  | 'unsupported_output'
  | 'bad_output'
  | 'not_found'
  | 'network'
  | 'unavailable'
  | 'cancelled'
  | 'not_implemented'
  | 'unknown';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryAfterMs: number | null;
  readonly status: number | null;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    opts: { status?: number | null; retryAfterMs?: number | null; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

const OUTPUT_FORMAT_HINT =
  /response_format|json_schema|json schema|schema|grammar|parser|structured/i;
const CONTEXT_HINT = /context length|context window|too long|maximum context|too many tokens/i;

/** Classify an HTTP failure into a ProviderErrorKind using status and message text. */
export function classifyHttpError(status: number | null, message: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) {
    if (CONTEXT_HINT.test(message)) return 'context_too_long';
    if (OUTPUT_FORMAT_HINT.test(message)) return 'unsupported_output';
    return 'unknown';
  }
  if (status !== null && status >= 500) return 'unavailable';
  return 'unknown';
}
