import type { Suggestion } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import { diffText, mapThroughEdit } from './edit-map';

function sug(text: string, original: string): Suggestion {
  const start = text.indexOf(original);
  return {
    id: original,
    pid: 'p',
    start,
    end: start + original.length,
    original,
    replacement: 'x',
    category: 'correctness',
    subtype: null,
    explanation: null,
  };
}

const ids = (list: Suggestion[]) => list.map((s) => `${s.original}@${s.start}`);

describe('diffText', () => {
  it('finds the changed region', () => {
    expect(diffText('abcdef', 'abXYdef')).toEqual({ start: 2, oldEnd: 3, newEnd: 4 });
    expect(diffText('abc', 'abc')).toBeNull();
    expect(diffText('aaa', 'aaaa')).toEqual({ start: 3, oldEnd: 3, newEnd: 4 });
  });
});

describe('mapThroughEdit', () => {
  const old = 'Read teh book tomorow.';
  const list = [sug(old, 'teh'), sug(old, 'tomorow')];

  it('shifts underlines after the edit and keeps those before it', () => {
    const next = 'Please read teh book tomorow.';
    expect(ids(mapThroughEdit(list, old, next))).toEqual(['teh@12', 'tomorow@21']);
    const edited = 'Read teh book soon, tomorow.';
    expect(ids(mapThroughEdit(list, old, edited))).toEqual(['teh@5', 'tomorow@20']);
  });

  it('drops an underline whose text the edit changes', () => {
    expect(ids(mapThroughEdit(list, old, 'Read the book tomorow.'))).toEqual(['tomorow@14']);
    expect(ids(mapThroughEdit(list, old, 'Read teh book tomorrow.'))).toEqual(['teh@5']);
  });

  it('drops an underline when a letter typed next to it changes the word', () => {
    expect(ids(mapThroughEdit(list, old, 'Read tehx book tomorow.'))).toEqual(['tomorow@15']);
    expect(ids(mapThroughEdit(list, old, 'Read xteh book tomorow.'))).toEqual(['tomorow@15']);
  });

  it('keeps an underline when a space or punctuation is typed next to it', () => {
    expect(ids(mapThroughEdit(list, old, 'Read teh, book tomorow.'))).toEqual([
      'teh@5',
      'tomorow@15',
    ]);
    expect(ids(mapThroughEdit(list, old, 'Read  teh book tomorow.'))).toEqual([
      'teh@6',
      'tomorow@15',
    ]);
  });

  it('follows a pasted block of text', () => {
    const next = `Intro paragraph.\n${old}`;
    expect(ids(mapThroughEdit(list, old, next))).toEqual(['teh@22', 'tomorow@31']);
  });
});
