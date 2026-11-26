import {
  CheckScheduler,
  checkParagraphs,
  hash,
  PROMPT_VERSION,
  RequestLimiter,
  splitParagraphs,
} from '@cadenza/engine';
import {
  createProvider,
  getPreset,
  isLocalURL,
  type OutputTier,
  type Provider,
  type ProviderConfig,
  ProviderError,
  type ThinkingMode,
} from '@cadenza/providers';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { addWord, loadDictionary, removeWord, withoutDictionary } from '../lib/dictionary';
import { addIgnored, loadIgnored, removeIgnored, withoutIgnored } from '../lib/ignored';
import type {
  AllowOriginResponse,
  CheckMessage,
  CheckResponse,
  ContentMessage,
  GateResponse,
  KeyboardMessage,
  ListModelsResponse,
  OffReason,
  PageMessage,
  RefreshMessage,
  StatusResponse,
  TabStateMessage,
  TestResponse,
  WorkerError,
} from '../lib/messages';
import { allowOrigin } from '../lib/origin-rules';
import { lockState } from '../lib/secrets';
import { sessionCacheStore } from '../lib/session-cache';
import {
  activeProvider,
  checkSettingsFor,
  FIELD_KINDS,
  type FieldKind,
  isHosted,
  keysLocked,
  loadSettings,
  type SavedProvider,
  type Settings,
  saveSettings,
  thinkingFor,
  updateSettings,
} from '../lib/settings';
import { hostOf, siteIsOff, unsupportedEditor } from '../lib/sites';
import { checksToday, loadUsage, recordUsage } from '../lib/usage';

const scheduler = new CheckScheduler(2000, sessionCacheStore);
/** Output tier that worked last time, per provider+model, so failed tiers aren't retried. */
const tierCache = new Map<string, OutputTier>();
let providerCache: { key: string; provider: Provider } | null = null;

const TEST_TEXT = 'Their going to the store tomorow.';

export default defineBackground(() => {
  // Content scripts never need storage. API keys aren't kept there (see lib/secrets.ts), but lock
  // it anyway, and move keys out of settings saved by earlier versions.
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  // The default for session storage, which holds the unlocked passphrase key; made explicit.
  void browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void moveLegacyKeys();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    // Test builds start set up (see settings.ts) and shouldn't open extra tabs.
    if (reason === 'install' && !__CADENZA_E2E__) {
      void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
    }
  });

  void browser.action.setBadgeBackgroundColor({ color: '#17211E' }).catch(() => {});
  void browser.action.setBadgeTextColor?.({ color: '#FFFFFF' })?.catch(() => {});
  void showEnabled();
  // A page that navigates starts without its old count.
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'loading') return;
    void browser.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    void loadSettings().then(({ enabled }) =>
      browser.action
        .setIcon({ tabId, path: enabled ? ICONS.normal : ICONS.paused })
        .catch(() => {}),
    );
  });

  // Open fields check again when something that changes their results changes.
  browser.storage.local.onChanged.addListener((changes) => {
    if (changes.settings) void showEnabled();
    if (changes.settings || changes.ignored || changes.dictionary) refreshTabs();
  });
  browser.storage.session.onChanged.addListener((changes) => {
    if (changes.unlockKey) refreshTabs();
  });

  // The keyboard shortcut goes to the active tab; the frame holding the focused field answers.
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'open-suggestion' || tab?.id === undefined) return;
    const message: KeyboardMessage = { type: 'cadenza/keyboard' };
    browser.tabs.sendMessage(tab.id, message).catch(() => {});
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const fromExtensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) ?? false;
    const msg = message as ContentMessage | PageMessage;
    const reply = (p: Promise<unknown>) => {
      p.then(sendResponse, (err) => sendResponse({ ok: false, error: toWorkerError(err) }));
      return true;
    };

    switch (msg?.type) {
      case 'cadenza/gate':
        return reply(
          loadSettings().then(
            (s): GateResponse => ({ off: offReason(s, msg.site, sender.url, msg.kind) }),
          ),
        );
      case 'cadenza/check':
        return reply(
          handleCheck(msg, `${sender.tab?.id ?? -1}:${sender.frameId ?? 0}`, sender.url),
        );
      case 'cadenza/forget':
        scheduler.forget(`${sender.tab?.id ?? -1}:${sender.frameId ?? 0}:${msg.fieldId}`);
        return false;
      case 'cadenza/ignore':
        return reply(addIgnored(msg.rule, msg.site).then((ok) => ({ ok })));
      case 'cadenza/unignore':
        return reply(removeIgnored(msg.rule).then((ok) => ({ ok })));
      case 'cadenza/add-word':
        return reply(addWord(msg.word).then((ok) => ({ ok })));
      case 'cadenza/remove-word':
        return reply(removeWord(msg.word).then((ok) => ({ ok })));
      case 'cadenza/tab-state':
        if (sender.tab?.id !== undefined) showTabState(sender.tab.id, msg);
        return false;
    }
    // Everything below handles keys or settings: extension pages only, never content scripts.
    if (!fromExtensionPage) return false;
    switch (msg?.type) {
      case 'cadenza/status':
        return reply(handleStatus());
      case 'cadenza/list-models':
        return reply(handleListModels(msg.config));
      case 'cadenza/test':
        return reply(handleTest(msg.config, msg.explanations, msg.thinking));
      case 'cadenza/allow-origin':
        return reply(allowOrigin(msg.origin).then((): AllowOriginResponse => ({ ok: true })));
    }
    return false;
  });
});

