import {
  CATEGORIES,
  type Category,
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
 * be found in their paragraph, or change nothing are dropped (and counted in `stats`). Coarse
 * rewrites are narrowed to the words that change (see `refine`). Overlaps are resolved in
 * favor of the higher-priority category.
 */
export function anchorSuggestions(
  items: unknown[],
  paragraphs: Paragraph[],
  stats?: { dropped: number },
): Suggestion[] {
  const byPid = new Map(paragraphs.map((p) => [p.pid, p]));
  const out: Suggestion[] = [];

  for (const item of items) {
    const parsed = ModelSuggestionSchema.safeParse(item);
    const s = parsed.success ? parsed.data : null;
    const p = s ? byPid.get(s.pid) : undefined;
    const local =
      s && p && s.original !== s.replacement
        ? findOccurrence(p.text, s.original, s.occurrence ?? 1)
        : -1;
    if (!s || !p || local === -1) {
      if (stats) stats.dropped++;
      continue;
    }

    for (const edit of refine(s.original, s.replacement, s.category)) {
      if (isUnsafeDeletion(p.text, local + edit.start, local + edit.end, edit, s.category)) {
        if (stats) stats.dropped++;
        continue;
      }
      const start = p.start + local + edit.start;
      const end = p.start + local + edit.end;
      out.push(makeSuggestion(s, p.pid, start, end, edit.original, edit.replacement));
    }
  }
  return resolveOverlaps(out);
}

/** Sentence-ending punctuation, optionally followed by closing quotes or brackets. */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/u;

/**
 * Some models answer `""` (delete) when they have no fix, which would silently remove the
 * user's words on accept. A deletion is dropped when it:
 * - leaves the paragraph with no words at all;
 * - removes a sentence's ending punctuation without the rest of the sentence ("Wednesday
 *   afternoon." → "Wednesday");
 * - is a correctness fix of more than one word ("the the" → "", "discussed about" → ""): a
 *   correctness deletion removes one wrong word or mark, never a phrase.
 * `start`/`end` are offsets in `text`, the paragraph.
 */
function isUnsafeDeletion(
  text: string,
  start: number,
  end: number,
  edit: Pick<Edit, 'original' | 'replacement'>,
  category: Category,
): boolean {
  if (edit.replacement.trim() !== '') return false;
  const span = edit.original.trim();
  if (!/[\p{L}\p{N}]/u.test(text.slice(0, start) + text.slice(end))) return true;
  if (SENTENCE_END.test(span)) {
    const before = text.slice(0, start).trimEnd();
    if (before !== '' && !SENTENCE_END.test(before)) return true;
  }
  return category === 'correctness' && /\s/.test(span);
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

/**
 * Narrow a rewrite to the words that change. Offsets are relative to `original`.
 *
 * A correctness rewrite of a whole sentence often fixes several independent mistakes; those
 * become separate suggestions when unchanged words lie between them. Changes with nothing but
 * spaces or punctuation between them stay together ("me to apply" → "that I apply" is one
 * fix; "me" → "that" alone would be wrong). A clarity, style or tone rewrite is one change
 * however many words it touches, so it is only trimmed, never split.
 */
export function refine(original: string, replacement: string, category?: Category): Edit[] {
  const whole = [{ start: 0, end: original.length, original, replacement }];
  if (original.trim().split(/\s+/).length < REFINE_MIN_WORDS) return whole;

  const parts = diffWordsWithSpace(original, replacement);
  const raw: Edit[] = [];
  let pos = 0;
  let current: Edit | null = null;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (current) raw.push(current);
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
  if (current) raw.push(current);

  const splittable = category === undefined || category === 'correctness';
  const edits: Edit[] = [];
  for (const e of raw) {
    const prev = edits.at(-1);
    const gap = prev ? original.slice(prev.end, e.start) : '';
    if (prev && (!splittable || !/[\p{L}\p{N}]/u.test(gap))) {
      prev.replacement += gap + e.replacement;
      prev.original = original.slice(prev.start, e.end);
      prev.end = e.end;
    } else {
      edits.push({ ...e });
    }
  }

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
