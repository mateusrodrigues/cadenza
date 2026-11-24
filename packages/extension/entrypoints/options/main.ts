import { checkParagraphs, splitParagraphs } from '@cadenza/engine';
import {
  createProvider,
  getPreset,
  PRESETS,
  type ProviderConfig,
  ProviderError,
} from '@cadenza/providers';
import { browser } from 'wxt/browser';
import { loadSettings, type Settings, saveSettings } from '../../lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const presetSelect = $<HTMLSelectElement>('preset');
const baseUrl = $<HTMLInputElement>('base-url');
const apiKey = $<HTMLInputElement>('api-key');
const modelSelect = $<HTMLSelectElement>('model');
const explanations = $<HTMLInputElement>('explanations');
const message = $<HTMLParagraphElement>('message');

// Only providers whose adapters exist so far are offered; the rest arrive in Phase 2.
const AVAILABLE = PRESETS.filter((p) => p.kind === 'openai-compatible' || p.kind === 'mock');

let settings: Settings;

function say(text: string, kind: 'info' | 'ok' | 'error' = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
}

function currentConfig(): ProviderConfig {
  const preset = getPreset(presetSelect.value);
  return {
    presetId: presetSelect.value,
    kind: preset?.kind ?? 'openai-compatible',
    baseURL: baseUrl.value.trim(),
    apiKey: apiKey.value.trim() || null,
    model: modelSelect.value || null,
    ...(preset?.extraHeaders ? { extraHeaders: preset.extraHeaders } : {}),
  };
}

function setModels(ids: string[], selected: string | null) {
  const all = selected && !ids.includes(selected) ? [selected, ...ids] : ids;
  modelSelect.replaceChildren(...all.map((id) => new Option(id, id, false, id === selected)));
}

function applyPreset(id: string, keepValues: boolean) {
  const preset = getPreset(id);
  const isMock = preset?.kind === 'mock';
  baseUrl.disabled = isMock;
  apiKey.disabled = isMock;
  if (!keepValues) {
    baseUrl.value = preset?.baseURL ?? '';
    apiKey.value = '';
    setModels(isMock ? ['mock-rules'] : [], isMock ? 'mock-rules' : null);
  }
}

/** Ask for access to the endpoint's origin. Must run inside the click/submit handler. */
async function requestOrigin(url: string): Promise<boolean> {
  if (!url) return true;
  try {
    const origin = `${new URL(url).origin}/*`;
    return await browser.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

async function loadModels() {
  const config = currentConfig();
  if (config.kind !== 'mock' && !(await requestOrigin(config.baseURL))) {
    say('Cadenza needs permission to reach that endpoint.', 'error');
    return;
  }
  say('Loading models…');
  try {
    const models = await createProvider(config).listModels();
    setModels(
      models.map((m) => m.id),
      modelSelect.value || models[0]?.id || null,
    );
    say(`Found ${models.length} model${models.length === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    say(describe(err), 'error');
  }
}

async function test() {
  const config = currentConfig();
  if (!config.model) return say('Choose a model first.', 'error');
  if (config.kind !== 'mock' && !(await requestOrigin(config.baseURL))) {
    return say('Cadenza needs permission to reach that endpoint.', 'error');
  }
  say('Checking a sample sentence… local models can take a minute.');
  const t0 = performance.now();
  try {
    const outcome = await checkParagraphs({
      provider: createProvider(config),
      model: config.model,
      paragraphs: splitParagraphs('Their going to the store tomorow.'),
      settings: { ...settings.check, explanations: explanations.checked },
    });
    const seconds = ((performance.now() - t0) / 1000).toFixed(1);
    const found = outcome.suggestions.map((s) => `"${s.original}" → "${s.replacement}"`);
    say(
      `Works. ${seconds}s, ${found.length} suggestion${found.length === 1 ? '' : 's'}` +
        `${found.length ? `: ${found.join(', ')}` : ''}. Output mode: ${outcome.tier}.`,
      'ok',
    );
  } catch (err) {
    say(describe(err), 'error');
  }
}

function describe(err: unknown): string {
  if (err instanceof ProviderError) {
    switch (err.kind) {
      case 'auth':
        return 'The API key was rejected.';
      case 'network':
        return 'Could not reach the endpoint. Is the server running and the URL correct?';
      case 'not_found':
        return 'The endpoint or model was not found.';
      case 'rate_limited':
        return 'The provider is rate limiting requests. Try again shortly.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

async function init() {
  settings = await loadSettings();
  presetSelect.replaceChildren(
    ...AVAILABLE.map((p) => new Option(p.label, p.id, false, p.id === settings.provider.presetId)),
  );
  baseUrl.value = settings.provider.baseURL;
  apiKey.value = settings.provider.apiKey ?? '';
  setModels([], settings.provider.model);
  explanations.checked = settings.check.explanations;
  applyPreset(settings.provider.presetId, true);

  presetSelect.addEventListener('change', () => applyPreset(presetSelect.value, false));
  $('load-models').addEventListener('click', () => void loadModels());
  $('test').addEventListener('click', () => void test());
  $('provider-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const config = currentConfig();
    if (config.kind !== 'mock' && !(await requestOrigin(config.baseURL))) {
      say('Saved, but Cadenza was not allowed to reach that endpoint.', 'error');
    }
    settings = {
      ...settings,
      provider: config,
      check: { ...settings.check, explanations: explanations.checked },
    };
    await saveSettings(settings);
    if (message.dataset.kind !== 'error') say('Saved.', 'ok');
  });
}

void init();