async function handleCheck(
  msg: CheckMessage,
  frameKey: string,
  frameURL: string | undefined,
): Promise<CheckResponse> {
  if (__CADENZA_E2E__) checksReceived++;
  const settings = await loadSettings();
  const provider = activeProvider(settings);
  // Content scripts ask first (cadenza/gate) and send no text when off; this is the backstop.
  const off = offReason(settings, msg.site, frameURL, msg.kind);
  if (off || !provider) {
    return { ok: true, suggestions: [], pending: 0, slow: false, off: off ?? 'setup' };
  }
  const model = provider.model;
  if (!model) return fail({ kind: 'config', message: 'Choose a model in Cadenza settings.' });
  if (provider.hasKey && keysLocked(settings)) {
    return fail({
      kind: 'locked',
      message: 'Cadenza is locked. Click the Cadenza icon in the toolbar to unlock it.',
    });
  }

  const check = checkSettingsFor(settings, provider);
  const thinking = thinkingFor(provider);
  const configKey = hash(
    JSON.stringify([provider.presetId, provider.baseURL, model, check, thinking, PROMPT_VERSION]),
  );
  const tierKey = `${provider.presetId}|${provider.baseURL}|${model}`;
  const instance = getProvider(provider);
  try {
    const result = await scheduler.check({
      requester: `${frameKey}:${msg.fieldId}`,
      configKey,
      paragraphs: msg.paragraphs,
      ...(msg.priority ? { priority: msg.priority } : {}),
      ...(provider.slowMode ? { maxNew: 1 } : {}),
      run: async (paragraphs, signal) => {
        // Only requests count against the limit: cached paragraphs still show.
        await checkDailyLimit(settings, provider);
        return limiterFor(tierKey, provider).run(async (s) => {
          const outcome = await checkParagraphs({
            provider: instance,
            model,
            paragraphs,
            settings: check,
            tier: tierCache.get(tierKey) ?? 'json_schema',
            ...(thinking ? { thinking } : {}),
            signal: s,
          });
          void recordUsage(provider, outcome.usage);
          if (outcome.reasoned && !thinking) void rememberThinking(provider.id, model);
          return outcome;
        }, signal);
      },
    });
    if (result.outcome) tierCache.set(tierKey, result.outcome.tier);
    return {
      ok: true,
      // Filtered here rather than cached, so removing a rule or word brings suggestions back.
      suggestions: withoutDictionary(
        withoutIgnored(result.suggestions, await loadIgnored()),
        await loadDictionary(),
      ),
      pending: result.pending,
      slow: provider.slowMode,
    };
  } catch (err) {
    return fail(toWorkerError(err));
  }
}

