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
} from '@cadenza/providers';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { addIgnored, loadIgnored, withoutIgnored } from '../lib/ignored';
import type {
  AllowOriginResponse,
  CheckMessage,
  CheckResponse,
  ContentMessage,
  ListModelsResponse,
  PageMessage,
  StatusResponse,
  TestResponse,
  WorkerError,
} from '../lib/messages';
import { allowOrigin } from '../lib/origin-rules';
import { sessionCacheStore } from '../lib/session-cache';
import {
  activeProvider,
  checkSettingsFor,
  loadSettings,
  type SavedProvider,
  saveSettings,
} from '../lib/settings';

const scheduler = new CheckScheduler(2000, sessionCacheStore);
/** Output tier that worked last time, per provider+model, so failed tiers aren't retried. */
const tierCache = new Map<string, OutputTier>();
let providerCache: { key: string; provider: Provider } | null = null;

const TEST_TEXT = 'Their going to the store tomorow.';

export default defineBackground(() => {
  // Content scripts never need storage. API keys aren't kept there (see lib/secrets.ts), but lock
  // it anyway, and move keys out of settings saved by earlier versions.
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void moveLegacyKeys();

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const fromExtensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) ?? false;
    const msg = message as ContentMessage | PageMessage;
    const reply = (p: Promise<unknown>) => {
      p.then(sendResponse, (err) => sendResponse({ ok: false, error: toWorkerError(err) }));
      return true;
    };

    switch (msg?.type) {
      case 'cadenza/check':
        return reply(handleCheck(msg, `${sender.tab?.id ?? -1}:${sender.frameId ?? 0}`));
      case 'cadenza/forget':
        scheduler.forget(`${sender.tab?.id ?? -1}:${sender.frameId ?? 0}:${msg.fieldId}`);
        return false;
      case 'cadenza/ignore':
        return reply(addIgnored(msg.rule).then((ok) => ({ ok })));
    }
    // Everything below handles keys or settings: extension pages only, never content scripts.
    if (!fromExtensionPage) return false;
    switch (msg?.type) {
      case 'cadenza/status':
        return reply(handleStatus());
      case 'cadenza/list-models':
        return reply(handleListModels(msg.config));
      case 'cadenza/test':
        return reply(handleTest(msg.config, msg.explanations));
      case 'cadenza/allow-origin':
        return reply(allowOrigin(msg.origin).then((): AllowOriginResponse => ({ ok: true })));
    }
    return false;
  });
});

async function handleCheck(msg: CheckMessage, frameKey: string): Promise<CheckResponse> {
  const settings = await loadSettings();
  const provider = activeProvider(settings);
  if (!settings.enabled || !provider) {
    return { ok: true, suggestions: [], pending: 0, slow: false };
  }
  const model = provider.model;
  if (!model) return fail({ kind: 'config', message: 'Choose a model in Cadenza settings.' });

  const check = checkSettingsFor(settings, provider);
  const configKey = hash(
    JSON.stringify([provider.presetId, provider.baseURL, model, check, PROMPT_VERSION]),
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
      run: (paragraphs, signal) =>
        limiterFor(tierKey, provider).run(
          (s) =>
            checkParagraphs({
              provider: instance,
              model,
              paragraphs,
              settings: check,
              tier: tierCache.get(tierKey) ?? 'json_schema',
              signal: s,
            }),
          signal,
        ),
    });
    if (result.outcome) tierCache.set(tierKey, result.outcome.tier);
    return {
      ok: true,
      // Filtered here rather than cached, so removing a rule brings its suggestions back.
      suggestions: withoutIgnored(result.suggestions, await loadIgnored()),
      pending: result.pending,
      slow: provider.slowMode,
    };
  } catch (err) {
    return fail(toWorkerError(err));
  }
}

async function handleStatus(): Promise<StatusResponse> {
  const settings = await loadSettings();
  const p = activeProvider(settings);
  return {
    enabled: settings.enabled,
    provider: p ? { name: p.name, model: p.model, slowMode: p.slowMode } : null,
  };
}

async function handleListModels(config: ProviderConfig): Promise<ListModelsResponse> {
  try {
    return { ok: true, models: await createProvider(config).listModels() };
  } catch (err) {
    return { ok: false, error: toWorkerError(err) };
  }
}

async function handleTest(config: ProviderConfig, explanations: boolean): Promise<TestResponse> {
  if (!config.model) return { ok: false, error: { kind: 'config', message: 'Choose a model.' } };
  const settings = await loadSettings();
  const t0 = performance.now();
  try {
    const outcome = await checkParagraphs({
      provider: createProvider(config),
      model: config.model,
      paragraphs: splitParagraphs(TEST_TEXT),
      settings: { dialect: settings.dialect, categories: settings.categories, explanations },
    });
    return {
      ok: true,
      ms: Math.round(performance.now() - t0),
      tier: outcome.tier,
      found: outcome.suggestions.map(({ original, replacement }) => ({ original, replacement })),
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

function toWorkerError(err: unknown): WorkerError {
  if (err instanceof ProviderError)
    return { kind: err.kind, message: err.message, status: err.status };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

function fail(error: WorkerError): CheckResponse {
  return { ok: false, error, cancelled: error.kind === 'cancelled' };
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
