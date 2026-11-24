import { OpenAICompatibleProvider } from '@cadenza/providers';
import { DEFAULT_CHECK_SETTINGS } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import { checkParagraphs } from './check.js';
import { splitParagraphs } from './paragraphs.js';

/**
 * Runs against a real OpenAI-compatible server. Skipped unless configured:
 *   CADENZA_LIVE_BASE_URL=http://127.0.0.1:8360/v1 CADENZA_LIVE_MODEL=phi4-14b npx vitest run live
 * Optional: CADENZA_LIVE_API_KEY, CADENZA_LIVE_EXPLANATIONS=0
 */
const baseURL = process.env.CADENZA_LIVE_BASE_URL;
const model = process.env.CADENZA_LIVE_MODEL;

describe.skipIf(!baseURL || !model)('live provider', () => {
  it('finds and anchors obvious mistakes, leaves clean text alone', {
    timeout: 15 * 60_000,
  }, async () => {
    const provider = new OpenAICompatibleProvider({
      presetId: 'custom',
      kind: 'openai-compatible',
      baseURL: baseURL ?? '',
      apiKey: process.env.CADENZA_LIVE_API_KEY ?? null,
      model: model ?? null,
    });
    const text =
      'Their going to the store tomorow to by some groceries.\n' +
      'The quarterly report is attached for your review.';
    const paragraphs = splitParagraphs(text);
    const t0 = performance.now();
    const outcome = await checkParagraphs({
      provider,
      model: model ?? '',
      paragraphs,
      settings: {
        ...DEFAULT_CHECK_SETTINGS,
        explanations: process.env.CADENZA_LIVE_EXPLANATIONS !== '0',
      },
    });
    const ms = Math.round(performance.now() - t0);
    console.log(
      JSON.stringify({ ms, tier: outcome.tier, usage: outcome.usage, dropped: outcome.dropped }),
    );
    for (const s of outcome.suggestions) {
      console.log(`${s.category}\t${s.original} → ${s.replacement}\t${s.explanation ?? ''}`);
      expect(text.slice(s.start, s.end)).toBe(s.original);
    }
    const replacements = outcome.suggestions.map((s) => s.replacement.toLowerCase());
    expect(replacements).toContain('tomorrow');
    const clean = paragraphs[1];
    expect(outcome.suggestions.filter((s) => s.pid === clean?.pid)).toEqual([]);
  });
});