/** Tests read this to prove no text was sent while Cadenza was off. */
let checksReceived = 0;
if (__CADENZA_E2E__) {
  (globalThis as { cadenzaChecksReceived?: () => number }).cadenzaChecksReceived = () =>
    checksReceived;
}

/**
 * Why Cadenza is off for a page, or null when it's on. Looks at the tab's site and the frame's
 * own (an editor embedded from a site the user turned off).
 */
function offReason(
  settings: Settings,
  site: unknown,
  frameURL: string | undefined,
  kind: unknown,
): OffReason | null {
  if (!settings.enabled) return 'disabled';
  // The content script stays out of these; this is the backstop.
  if (unsupportedEditor(frameURL)) return 'site';
  const sites = [typeof site === 'string' ? site : null, hostOf(frameURL)];
  if (sites.some((h) => h && siteIsOff(h, settings.disabledSites))) return 'site';
  if (FIELD_KINDS.includes(kind as FieldKind) && !settings.fieldKinds[kind as FieldKind]) {
    return 'kind';
  }
  if (!activeProvider(settings)) return 'setup';
  return null;
}

async function handleStatus(): Promise<StatusResponse> {
  const settings = await loadSettings();
  const p = activeProvider(settings);
  return {
    enabled: settings.enabled,
    provider: p ? { name: p.name, model: p.model, slowMode: p.slowMode } : null,
    locked: (await lockState()) === 'locked',
  };
}

async function handleListModels(config: ProviderConfig): Promise<ListModelsResponse> {
  try {
    return { ok: true, models: await createProvider(config).listModels() };
  } catch (err) {
    return { ok: false, error: toWorkerError(err) };
  }
}

/**
 * The model thought before it answered: remember it, so the thinking switch shows in settings
 * and checks ask it not to think until the user turns thinking on. Open fields check again.
 */
async function rememberThinking(providerId: string, model: string): Promise<void> {
  await updateSettings((s) => {
    const p = s.providers.find((x) => x.id === providerId);
    if (p && p.model === model) p.thinkingModel = model;
  }).catch(() => {});
}

async function handleTest(
  config: ProviderConfig,
  explanations: boolean,
  thinking: ThinkingMode | undefined,
): Promise<TestResponse> {
  if (!config.model) return { ok: false, error: { kind: 'config', message: 'Choose a model.' } };
  const settings = await loadSettings();
  const t0 = performance.now();
  try {
    const outcome = await checkParagraphs({
      provider: createProvider(config),
      model: config.model,
      paragraphs: splitParagraphs(TEST_TEXT),
      settings: {
        dialect: settings.dialect,
        categories: settings.categories,
        explanations,
        goals: settings.goals,
      },
      ...(thinking ? { thinking } : {}),
    });
    return {
      ok: true,
      ms: Math.round(performance.now() - t0),
      tier: outcome.tier,
      found: outcome.suggestions.map(({ original, replacement }) => ({ original, replacement })),
      reasoned: outcome.reasoned,
      thinkingFellBack: outcome.thinkingFellBack,
    };
  } catch (err) {
    return { ok: false, error: toWorkerError(err) };
  }
}

function getProvider(config: ProviderConfig): Provider {
  const key = JSON.stringify(config);
  if (providerCache?.key !== key) providerCache = { key, provider: createProvider(config) };
  return providerCache.provider;
}

class DailyLimitError extends Error {}

async function checkDailyLimit(settings: Settings, provider: SavedProvider): Promise<void> {
  const limit = settings.dailyLimit;
  if (limit === null || !isHosted(provider)) return;
  const hosted = new Set(settings.providers.filter(isHosted).map((p) => p.id));
  if (checksToday(await loadUsage(), hosted) >= limit) {
    throw new DailyLimitError(
      `Today's limit of ${limit} checks is reached. You can change it in Cadenza settings.`,
    );
  }
}

// ---- Toolbar icon ---------------------------------------------------------------------------

