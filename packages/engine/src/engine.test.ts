import {
  type CompletionRequest,
  MockProvider,
  type Provider,
  ProviderError,
} from '@cadenza/providers';
import { DEFAULT_CHECK_SETTINGS } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import { anchorSuggestions, refine } from './anchor.js';
import { checkParagraphs } from './check.js';
import { splitParagraphs } from './paragraphs.js';
import { parseModelOutput, parseTruncatedOutput } from './parse.js';

describe('splitParagraphs', () => {
  it('splits on newlines with absolute offsets and skips blank lines', () => {
    const text = 'First line.\n\n  \nSecond line.';
    const ps = splitParagraphs(text);
    expect(ps.map((p) => p.text)).toEqual(['First line.', 'Second line.']);
    expect(ps.map((p) => text.slice(p.start, p.start + p.text.length))).toEqual([
      'First line.',
      'Second line.',
    ]);
  });

  it('keeps ids stable when other paragraphs change, and unique for duplicates', () => {
    const a = splitParagraphs('Hello.\nWorld.');
    const b = splitParagraphs('Changed.\nWorld.');
    expect(a[1]?.pid).toBe(b[1]?.pid);
    const dup = splitParagraphs('Same.\nSame.');
    expect(dup[0]?.pid).not.toBe(dup[1]?.pid);
  });
});

describe('parseModelOutput', () => {
  it('accepts plain JSON, fenced JSON, and JSON surrounded by prose', () => {
    const json = '{"suggestions":[{"a":1}]}';
    expect(parseModelOutput(json)).toEqual([{ a: 1 }]);
    expect(parseModelOutput(`\`\`\`json\n${json}\n\`\`\``)).toEqual([{ a: 1 }]);
    expect(parseModelOutput(`Here you go:\n${json}\nHope that helps!`)).toEqual([{ a: 1 }]);
  });

  it('returns null when there is no usable object', () => {
    expect(parseModelOutput('no json here')).toBeNull();
    expect(parseModelOutput('{"other": []}')).toBeNull();
    expect(parseModelOutput('{"suggestions": [')).toBeNull();
  });
});

describe('parseTruncatedOutput', () => {
  it('keeps the items completed before the output was cut off', () => {
    const text =
      '{"suggestions":[{"pid":"p","original":"a}\\"b","replacement":"c"},{"pid":"p","original":"d","replacement":"e"},{"pid":"p","orig';
    expect(parseTruncatedOutput(text)).toEqual([
      { pid: 'p', original: 'a}"b', replacement: 'c' },
      { pid: 'p', original: 'd', replacement: 'e' },
    ]);
  });

  it('returns null when no item is complete', () => {
    expect(parseTruncatedOutput('{"suggestions":[{"pid":"p","orig')).toBeNull();
    expect(parseTruncatedOutput('nothing')).toBeNull();
  });
});

describe('refine', () => {
  it('leaves short originals alone', () => {
    expect(refine('tomorow', 'tomorrow')).toEqual([
      { start: 0, end: 7, original: 'tomorow', replacement: 'tomorrow' },
    ]);
  });

  it('splits a whole-sentence rewrite into minimal edits', () => {
    const original = 'Their going to the store tomorow to by some groceries.';
    const replacement = "They're going to the store tomorrow to buy some groceries.";
    const edits = refine(original, replacement);
    expect(edits.map((e) => [e.original, e.replacement])).toEqual([
      ['Their', "They're"],
      ['tomorow', 'tomorrow'],
      ['by', 'buy'],
    ]);
    for (const e of edits) expect(original.slice(e.start, e.end)).toBe(e.original);
  });

  it('keeps changes with no unchanged word between them together', () => {
    const edits = refine(
      'He suggested me to apply for the job.',
      'He suggested that I apply for the job.',
    );
    expect(edits.map((e) => [e.original, e.replacement])).toEqual([['me to', 'that I']]);
  });

  it('never splits a clarity, style or tone rewrite, only trims it', () => {
    const original = "I just feel like maybe this isn't the best approach, but I could be wrong.";
    const replacement = 'I feel this may not be the best approach, but I could be wrong.';
    const edits = refine(original, replacement, 'tone');
    expect(edits).toHaveLength(1);
    expect(edits[0]?.original).toBe("just feel like maybe this isn't");
    expect(edits[0]?.replacement).toBe('feel this may not be');
    const splitAsCorrectness = refine(original, replacement, 'correctness');
    expect(splitAsCorrectness.length).toBeGreaterThan(1);
  });

  it('attaches pure insertions to the previous word', () => {
    const original = 'I went to the store and bought milk.';
    const edits = refine(original, 'I went to the store, and bought milk.');
    expect(edits).toHaveLength(1);
    const [e] = edits;
    expect(e?.original).toBe('store');
    expect(e?.replacement).toBe('store,');
  });
});

