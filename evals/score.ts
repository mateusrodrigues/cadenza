import type { Category, Suggestion } from '@cadenza/shared';
import { CATEGORY_IDS } from '@cadenza/shared';
import { type Issue, isClean, type Sample, type Span, spanOf, wordCount } from './corpus.js';

/**
 * - tp: overlaps a labeled issue (and, for correctness issues, applying it gives an accepted fix)
 * - wrong_fix: overlaps a correctness issue but the replacement isn't an accepted fix
 * - neutral: overlaps only an optional (matter-of-taste) span
 * - fp: overlaps nothing labeled
 */
export type Verdict = 'tp' | 'wrong_fix' | 'neutral' | 'fp';

export type ScoredSuggestion = Pick<
  Suggestion,
  'start' | 'end' | 'original' | 'replacement' | 'category' | 'subtype'
> & { verdict: Verdict };

export interface SampleScore {
  suggestions: ScoredSuggestion[];
  /** Per required issue, in sample order. */
  issues: { category: Category; found: boolean; fixed: boolean }[];
}

function overlaps(a: Span, b: Span): boolean {
  if (a.start === a.end) return a.start >= b.start && a.start <= b.end;
  return a.start < b.end && b.start < a.end;
}

/** Only whitespace between the two spans. */
function touches(text: string, a: Span, b: Span): boolean {
  const gap = a.end <= b.start ? text.slice(a.end, b.start) : text.slice(b.end, a.start);
  return /^\s*$/.test(gap);
}

function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

function apply(text: string, span: Span, replacement: string): string {
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

/** Every text the sample could become if the given issues were fixed (or, if optional, kept). */
function acceptedTexts(text: string, issues: { issue: Issue; span: Span }[]): Set<string> {
  let variants = [text];
  // Apply right to left so earlier spans keep their offsets.
  const ordered = [...issues].sort((a, b) => b.span.start - a.span.start);
  for (const { issue, span } of ordered) {
    const fixes = issue.fix ?? [];
    const next: string[] = [];
    for (const v of variants) {
      if (issue.optional || fixes.length === 0) next.push(v);
      for (const f of fixes) next.push(apply(v, span, f));
    }
    variants = next.slice(0, 64);
  }
  return new Set(variants.map(normalize));
}

export function scoreSample(sample: Sample, suggestions: Suggestion[]): SampleScore {
  const located = sample.issues.map((issue) => ({ issue, span: spanOf(sample, issue) }));
  const required = located.filter((l) => !l.issue.optional);
  const found = new Set<number>();
  const fixed = new Set<number>();

  const scored = suggestions.map((s): ScoredSuggestion => {
    const span = { start: s.start, end: s.end };
    const applied = normalize(apply(sample.text, span, s.replacement));
    // A suggestion right next to an issue (an article inserted after the previous word,
    // "bought" → "bought a") counts when applying it fixes that issue.
    const fixesNeighbor = (l: (typeof located)[number]) =>
      touches(sample.text, span, l.span) &&
      l.issue.fix !== undefined &&
      acceptedTexts(sample.text, [l]).has(applied);
    const hits = located.filter((l) => overlaps(span, l.span) || fixesNeighbor(l));
    const requiredHits = hits.filter((l) => !l.issue.optional);
    let verdict: Verdict;
    if (requiredHits.length === 0) {
      verdict = hits.length > 0 ? 'neutral' : 'fp';
    } else {
      const strict = hits.filter((l) => l.issue.category === 'correctness' && l.issue.fix);
      const ok = strict.length === 0 || acceptedTexts(sample.text, strict).has(applied);
      verdict = ok ? 'tp' : 'wrong_fix';
      for (const l of requiredHits) {
        const i = required.indexOf(l);
        found.add(i);
        if (ok) fixed.add(i);
      }
    }
    return {
      start: s.start,
      end: s.end,
      original: s.original,
      replacement: s.replacement,
      category: s.category,
      subtype: s.subtype,
      verdict,
    };
  });

  return {
    suggestions: scored,
    issues: required.map((l, i) => ({
      category: l.issue.category,
      found: found.has(i),
      fixed: fixed.has(i),
    })),
  };
}

export interface SampleResult {
  id: string;
  ms: number | null;
  error?: { kind: string; message: string };
  tier?: string;
  dropped?: number;
  /** Thinking ran out of tokens and the engine asked again without it. */
  thinkingFellBack?: boolean;
  outputTokens?: number | null;
  suggestions: Suggestion[];
  /** The model's raw items, so engine changes can be re-scored with --reanchor. */
  items?: unknown[];
}

export interface Summary {
  samples: number;
  errors: number;
  /** Over all suggestions: tp / (tp + wrong_fix + fp). Neutral ones are left out. */
  precision: number | null;
  /** Same, for suggestions the model labeled correctness. */
  correctnessPrecision: number | null;
  /** Per labeled category: share of issues found (any suggestion overlapping) and fixed. */
  recall: Record<Category, { issues: number; found: number; fixed: number }>;
  /** False positives on clean samples, per 500 words of clean text. */
  cleanFpPer500Words: number | null;
  cleanWords: number;
  cleanFps: number;
  counts: Record<Verdict, number>;
  dropped: number;
  latencyMs: { p50: number | null; p95: number | null };
  outputTokens: number;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

function ratio(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

export function summarize(samples: Sample[], results: SampleResult[]): Summary {
  const byId = new Map(samples.map((s) => [s.id, s]));
  const counts: Record<Verdict, number> = { tp: 0, wrong_fix: 0, neutral: 0, fp: 0 };
  const correctness: Record<Verdict, number> = { tp: 0, wrong_fix: 0, neutral: 0, fp: 0 };
  const recall = Object.fromEntries(
    CATEGORY_IDS.map((c) => [c, { issues: 0, found: 0, fixed: 0 }]),
  ) as Summary['recall'];
  let cleanWords = 0;
  let cleanFps = 0;
  let errors = 0;
  let dropped = 0;
  let outputTokens = 0;
  const latencies: number[] = [];

  for (const r of results) {
    const sample = byId.get(r.id);
    if (!sample) continue;
    if (r.error) {
      errors++;
      continue;
    }
    if (r.ms !== null) latencies.push(r.ms);
    dropped += r.dropped ?? 0;
    outputTokens += r.outputTokens ?? 0;
    const score = scoreSample(sample, r.suggestions);
    for (const s of score.suggestions) {
      counts[s.verdict]++;
      if (s.category === 'correctness') correctness[s.verdict]++;
    }
    for (const i of score.issues) {
      recall[i.category].issues++;
      if (i.found) recall[i.category].found++;
      if (i.fixed) recall[i.category].fixed++;
    }
    if (isClean(sample)) {
      cleanWords += wordCount(sample.text);
      cleanFps += score.suggestions.filter((s) => s.verdict === 'fp').length;
    }
  }

  return {
    samples: results.length,
    errors,
    precision: ratio(counts.tp, counts.tp + counts.wrong_fix + counts.fp),
    correctnessPrecision: ratio(
      correctness.tp,
      correctness.tp + correctness.wrong_fix + correctness.fp,
    ),
    recall,
    cleanFpPer500Words: cleanWords === 0 ? null : (cleanFps / cleanWords) * 500,
    cleanWords,
    cleanFps,
    counts,
    dropped,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    outputTokens,
  };
}