const ICONS = {
  normal: { 16: '/icon/16.png', 32: '/icon/32.png' },
  paused: { 16: '/icon/paused-16.png', 32: '/icon/paused-32.png' },
  error: { 16: '/icon/error-16.png', 32: '/icon/error-32.png' },
};

/** The toolbar icon follows the focused field: its count, paused, or an error. */
function showTabState(tabId: number, msg: TabStateMessage): void {
  const count = msg.state === 'done' ? msg.count : 0;
  const text = count > 99 ? '99+' : count > 0 ? String(count) : '';
  const icon =
    msg.state === 'paused' ? ICONS.paused : msg.state === 'error' ? ICONS.error : ICONS.normal;
  void browser.action.setBadgeText({ tabId, text }).catch(() => {});
  void browser.action.setIcon({ tabId, path: icon }).catch(() => {});
}

/** Switched off everywhere: the default icon shows paused; tabs reset on their next page. */
async function showEnabled(): Promise<void> {
  const { enabled } = await loadSettings();
  await browser.action.setIcon({ path: enabled ? ICONS.normal : ICONS.paused }).catch(() => {});
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Ask content scripts in every tab to check their fields again (coalesced). */
function refreshTabs(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const message: RefreshMessage = { type: 'cadenza/refresh' };
    for (const tab of await browser.tabs.query({})) {
      if (tab.id !== undefined) browser.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  }, 150);
}

function toWorkerError(err: unknown): WorkerError {
  if (err instanceof DailyLimitError) return { kind: 'limit', message: err.message };
  if (err instanceof ProviderError)
    return { kind: err.kind, message: err.message, status: err.status };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

/**
 * Errors go to content scripts, and the badge shows them in the page's DOM. Provider messages
 * can echo request details (some quote part of the API key on auth errors), so the page only
 * ever gets a fixed message for the kind of error; settings shows the provider's own words.
 */
function fail(error: WorkerError): CheckResponse {
  const safe: WorkerError = { kind: error.kind, message: pageMessage(error), status: error.status };
  return { ok: false, error: safe, cancelled: error.kind === 'cancelled' };
}

const PAGE_MESSAGES: Record<string, string> = {
  auth: 'The API key was rejected. Check it in Cadenza settings.',
  rate_limited: 'The provider is limiting requests. Cadenza will try again.',
  context_too_long: 'This text is too long for the model.',
  bad_output: 'The model’s reply couldn’t be used.',
  refused: 'The model declined to check this text.',
  not_found: 'The model or endpoint was not found. Check Cadenza settings.',
  network: 'Couldn’t reach the provider.',
  unavailable: 'The provider is having problems. Try again later.',
  cancelled: 'Cancelled.',
};

function pageMessage(error: WorkerError): string {
  // Messages Cadenza wrote itself (config, locked, limit) are safe to pass on.
  if (['config', 'locked', 'limit'].includes(error.kind)) return error.message;
  return PAGE_MESSAGES[error.kind] ?? 'Couldn’t check this text. See Cadenza settings.';
}

/** Settings saved before keys moved to IndexedDB still hold them in `storage.local`. */
async function moveLegacyKeys(): Promise<void> {
  const stored = (await browser.storage.local.get('settings')).settings as
    | { providers?: { apiKey?: string | null }[]; provider?: { apiKey?: string | null } }
    | undefined;
  const hasKey = stored?.provider?.apiKey || stored?.providers?.some((p) => p.apiKey);
  if (hasKey) await saveSettings(await loadSettings());
}

const limiters = new Map<string, RequestLimiter>();

/**
 * Local servers work through one request at a time anyway; queueing here lets a stale request
 * be dropped before it costs a minute of CPU. Hosted APIs get a few at once.
 */
function limiterFor(key: string, provider: SavedProvider): RequestLimiter {
  let limiter = limiters.get(key);
  if (!limiter) {
    const local = getPreset(provider.presetId)?.local || isLocalURL(provider.baseURL);
    limiter = new RequestLimiter(local ? 1 : 4);
    limiters.set(key, limiter);
  }
  return limiter;
}
