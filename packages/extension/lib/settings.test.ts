import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MOCK_PROVIDER, migrate, thinkingFor } from './settings';

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
});

describe('thinkingFor', () => {
  const p = { ...MOCK_PROVIDER, model: 'm' };

  it('asks nothing until the model has been seen thinking', () => {
    expect(thinkingFor(p)).toBeUndefined();
    expect(thinkingFor({ ...p, thinking: true })).toBeUndefined();
    expect(thinkingFor({ ...p, thinkingModel: 'other' })).toBeUndefined();
  });

  it("then follows the user's choice, off by default", () => {
    expect(thinkingFor({ ...p, thinkingModel: 'm' })).toBe('off');
    expect(thinkingFor({ ...p, thinkingModel: 'm', thinking: true })).toBe('on');
  });
});
