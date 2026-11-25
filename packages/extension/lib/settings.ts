import {
  getPreset,
  isLocalURL,
  type ProviderConfig,
  type ProviderPreset,
} from '@cadenza/providers';
import {
  CATEGORY_IDS,
  type Category,
  type CheckSettings,
  DEFAULT_GOALS,
  type Dialect,
  type Goals,
} from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { LockedError, readApiKeys, writeApiKeys } from './secrets';

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
  /** Whether a key is saved for it, so a locked key store can be told apart from no key. */
  hasKey?: boolean;
}

export interface Settings {
  version: 2;
  enabled: boolean;
  providers: SavedProvider[];
  activeProviderId: string | null;
  dialect: Dialect;
  categories: Category[];
  goals: Goals;
  /** Hostnames where Cadenza stays off (subdomains included, see sites.ts). */
  disabledSites: string[];
  /** The day (YYYY-MM-DD, local) each entry in `disabledSites` was turned off, for settings. */
  siteOffSince: Record<string, string>;
  /** Most checks a day sent to hosted providers; null for no limit. Local models are free. */
  dailyLimit: number | null;
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
  // New installs set up a provider in onboarding; test builds start on the built-in rules.
  providers: isTestBuild() ? [MOCK_PROVIDER] : [],
  activeProviderId: isTestBuild() ? MOCK_PROVIDER.id : null,
  dialect: 'en-US',
  categories: [...CATEGORY_IDS],
  goals: { ...DEFAULT_GOALS },
  disabledSites: [],
  siteOffSince: {},
  dailyLimit: null,
};

function isTestBuild(): boolean {
  return typeof __CADENZA_E2E__ !== 'undefined' && __CADENZA_E2E__;
}

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
    goals: settings.goals,
  };
}

/**
 * Marks settings loaded while the key store was locked (see secrets.ts): their providers have
 * no keys, so saving them must leave the stored keys alone. A symbol survives `{...settings}`.
 */
const KEYS_LOCKED = Symbol('keysLocked');
type Loaded = Settings & { [KEYS_LOCKED]?: true };

/** Settings were loaded while the API keys were locked with a passphrase. */
export function keysLocked(settings: Settings): boolean {
  return (settings as Loaded)[KEYS_LOCKED] === true;
}

/**
 * Settings are read and written only by extension pages and the service worker. API keys are
 * kept apart, in the extension origin's IndexedDB (see secrets.ts), and never in
 * `chrome.storage`; the worker also locks `storage.local` to trusted contexts.
 */
export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Record<string, unknown> | undefined;
  const settings: Loaded = migrate(stored);
  let keys: Record<string, string>;
  try {
    keys = await readApiKeys();
  } catch (err) {
    if (!(err instanceof LockedError)) throw err;
    settings[KEYS_LOCKED] = true;
    keys = {};
  }
  for (const p of settings.providers) p.apiKey = keys[p.id] ?? p.apiKey ?? null;
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const locked = keysLocked(settings);
  if (!locked) {
    const keys: Record<string, string> = {};
    for (const p of settings.providers) if (p.apiKey) keys[p.id] = p.apiKey;
    // Keys first, so a key is never only in the old copy of the settings.
    await writeApiKeys(keys);
  } else if (settings.providers.some((p) => p.apiKey)) {
    throw new LockedError();
  }
  await browser.storage.local.set({
    [KEY]: {
      ...settings,
      providers: settings.providers.map((p) => ({
        ...p,
        apiKey: null,
        hasKey: locked ? (p.hasKey ?? false) : !!p.apiKey,
      })),
    },
  });
}

/** Changes from this page, in order; see `updateSettings`. */
let pending: Promise<unknown> = Promise.resolve();

/**
 * Change one part of the settings, starting from what is stored now. Changes made on the same
 * page run one after another, so two quick changes (a formality pill, then the audience) can't
 * both start from the old settings and lose the first.
 */
export function updateSettings(change: (s: Settings) => Settings | void): Promise<Settings> {
  const run = pending.then(async () => {
    const s = await loadSettings();
    const next = change(s) ?? s;
    await saveSettings(next);
    return next;
  });
  pending = run.catch(() => {});
  return run;
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

/** Providers that bill per use (not local models or the test rules); the daily limit counts these. */
export function isHosted(p: SavedProvider): boolean {
  return p.kind !== 'mock' && !getPreset(p.presetId)?.local && !isLocalURL(p.baseURL);
}
