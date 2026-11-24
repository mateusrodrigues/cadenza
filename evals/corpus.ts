import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Category, Dialect } from '@cadenza/shared';
import { CATEGORY_IDS } from '@cadenza/shared';

/** A labeled problem in a sample: the exact span, its category and the fixes that count. */
export interface Issue {
  original: string;
  category: Category;
  /** Accepted replacements for `original`. Checked for correctness issues only. */
  fix?: string[];
  /** 1 = first appearance of `original` in the sample text. */
  occurrence?: number;
  /** A matter of taste: a suggestion here counts neither for nor against the model. */
  optional?: boolean;
}

export interface Sample {
  id: string;
  text: string;
  issues: Issue[];
  dialect?: Dialect;
  tags?: string[];
}

export interface Span {
  start: number;
  end: number;
}

export const CORPUS_PATH = join(import.meta.dirname, 'corpus.jsonl');

export function loadCorpus(path = CORPUS_PATH): Sample[] {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  const samples = lines.map((l, i) => {
    try {
      return JSON.parse(l) as Sample;
    } catch {
      throw new Error(`corpus line ${i + 1}: invalid JSON`);
    }
  });
  validateCorpus(samples);
  return samples;
}

export function validateCorpus(samples: Sample[]): void {
  const ids = new Set<string>();
  for (const s of samples) {
    if (ids.has(s.id)) throw new Error(`duplicate sample id ${s.id}`);
    ids.add(s.id);
    for (const issue of s.issues) {
      if (!CATEGORY_IDS.includes(issue.category)) {
        throw new Error(`${s.id}: unknown category ${issue.category}`);
      }
      spanOf(s, issue); // throws if the span isn't there
    }
  }
}

/** Where an issue sits in its sample's text. */
export function spanOf(sample: Sample, issue: Issue): Span {
  let from = 0;
  let at = -1;
  for (let n = 0; n < (issue.occurrence ?? 1); n++) {
    at = sample.text.indexOf(issue.original, from);
    if (at === -1) break;
    from = at + 1;
  }
  if (at === -1) {
    throw new Error(
      `${sample.id}: "${issue.original}" (occurrence ${issue.occurrence ?? 1}) not in text`,
    );
  }
  return { start: at, end: at + issue.original.length };
}

/** Samples with no required issue: every suggestion on them is a false positive. */
export function isClean(sample: Sample): boolean {
  return sample.issues.every((i) => i.optional);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
