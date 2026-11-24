import { checkParagraphs } from '@cadenza/engine';
import {
  createProvider,
  getPreset,
  type OutputTier,
  type Provider,
  ProviderError,
} from '@cadenza/providers';
import type { CheckMessage, CheckResponse, StatusResponse, WorkerMessage } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { loadSettings } from '../lib/settings';

/** In-flight checks by tab/frame/field; a newer request for a field aborts the older one. */
const inflight = new Map<string, AbortController>();
/** Output tier that worked last time, per provider+model, so failed tiers aren't retried. */
const tierCache = new Map<string, OutputTier>();
let providerCache: { key: string; provider: Provider } | null = null;

export default defineBackground(() => {
  // API keys live in storage.local; content scripts must never be able to read them.
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as WorkerMessage;
    // Only our own content scripts and pages may talk to the worker.
    if (sender.id !== browser.runtime.id) return false;
    if (msg?.type === 'cadenza/check') {
      handleCheck(msg, sender.tab?.id ?? -1, sender.frameId ?? 0).then(sendResponse);
      return true;
    }
    if (msg?.type === 'cadenza/status') {
      handleStatus().then(sendResponse);
      return true;
    }
    return false;
  });
});

async function handleCheck(
  msg: CheckMessage,
  tabId: number,
  frameId: number,
): Promise<CheckResponse> {
  const key = `${tabId}:${frameId}:${msg.fieldId}`;
  inflight.get(key)?.abort();
  const controller = new AbortController();
  inflight.set(key, controller);

  try {
    const settings = await loadSettings();
    if (!settings.enabled) return { ok: true, suggestions: [] };
    const model = settings.provider.model;
    if (!model) return fail('config', 'Choose a model in Cadenza settings.');

    const provider = getProvider(settings.provider);
    const tierKey = `${settings.provider.presetId}|${settings.provider.baseURL}|${model}`;
    const outcome = await checkParagraphs({
      provider,
      model,
      paragraphs: msg.paragraphs,
      settings: settings.check,
      tier: tierCache.get(tierKey) ?? 'json_schema',
      signal: controller.signal,
    });
    tierCache.set(tierKey, outcome.tier);
    return { ok: true, suggestions: outcome.suggestions };
  } catch (err) {
    if (err instanceof ProviderError) return fail(err.kind, err.message);
    return fail('unknown', err instanceof Error ? err.message : String(err));
  } finally {
    if (inflight.get(key) === controller) inflight.delete(key);
  }
}

function getProvider(config: Parameters<typeof createProvider>[0]): Provider {
  const key = JSON.stringify(config);
  if (providerCache?.key !== key) providerCache = { key, provider: createProvider(config) };
  return providerCache.provider;
}

async function handleStatus(): Promise<StatusResponse> {
  const settings = await loadSettings();
  const preset = getPreset(settings.provider.presetId);
  return {
    enabled: settings.enabled,
    provider: {
      id: settings.provider.presetId,
      label: preset?.label ?? 'Custom endpoint',
      model: settings.provider.model,
    },
  };
}

function fail(kind: string, message: string): CheckResponse {
  return { ok: false, error: { kind, message }, cancelled: kind === 'cancelled' };
}
