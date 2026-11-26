import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrate } from './settings';

describe('settings defaults', () => {
  it('starts with no provider outside test builds (onboarding sets one up)', () => {
    expect(DEFAULT_SETTINGS.providers).toEqual([]);
    expect(DEFAULT_SETTINGS.activeProviderId).toBeNull();
  });

  it('fills fields added later into settings saved by older versions', () => {
    const s = migrate({ version: 2, enabled: false, providers: [], activeProviderId: null });
    expect(s.enabled).toBe(false);
    expect(s.goals).toEqual({ formality: 'any', audience: 'any' });
    expect(s.dailyLimit).toBeNull();
    expect(s.disabledSites).toEqual([]);
    expect(s.fieldKinds).toEqual({ input: true, textarea: true, rich: true });
  });

  it('keeps one provider for each id (onboarding could save the same one twice)', () => {
    const p = (model: string) => ({
      id: 'dup',
      name: 'Ollama',
      presetId: 'ollama',
      kind: 'openai-compatible' as const,
      baseURL: 'http://localhost:11434/v1',
      apiKey: null,
      model,
      explanations: false,
      slowMode: true,
    });
    const other = { ...p('other-model'), id: 'other' };
    const s = migrate({
      version: 2,
      providers: [p('first'), other, p('second')],
      activeProviderId: 'dup',
    });
    expect(s.providers.map((x) => [x.id, x.model])).toEqual([
      ['dup', 'first'],
      ['other', 'other-model'],
    ]);
    expect(s.activeProviderId).toBe('dup');
  });
});
