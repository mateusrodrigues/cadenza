import type { Paragraph } from '@cadenza/shared';

/** FNV-1a 32-bit, hex. Fast and good enough for cache keys and stable IDs. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Split field text into paragraphs on line breaks. Whitespace-only lines are skipped.
 * Paragraph IDs depend only on the text (plus a counter for duplicates), so an unchanged
 * paragraph keeps its ID when other paragraphs are edited.
 */
export function splitParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const seen = new Map<string, number>();
  const re = /[^\n]+/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    if (raw.trim() === '') continue;
    const base = `p${hash(raw)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ pid: n === 0 ? base : `${base}-${n}`, text: raw, start: m.index ?? 0 });
  }
  return out;
}
