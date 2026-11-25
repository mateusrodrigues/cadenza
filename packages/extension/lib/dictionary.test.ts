import type { Suggestion } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import { dictionaryWord, validWord, withoutDictionary } from './dictionary';

const s = (original: string, replacement: string, extra: Partial<Suggestion> = {}): Suggestion => ({
  id: original,
  pid: 'p',
  start: 0,
  end: original.length,
  original,
  replacement,
  category: 'correctness',
  subtype: 'spelling',
  explanation: null,
  ...extra,
});

describe('dictionary', () => {
  it('drops correctness changes to a dictionary word, ignoring case', () => {
    const out = withoutDictionary(
      [s('Cadenza', 'Cadence'), s('teh', 'the'), s('cadenza.', 'cadence.')],
      ['cadenza'],
    );
    expect(out.map((x) => x.original)).toEqual(['teh']);
  });

  it('keeps fixes that leave the word alone, and other categories', () => {
    const out = withoutDictionary(
      [
        s('Mateus go', 'Mateus goes', { subtype: 'agreement' }),
        s('Mateus', 'he', { category: 'style', subtype: 'repetition' }),
      ],
      ['Mateus'],
    );
    expect(out).toHaveLength(2);
  });

  it('offers single misspelled words only', () => {
    expect(dictionaryWord(s('Kubernets', 'Kubernetes'))).toBe('Kubernets');
    expect(dictionaryWord(s('teh book', 'the book'))).toBeNull();
    expect(dictionaryWord(s('their', "they're", { subtype: 'grammar' }))).toBeNull();
    expect(dictionaryWord(s('basically', '', { category: 'style', subtype: 'filler' }))).toBeNull();
  });

  it('validates words', () => {
    expect(validWord('O’Brien')).toBe(true);
    expect(validWord('e-mail')).toBe(true);
    expect(validWord('two words')).toBe(false);
    expect(validWord('trailing-')).toBe(false);
    expect(validWord('')).toBe(false);
    expect(validWord('x'.repeat(65))).toBe(false);
  });
});
