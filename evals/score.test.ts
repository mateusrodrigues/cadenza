import type { Suggestion } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import { isClean, loadCorpus, type Sample, spanOf } from './corpus.js';
import { scoreSample, summarize } from './score.js';

const corpus = loadCorpus();

function suggestion(sample: Sample, original: string, replacement: string, occurrence = 1) {
  const span = spanOf(sample, { original, category: 'correctness', occurrence });
  return {
    id: 'x',
    pid: 'p0',
    ...span,
    original,
    replacement,
    category: 'correctness',
    subtype: 'test',
    explanation: null,
  } satisfies Suggestion;
}

const sample = (text: string, issues: Sample['issues']): Sample => ({ id: 't', text, issues });

describe('corpus', () => {
  it('has at least 150 samples, 40 of them clean, and every label is in its text', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(150);
    expect(corpus.filter(isClean).length).toBeGreaterThanOrEqual(40);
  });

  it('a model that returns exactly the labeled fixes scores perfectly', () => {
    const results = corpus.map((s) => ({
      id: s.id,
      ms: 1,
      suggestions: s.issues
        .filter((i) => !i.optional)
        .map((i) => suggestion(s, i.original, i.fix?.[0] ?? '', i.occurrence)),
    }));
    const summary = summarize(corpus, results);
    expect(summary.precision).toBe(1);
    expect(summary.cleanFps).toBe(0);
    for (const r of Object.values(summary.recall)) expect(r.found).toBe(r.issues);
    expect(summary.recall.correctness.fixed).toBe(summary.recall.correctness.issues);
  });
});

describe('scoreSample', () => {
  const s = sample('I went to the store, I bought some milk tomorow.', [
    { original: ', I', category: 'correctness', fix: ['; I', '. I'] },
    { original: 'tomorow', category: 'correctness', fix: ['tomorrow'] },
  ]);

  it('accepts a fix made with a wider or narrower span than the label', () => {
    const wide = suggestion(s, 'store, I', 'store; I');
    const narrow = suggestion(s, ',', ';');
    expect(scoreSample(s, [wide]).suggestions[0]?.verdict).toBe('tp');
    expect(scoreSample(s, [narrow]).suggestions[0]?.verdict).toBe('tp');
  });

  it('marks a wrong replacement on a correctness issue', () => {
    const r = scoreSample(s, [suggestion(s, 'tomorow', 'tomorows')]);
    expect(r.suggestions[0]?.verdict).toBe('wrong_fix');
    expect(r.issues[1]).toEqual({ category: 'correctness', found: true, fixed: false });
  });

  it('counts unlabeled suggestions as false positives and optional ones as neutral', () => {
    const t = sample('The meeting was cancelled today.', [
      { original: 'cancelled', category: 'correctness', fix: ['canceled'], optional: true },
    ]);
    const r = scoreSample(t, [
      suggestion(t, 'cancelled', 'canceled'),
      suggestion(t, 'today', 'now'),
    ]);
    expect(r.suggestions.map((x) => x.verdict)).toEqual(['neutral', 'fp']);
  });

  it('accepts deleting one word of a doubled word', () => {
    const t = sample('Send the the link.', [
      { original: 'the the', category: 'correctness', fix: ['the'] },
    ]);
    expect(scoreSample(t, [suggestion(t, 'the ', '')]).suggestions[0]?.verdict).toBe('tp');
  });

  it('counts a fix attached to the word next to the issue', () => {
    const t = sample('I bought new car.', [
      { original: 'new car', category: 'correctness', fix: ['a new car'] },
    ]);
    expect(scoreSample(t, [suggestion(t, 'bought', 'bought a')]).suggestions[0]?.verdict).toBe(
      'tp',
    );
    expect(scoreSample(t, [suggestion(t, 'I', 'We')]).suggestions[0]?.verdict).toBe('fp');
  });

  it('treats curly and straight apostrophes alike', () => {
    const t = sample('Its late.', [{ original: 'Its', category: 'correctness', fix: ["It's"] }]);
    expect(scoreSample(t, [suggestion(t, 'Its', 'It’s')]).suggestions[0]?.verdict).toBe('tp');
  });
});
