import type { Suggestion } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import { layoutLines } from './render-overlay';

const s = (text: string, original: string, id = original, from = 0): Suggestion => {
  const start = text.indexOf(original, from);
  return {
    id,
    pid: 'p',
    start,
    end: start + original.length,
    original,
    replacement: 'x',
    category: 'correctness',
    subtype: null,
    explanation: null,
  };
};

describe('overlay lines', () => {
  it('splits text into lines with marks relative to each line', () => {
    const text = 'Read teh book.\n\nSee you tomorow.';
    const lines = layoutLines(text, [s(text, 'teh'), s(text, 'tomorow')]);
    expect(lines.map((l) => l.text)).toEqual(['Read teh book.', '', 'See you tomorow.']);
    expect(lines[0]?.marks.map((m) => [m.start, m.end])).toEqual([[5, 8]]);
    expect(lines[1]?.marks).toEqual([]);
    expect(lines[2]?.marks.map((m) => [m.start, m.end])).toEqual([[8, 15]]);
  });

  it('cuts a suggestion that spans a line break into both lines', () => {
    const text = 'one two\nthree four';
    const lines = layoutLines(text, [s(text, 'two\nthree')]);
    expect(lines[0]?.marks.map((m) => [m.start, m.end])).toEqual([[4, 7]]);
    expect(lines[1]?.marks.map((m) => [m.start, m.end])).toEqual([[0, 5]]);
  });

  it('keeps the keys of lines an edit elsewhere only moved', () => {
    const before = 'First line.\nRead teh book.';
    const after = 'First line, edited.\nRead teh book.';
    const a = layoutLines(before, [s(before, 'teh', 'id1')]);
    const b = layoutLines(after, [s(after, 'teh', 'id1')]);
    expect(a[0]?.key).not.toBe(b[0]?.key);
    expect(a[1]?.key).toBe(b[1]?.key);
  });

  it('skips suggestions whose text no longer matches', () => {
    const text = 'Read the book.';
    const stale = { ...s('Read teh book.', 'teh') };
    expect(layoutLines(text, [stale])[0]?.marks).toEqual([]);
  });
});
