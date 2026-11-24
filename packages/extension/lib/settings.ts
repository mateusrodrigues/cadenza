import type { ProviderConfig } from '@cadenza/providers';
import { type CheckSettings, DEFAULT_CHECK_SETTINGS } from '@cadenza/shared';
import { browser } from 'wxt/browser';

export interface Settings {
  enabled: boolean;
  provider: ProviderConfig;
  check: CheckSettings;
  /** Hostnames where Cadenza stays off. */
  disabledSites: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  // Until onboarding exists (Phase 6), new installs start on the built-in test rules.
  provider: {
    presetId: 'mock',
    kind: 'mock',
    baseURL: '',
    apiKey: null,
    model: 'mock-rules',
  },
  check: DEFAULT_CHECK_SETTINGS,
  disabledSites: [],
};

const KEY = 'settings';

/**
 * Settings, including API keys, are read and written only by extension pages and the service
 * worker. The content script never calls these functions; it receives suggestions only.
 */
export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    check: { ...DEFAULT_SETTINGS.check, ...stored?.check },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEY]: settings });
}
