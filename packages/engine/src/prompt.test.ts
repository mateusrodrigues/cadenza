import { createHash } from 'node:crypto';
import type { CheckSettings } from '@cadenza/shared';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt';

const base: CheckSettings = {
  dialect: 'en-GB',
  categories: ['correctness', 'clarity', 'style', 'tone'],
  explanations: true,
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('prompt v5', () => {
  // Hashes of the v3 system prompts, taken before v4. v3's eval results hold for every user
  // who sets no goals only while these match.
  it('is exactly v3 when no goals are set', () => {
    const v3 = {
      'true json_schema': 'ec878fa268226169280101930831077e853a6b311eead916a2ee5065d257c977',
      'true prompted': '22c06eb68e3a063cedd9ce674426ce0cf636bd432bddd356ab9bc1277ff5c079',
      'false json_schema': '4beedff8f7e7667faef243ebdd07b298e7518c1b803c676aa53cec8348f69b1c',
      'false prompted': 'c030a63cb4a086e4a908d89f04a3059dd64a2ce4d5068eb6a9379dc1383f731a',
    };
    for (const explanations of [true, false]) {
      for (const tier of ['json_schema', 'prompted'] as const) {
        const expected = v3[`${explanations} ${tier}`];
        const settings = { ...base, explanations };
        expect(sha(buildPrompt([], settings, tier).system)).toBe(expected);
        const anyGoals = { ...settings, goals: { formality: 'any', audience: 'any' } as const };
        expect(sha(buildPrompt([], anyGoals, tier).system)).toBe(expected);
      }
    }
  });

  it('adds goal lines only for the categories they affect', () => {
    const goals = { formality: 'formal', audience: 'general' } as const;
    const all = buildPrompt([], { ...base, goals }, 'json_schema').system;
    expect(all).toContain('formal, professional tone');
    expect(all).toContain('general readers');
    expect(all).toContain('Goals never justify rewording');

    const correctnessOnly = buildPrompt(
      [],
      { ...base, categories: ['correctness'], goals },
      'json_schema',
    ).system;
    expect(correctnessOnly).not.toContain('The writer wants');
    expect(correctnessOnly).not.toContain('The readers are');
  });
});
