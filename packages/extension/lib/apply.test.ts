import { describe, expect, it } from 'vitest';
import { applyToString, invertEdits, mergeEdits, widenDeletion } from './apply';

const edit = (text: string, original: string, replacement: string, from = 0) => {
  const start = text.indexOf(original, from);
  return { start, end: start + original.length, original, replacement };
};

describe('widenDeletion', () => {
  it('takes the space before a deleted word', () => {
    const text = 'This is basically fine.';
    const e = widenDeletion(text, edit(text, 'basically', ''));
    expect(text.slice(0, e.start) + text.slice(e.end)).toBe('This is fine.');
  });

  it('takes the space before punctuation', () => {
    const text = 'It works, basically.';
    const e = widenDeletion(text, edit(text, 'basically', ''));
    expect(text.slice(0, e.start) + text.slice(e.end)).toBe('It works,.');
  });

  it('takes the space after a word at the start of a line', () => {
    const text = 'One.\nbasically two.';
    const e = widenDeletion(text, edit(text, 'basically', ''));
    expect(text.slice(0, e.start) + text.slice(e.end)).toBe('One.\ntwo.');
  });

  it('leaves replacements alone', () => {
    const text = 'Read teh book.';
    const e = edit(text, 'teh', 'the');
    expect(widenDeletion(text, e)).toEqual(e);
  });
});

describe('mergeEdits', () => {
  it('combines edits into one replacement over their span', () => {
    const text = 'Read teh book tomorow, basically.';
    const merged = mergeEdits(text, [
      edit(text, 'tomorow', 'tomorrow'),
      edit(text, 'teh', 'the'),
      edit(text, 'basically', ''),
    ]);
    expect(merged).not.toBeNull();
    const { start, end, replacement } = merged as NonNullable<typeof merged>;
    expect(text.slice(0, start) + replacement + text.slice(end)).toBe('Read the book tomorrow,.');
  });

  it('refuses edits whose text changed', () => {
    const text = 'Read the book.';
    expect(mergeEdits(text, [{ start: 5, end: 8, original: 'teh', replacement: 'the' }])).toBe(
      null,
    );
  });

  it('refuses overlapping edits', () => {
    const text = 'Their going home.';
    expect(
      mergeEdits(text, [edit(text, 'Their going', "They're going"), edit(text, 'going', 'gone')]),
    ).toBe(null);
  });
});

describe('invertEdits', () => {
  const text = 'Read teh book tomorow, it is basically very unique.';
  const edits = [
    edit(text, 'tomorow', 'tomorrow'),
    edit(text, 'teh', 'the'),
    edit(text, 'basically', ''),
  ];

  it('takes the text back, one edit per change', () => {
    const result = invertEdits(text, edits);
    expect(result?.after).toBe('Read the book tomorrow, it is very unique.');
    expect(result?.inverse).toHaveLength(3);
    expect(applyToString(result?.after ?? '', result?.inverse ?? [])).toBe(text);
  });

  it('puts back the space a deleted word took with it', () => {
    const result = invertEdits(text, [edit(text, 'basically', '')]);
    expect(result?.inverse).toEqual([
      { start: 28, end: 28, original: '', replacement: ' basically' },
    ]);
  });

  it('refuses stale or overlapping edits', () => {
    expect(invertEdits(text, [{ ...edit(text, 'teh', 'the'), original: 'tha' }])).toBe(null);
    expect(invertEdits(text, [edit(text, 'Read teh', 'Read the'), edit(text, 'teh', 'the')])).toBe(
      null,
    );
  });
});
