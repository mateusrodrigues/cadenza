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
  });
});