describe('anchorSuggestions', () => {
  const paragraphs = splitParagraphs('A cat and a cat.\nTeh end.');
  const [p1, p2] = paragraphs;

  it('anchors by occurrence and computes absolute offsets', () => {
    const out = anchorSuggestions(
      [
        { pid: p1?.pid, original: 'cat', replacement: 'dog', category: 'style', occurrence: 2 },
        { pid: p2?.pid, original: 'Teh', replacement: 'The', category: 'correctness' },
      ],
      paragraphs,
    );
    expect(out.map((s) => [s.start, s.end, s.replacement])).toEqual([
      [12, 15, 'dog'],
      [17, 20, 'The'],
    ]);
  });

  it('drops invalid, unfound, and no-op items', () => {
    const out = anchorSuggestions(
      [
        { pid: p1?.pid, original: 'zebra', replacement: 'x', category: 'style' },
        { pid: p1?.pid, original: 'cat', replacement: 'cat', category: 'style' },
        { pid: 'nope', original: 'cat', replacement: 'dog', category: 'style' },
        { pid: p1?.pid, original: 'cat', replacement: 'dog', category: 'not-a-category' },
        'garbage',
      ],
      paragraphs,
    );
    expect(out).toEqual([]);
  });

  it('drops deletions that would remove more than a wrong word', () => {
    const del = (text: string, original: string, category = 'correctness') => {
      const ps = splitParagraphs(text);
      const stats = { dropped: 0 };
      const out = anchorSuggestions(
        [{ pid: ps[0]?.pid, original, replacement: '', category }],
        ps,
        stats,
      );
      return { kept: out.map((s) => s.original), dropped: stats.dropped };
    };
    // The whole paragraph, a sentence's ending, a multi-word correctness phrase.
    expect(del('Do you want to come with us.', 'Do you want to come with us.')).toEqual({
      kept: [],
      dropped: 1,
    });
    expect(del('It is due Wednesday afternoon.', 'afternoon.', 'style').dropped).toBe(1);
    expect(del('Send the the link.', 'the the').dropped).toBe(1);
    expect(del('We discussed about it.', 'discussed about').dropped).toBe(1);
    // One wrong word, a filler word, a whole extra sentence of tone.
    expect(del('Send the the link.', 'the').kept).toEqual(['the']);
    expect(del('It was really good.', 'really', 'style').kept).toEqual(['really']);
    expect(del('Could you look? Sorry again!', 'Sorry again!', 'tone').kept).toEqual([
      'Sorry again!',
    ]);
  });

  it('resolves overlaps in favor of correctness', () => {
    const out = anchorSuggestions(
      [
        { pid: p2?.pid, original: 'Teh end', replacement: 'The finish', category: 'style' },
        { pid: p2?.pid, original: 'Teh', replacement: 'The', category: 'correctness' },
      ],
      paragraphs,
    );
    expect(out.map((s) => s.category)).toEqual(['correctness']);
  });
});

describe('checkParagraphs', () => {
  it('runs end to end with the mock provider', async () => {
    const paragraphs = splitParagraphs('Their going tomorow.\nThis is very unique.');
    const outcome = await checkParagraphs({
      provider: new MockProvider({ delayMs: 0 }),
      model: 'mock-rules',
      paragraphs,
      settings: DEFAULT_CHECK_SETTINGS,
    });
    expect(outcome.suggestions.map((s) => [s.original, s.replacement, s.category])).toEqual([
      ['Their going', "They're going", 'correctness'],
      ['tomorow', 'tomorrow', 'correctness'],
      ['very unique', 'unique', 'style'],
    ]);
  });

  it('falls back to a lower output tier when the provider rejects one', async () => {
    const tiers: string[] = [];
    const provider: Provider = {
      kind: 'openai-compatible',
      listModels: async () => [],
      complete: async (req: CompletionRequest) => {
        tiers.push(req.tier);
        if (req.tier === 'json_schema') throw new ProviderError('unsupported_output', 'no schema');
        return { text: '```json\n{"suggestions": []}\n```', usage: null, truncated: false };
      },
    };
    const outcome = await checkParagraphs({
      provider,
      model: 'm',
      paragraphs: splitParagraphs('Fine text.'),
      settings: DEFAULT_CHECK_SETTINGS,
    });
    expect(tiers).toEqual(['json_schema', 'json_object']);
    expect(outcome.tier).toBe('json_object');
  });

  it('reports bad output instead of silently returning nothing', async () => {
    const provider: Provider = {
      kind: 'openai-compatible',
      listModels: async () => [],
      complete: async () => ({ text: 'Sorry, I cannot.', usage: null, truncated: false }),
    };
    await expect(
      checkParagraphs({
        provider,
        model: 'm',
        paragraphs: splitParagraphs('Text.'),
        settings: DEFAULT_CHECK_SETTINGS,
      }),
    ).rejects.toMatchObject({ kind: 'bad_output' });
  });
});
