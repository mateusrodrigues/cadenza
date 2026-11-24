import {
  getPreset,
  isLocalURL,
  type ProviderConfig,
  type ProviderPreset,
} from '@cadenza/providers';
import { CATEGORY_IDS, type Category, type CheckSettings, type Dialect } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { readApiKeys, writeApiKeys } from './secrets';

export interface SavedProvider extends ProviderConfig {
  id: string;
  /** Shown in the popup and provider list. */
  name: string;
  /** One sentence per suggestion. Off by default for slow models (costs many output tokens). */
  explanations: boolean;
  /**
   * For slow (usually local, CPU-bound) models: check one paragraph per request, wait longer
   * after typing, and let a running check finish while the user edits other paragraphs.
   */
  slowMode: boolean;
}

export interface Settings {
  version: 2;
  enabled: boolean;
  providers: SavedProvider[];
  activeProviderId: string | null;
  dialect: Dialect;
  categories: Category[];
  /** Hostnames where Cadenza stays off. */
  disabledSites: string[];
}

export const MOCK_PROVIDER: SavedProvider = {
  id: 'mock',
  name: 'Test rules (no AI)',
  presetId: 'mock',
  kind: 'mock',
  baseURL: '',
  apiKey: null,
  model: 'mock-rules',
  explanations: true,
  slowMode: false,
};

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  enabled: true,
  // Until onboarding exists (Phase 6), new installs start on the built-in test rules.
  providers: [MOCK_PROVIDER],
  activeProviderId: MOCK_PROVIDER.id,
  dialect: 'en-US',
  categories: [...CATEGORY_IDS],
  disabledSites: [],
};

const KEY = 'settings';

/** A new provider entry with sensible defaults for its preset. */
export function newProvider(preset: ProviderPreset, baseURL = preset.baseURL): SavedProvider {
  const slow = preset.local || isLocalURL(baseURL);
  return {
    id: crypto.randomUUID(),
    name: preset.label,
    presetId: preset.id,
    kind: preset.kind,
    baseURL,
    apiKey: null,
    model: preset.kind === 'mock' ? 'mock-rules' : null,
    ...(preset.extraHeaders ? { extraHeaders: preset.extraHeaders } : {}),
    explanations: !slow,
    slowMode: slow,
  };
}

export function activeProvider(settings: Settings): SavedProvider | null {
  return settings.providers.find((p) => p.id === settings.activeProviderId) ?? null;
}

export function checkSettingsFor(settings: Settings, provider: SavedProvider): CheckSettings {
  return {
    dialect: settings.dialect,
    categories: settings.categories,
    explanations: provider.explanations,
  };
}

/**
 * Settings are read and written only by extension pages and the service worker. API keys are
 * kept apart, in the extension origin's IndexedDB (see secrets.ts), and never in
 * `chrome.storage`; the worker also locks `storage.local` to trusted contexts.
 */
export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Record<string, unknown> | undefined;
  const settings = migrate(stored);
  const keys = await readApiKeys();
  for (const p of settings.providers) p.apiKey = keys[p.id] ?? p.apiKey ?? null;
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const keys: Record<string, string> = {};
  for (const p of settings.providers) if (p.apiKey) keys[p.id] = p.apiKey;
  // Keys first, so a key is never only in the old copy of the settings.
  await writeApiKeys(keys);
  await browser.storage.local.set({
    [KEY]: { ...settings, providers: settings.providers.map((p) => ({ ...p, apiKey: null })) },
  });
}

/** Bring stored settings of any earlier shape up to the current version. */
export function migrate(stored: Record<string, unknown> | undefined): Settings {
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  if (stored.version === 2) {
    return { ...structuredClone(DEFAULT_SETTINGS), ...(stored as Partial<Settings>), version: 2 };
  }
  // v1: a single `provider` plus `check` settings.
  const v1 = stored as {
    enabled?: boolean;
    provider?: ProviderConfig;
    check?: Partial<CheckSettings>;
    disabledSites?: string[];
  };
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.enabled = v1.enabled ?? true;
  settings.disabledSites = v1.disabledSites ?? [];
  if (v1.check?.dialect) settings.dialect = v1.check.dialect;
  if (v1.check?.categories) settings.categories = v1.check.categories;
  if (v1.provider && v1.provider.kind !== 'mock') {
    const preset = getPreset(v1.provider.presetId);
    const slow = (preset?.local ?? false) || isLocalURL(v1.provider.baseURL);
    const migrated: SavedProvider = {
      ...v1.provider,
      id: crypto.randomUUID(),
      name: preset?.label ?? 'Custom endpoint',
      explanations: v1.check?.explanations ?? !slow,
      slowMode: slow,
    };
    settings.providers.push(migrated);
    settings.activeProviderId = migrated.id;
  }
  return settings;
}
