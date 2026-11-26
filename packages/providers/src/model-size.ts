import type { ModelInfo } from './types.js';

const UNITS: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/**
 * Parse a parameter count as local servers report it: "3.2B" (Ollama), "15B", "270M",
 * "30B-A3B" (LM Studio; total parameters come first), "8x7B" (mixture of experts).
 * Undefined when the text isn't a size.
 */
export function parseParameterSize(text: string): number | undefined {
  const m = /^\s*(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*([KMBT])\b/i.exec(text);
  if (!m?.[2] || !m[3]) return undefined;
  const experts = m[1] ? Number(m[1]) : 1;
  const n = experts * Number(m[2]) * (UNITS[m[3].toUpperCase()] ?? 0);
  return n > 0 && Number.isFinite(n) ? n : undefined;
}

type Fetch = typeof fetch;

/** A local server whose native API reports model sizes. */
export type SizeSource = 'ollama' | 'lmstudio';

/**
 * Fill in `parameterCount` from a local server's native API. Best effort: a server that
 * doesn't answer, or answers in another shape, leaves the models as they were.
 */
export async function addParameterCounts(
  models: ModelInfo[],
  sources: readonly SizeSource[],
  root: string,
  fetchImpl: Fetch,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  if (models.length === 0 || sources.length === 0) return;
  const timeout = AbortSignal.timeout(3000);
  const opts = { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
  const found = await Promise.all(
    sources.map(async (source) => {
      try {
        const res = await fetchImpl(`${root}${PATHS[source]}`, opts);
        if (!res.ok) return new Map<string, number>();
        return READERS[source](await res.json());
      } catch {
        return new Map<string, number>();
      }
    }),
  );
  for (const m of models) {
    if (m.parameterCount !== undefined) continue;
    for (const sizes of found) {
      const n = sizes.get(m.id);
      if (n !== undefined) {
        m.parameterCount = n;
        break;
      }
    }
  }
}

const PATHS: Record<SizeSource, string> = {
  ollama: '/api/tags',
  lmstudio: '/api/v1/models',
};

const READERS: Record<SizeSource, (body: unknown) => Map<string, number>> = {
  /** `{ models: [{ name, model, details: { parameter_size: "3.2B" } }] }` */
  ollama(body) {
    const sizes = new Map<string, number>();
    for (const m of arrayAt(body, 'models')) {
      const details = isObject(m) ? m.details : undefined;
      const size = isObject(details) ? details.parameter_size : undefined;
      const n = typeof size === 'string' ? parseParameterSize(size) : undefined;
      if (n === undefined || !isObject(m)) continue;
      for (const id of [m.name, m.model]) if (typeof id === 'string') sizes.set(id, n);
    }
    return sizes;
  },
  /**
   * `{ models: [{ key, params_string: "15B", variants: [...], loaded_instances: [{ id }] }] }`.
   * The OpenAI-compatible list names a model by its key or, once loaded more than once, by
   * an instance id such as "key:2".
   */
  lmstudio(body) {
    const sizes = new Map<string, number>();
    for (const m of arrayAt(body, 'models')) {
      if (!isObject(m) || typeof m.params_string !== 'string') continue;
      const n = parseParameterSize(m.params_string);
      if (n === undefined) continue;
      const ids = [m.key, ...arrayAt(m, 'variants')];
      for (const inst of arrayAt(m, 'loaded_instances')) if (isObject(inst)) ids.push(inst.id);
      for (const id of ids) if (typeof id === 'string') sizes.set(id, n);
    }
    return sizes;
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function arrayAt(v: unknown, key: string): unknown[] {
  const a = isObject(v) ? v[key] : undefined;
  return Array.isArray(a) ? a : [];
}
