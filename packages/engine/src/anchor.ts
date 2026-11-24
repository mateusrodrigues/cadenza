import {
  CATEGORIES,
  type ModelSuggestion,
  ModelSuggestionSchema,
  type Paragraph,
  type Suggestion,
} from '@cadenza/shared';
import { diffWordsWithSpace } from 'diff';
import { hash } from './paragraphs.js';

/** Originals longer than this many words are split into minimal edits with a word diff. */
const REFINE_MIN_WORDS = 4;

/**
 * Turn raw model items into suggestions with exact offsets. Items that fail validation, can't
 * be found in their paragraph, or change nothing are dropped. Coarse rewrites (a model
 * replacing a whole sentence) are split into minimal word-level edits. Overlaps are resolved
 * in favor of the higher-priority category.
 */
export function anchorSuggestions(items: unknown[], paragraphs: Paragraph[]): Suggestion[] {
  const byPid = new Map(paragraphs.map((p) => [p.pid, p]));
  const out: Suggestion[] = [];

  for (const item of items) {
    const parsed = ModelSuggestionSchema.safeParse(item);
    if (!parsed.success) continue;
    const s = parsed.data;
    const p = byPid.get(s.pid);
    if (!p || s.original === s.replacement) continue;

    const local = findOccurrence(p.text, s.original, s.occurrence ?? 1);
    if (local === -1) continue;

    for (const edit of refine(s.original, s.replacement)) {
      const start = p.start + local + edit.start;
      const end = p.start + local + edit.end;
      out.push(makeSuggestion(s, p.pid, start, end, edit.original, edit.replacement));
    }
  }
  return resolveOverlaps(out);
}

function findOccurrence(text: string, needle: string, occurrence: number): number {
  let idx = -1;
  for (let i = 0; i < occurrence; i++) {
    idx = text.indexOf(needle, idx + 1);
    if (idx === -1) break;
  }
  // A wrong occurrence number is common; fall back to the first match.
  return idx !== -1 ? idx : text.indexOf(needle);
}

interface Edit {
  start: number;
  end: number;
  original: string;
  replacement: string;
}

/** Split a rewrite into minimal edits. Offsets are relative to `original`. */
export function refine(original: string, replacement: string): Edit[] {
  const whole = [{ start: 0, end: original.length, original, replacement }];
  if (original.trim().split(/\s+/).length < REFINE_MIN_WORDS) return whole;

  const parts = diffWordsWithSpace(original, replacement);
  const edits: Edit[] = [];
  let pos = 0;
  let current: Edit | null = null;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (current) edits.push(current);
      current = null;
      pos += part.value.length;
      continue;
    }
    current ??= { start: pos, end: pos, original: '', replacement: '' };
    if (part.removed) {
      current.original += part.value;
      current.end += part.value.length;
      pos += part.value.length;
    } else {
      current.replacement += part.value;
    }
  }
  if (current) edits.push(current);

  const result = edits
    .map((e) => trimEdit(original, e))
    .filter((e): e is Edit => e !== null)
    .map((e) => (e.start === e.end ? widenInsertion(original, e) : e));
  return result.length > 0 ? result : whole;
}

/** Drop whitespace-only differences at the edges of an edit. */
function trimEdit(source: string, e: Edit): Edit | null {
  if (e.original.trim() === '' && e.replacement.trim() === '') return null;
  let { start, end, original, replacement } = e;
  while (original.startsWith(' ') && replacement.startsWith(' ')) {
    original = original.slice(1);
    replacement = replacement.slice(1);
    start++;
  }
  while (original.endsWith(' ') && replacement.endsWith(' ')) {
    original = original.slice(0, -1);
    replacement = replacement.slice(0, -1);
    end--;
  }
  return { start, end, original: source.slice(start, end), replacement };
}

/** A pure insertion has nothing to underline; attach it to the word before (or after) it. */
function widenInsertion(source: string, e: Edit): Edit {
  const before = /(\S+)(\s*)$/.exec(source.slice(0, e.start));
  if (before) {
    const start = e.start - before[0].length;
    return {
      start,
      end: e.end,
      original: source.slice(start, e.end),
      replacement: before[0] + e.replacement,
    };
  }
  const after = /^(\s*)(\S+)/.exec(source.slice(e.end));
  if (after) {
    const end = e.end + after[0].length;
    return {
      start: e.start,
      end,
      original: source.slice(e.start, end),
      replacement: e.replacement + after[0],
    };
  }
  return e;
}

function makeSuggestion(
  s: ModelSuggestion,
  pid: string,
  start: number,
  end: number,
  original: string,
  replacement: string,
): Suggestion {
  return {
    id: `${pid}:${start}:${end}:${hash(replacement)}`,
    pid,
    start,
    end,
    original,
    replacement,
    category: s.category,
    subtype: s.subtype ?? null,
    explanation: s.explanation ?? null,
  };
}

function resolveOverlaps(items: Suggestion[]): Suggestion[] {
  const ranked = [...items].sort(
    (a, b) =>
      CATEGORIES[a.category].priority - CATEGORIES[b.category].priority ||
      a.end - a.start - (b.end - b.start),
  );
  const kept: Suggestion[] = [];
  for (const s of ranked) {
    if (s.start === s.end) continue;
    if (kept.some((k) => s.start < k.end && k.start < s.end)) continue;
    kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}
