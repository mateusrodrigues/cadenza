import type { Category, ModelSuggestion } from '@cadenza/shared';
import { ProviderError } from './errors.js';
import type { CompletionRequest, CompletionResult, ModelInfo, Provider } from './types.js';

interface Rule {
  pattern: RegExp;
  replacement: string;
  category: Category;
  subtype: string;
  explanation: string;
}

/** Deterministic rules so UI work and end-to-end tests run without any model. */
const RULES: Rule[] = [
  rule(/\bteh\b/g, 'the', 'correctness', 'spelling', 'Spelling mistake.'),
  rule(/\btomorow\b/g, 'tomorrow', 'correctness', 'spelling', 'Spelling mistake.'),
  rule(/\brecieve\b/g, 'receive', 'correctness', 'spelling', 'Spelling mistake.'),
  rule(/\bdefinately\b/g, 'definitely', 'correctness', 'spelling', 'Spelling mistake.'),
  rule(
    /\bTheir going\b/g,
    "They're going",
    'correctness',
    'grammar',
    '"They\'re" means "they are".',
  ),
  rule(/\bdue to the fact that\b/g, 'because', 'clarity', 'wordiness', 'Shorter and clearer.'),
  rule(/\bin order to\b/g, 'to', 'clarity', 'wordiness', 'Shorter and clearer.'),
  rule(
    /\bvery unique\b/g,
    'unique',
    'style',
    'redundancy',
    '"Unique" already means one of a kind.',
  ),
  rule(/\bbasically\b/g, '', 'style', 'filler', 'Filler word that adds nothing.'),
  rule(/\bASAP\b/g, 'as soon as you can', 'tone', 'politeness', 'Softer and more courteous.'),
];

function rule(
  pattern: RegExp,
  replacement: string,
  category: Category,
  subtype: string,
  explanation: string,
): Rule {
  return { pattern, replacement, category, subtype, explanation };
}

export interface MockOptions {
  /** Simulated latency in ms. */
  delayMs?: number;
}

export class MockProvider implements Provider {
  readonly kind = 'mock' as const;
  constructor(private readonly opts: MockOptions = {}) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'mock-rules', label: 'Built-in test rules' }];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    await sleep(this.opts.delayMs ?? 150, req.signal);
    const paragraphs = extractParagraphs(req.user);
    const suggestions: ModelSuggestion[] = [];
    for (const p of paragraphs) {
      for (const r of RULES) {
        for (const m of p.text.matchAll(r.pattern)) {
          suggestions.push({
            pid: p.pid,
            original: m[0],
            replacement: r.replacement,
            category: r.category,
            occurrence: countBefore(p.text, m[0], m.index ?? 0) + 1,
            subtype: r.subtype,
            explanation: r.explanation,
          });
        }
      }
    }
    return { text: JSON.stringify({ suggestions }), usage: null, truncated: false };
  }
}

function countBefore(text: string, needle: string, index: number): number {
  let count = 0;
  let from = text.indexOf(needle);
  while (from !== -1 && from < index) {
    count++;
    from = text.indexOf(needle, from + 1);
  }
  return count;
}

function extractParagraphs(user: string): { pid: string; text: string }[] {
  const start = user.indexOf('{');
  const end = user.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(user.slice(start, end + 1)) as {
      paragraphs?: { pid: string; text: string }[];
    };
    return parsed.paragraphs ?? [];
  } catch {
    return [];
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError('cancelled', 'Request cancelled'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new ProviderError('cancelled', 'Request cancelled'));
      },
      { once: true },
    );
  });
}
