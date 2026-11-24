import type { Suggestion } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import { validRule, withoutIgnored } from './ignored';

const s = (original: string, category: Suggestion['category']): Suggestion => ({
  id: original,
  pid: 'p',
  start: 0,
  end: original.length,
  original,
  replacement: 'x',
  category,
  subtype: null,
  explanation: null,
});

describe('ignore rules', () => {
  it('drop suggestions on the same text and category only', () => {
    const out = withoutIgnored(
      [s('Mateus', 'correctness'), s('Mateus', 'style'), s('mateus', 'correctness')],
      [{ category: 'correctness', original: 'Mateus' }],
    );
    expect(out.map((x) => `${x.category}:${x.original}`)).toEqual([
      'style:Mateus',
      'correctness:mateus',
    ]);
  });

  it('validate what content scripts send', () => {
    expect(validRule({ category: 'tone', original: 'ASAP' })).toBe(true);
    expect(validRule({ category: 'nope', original: 'ASAP' })).toBe(false);
    expect(validRule({ category: 'tone', original: '' })).toBe(false);
    expect(validRule({ category: 'tone', original: 'x'.repeat(501) })).toBe(false);
    expect(validRule(null)).toBe(false);
  });
});
