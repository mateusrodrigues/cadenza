import { describe, expect, it } from 'vitest';
import { mergeEdits, widenDeletion } from './apply';

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
