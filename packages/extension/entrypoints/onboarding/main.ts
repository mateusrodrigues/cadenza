import {
  type ModelInfo,
  PRESETS,
  type ProviderConfig,
  type ProviderPreset,
} from '@cadenza/providers';
import { browser } from 'wxt/browser';
import { explainError } from '../../lib/connect';
import type {
  ListModelsResponse,
  PageMessage,
  TestResponse,
  WorkerError,
} from '../../lib/messages';
import { FieldSession } from '../../lib/session';
import { newProvider, type SavedProvider, updateSettings } from '../../lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const steps = ['step-choose', 'step-hosted', 'step-local', 'step-model', 'step-done'] as const;
type Step = (typeof steps)[number];

const HOSTED = PRESETS.filter((p) => !p.local && p.id !== 'custom');
const LOCAL = PRESETS.filter((p) => p.local && p.kind !== 'mock');

/** The provider being set up. */
let provider: SavedProvider | null = null;
let back: Step = 'step-choose';
let fixAction: (() => Promise<void>) | null = null;
/** A `finish()` is running; a second click must not save the provider again. */
let finishing = false;

function show(step: Step) {
  for (const s of steps) $(s).hidden = s !== step;
  say('');
}

function say(text: string, kind: 'info' | 'ok' | 'error' = 'info') {
  const el = $('message');
  el.textContent = text;
  el.dataset.kind = kind;
  $('fix').hidden = true;
  fixAction = null;
}

function send<T>(message: PageMessage): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function configOf(p: SavedProvider): ProviderConfig {
  const { presetId, kind, baseURL, apiKey, model, extraHeaders } = p;
  return { presetId, kind, baseURL, apiKey, model, ...(extraHeaders ? { extraHeaders } : {}) };
}

function showError(error: WorkerError, retry: () => Promise<void>) {
  const problem = explainError(error, provider?.baseURL ?? '');
  say(problem.message, 'error');
  const fix = problem.fix;
  if (!fix) return;
  const button = $('fix');
  button.textContent = fix.label;
  button.hidden = false;
  fixAction = async () => {
    const failed = await fix.run();
    if (failed) return say(failed, 'error');
    await retry();
  };
}

// ---- Hosted --------------------------------------------------------------------------------

function setUpHosted() {
  const select = $<HTMLSelectElement>('hosted-preset');
  select.replaceChildren(...HOSTED.map((p) => new Option(p.label, p.id)));
  const link = $<HTMLAnchorElement>('key-link');
  const update = () => {
    const preset = HOSTED.find((p) => p.id === select.value);
    link.hidden = !preset?.helpURL;
    if (preset?.helpURL) link.href = preset.helpURL;
  };
  select.addEventListener('change', update);
  update();
  $('step-hosted').addEventListener('submit', (e) => {
    e.preventDefault();
    const preset = HOSTED.find((p) => p.id === select.value);
    const key = $<HTMLInputElement>('hosted-key').value.trim();
    if (!preset) return;
    if (!key) return say('Paste your API key.', 'error');
    provider = { ...newProvider(preset), apiKey: key };
    back = 'step-hosted';
    void loadModels();
  });
}

// ---- Local ---------------------------------------------------------------------------------

/** Is anything listening at this origin? An opaque no-cors reply is enough to know. */
async function listening(origin: string): Promise<boolean> {
  try {
    await fetch(`${origin}/`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    return true;
  } catch {
    return false;
  }
}

async function scan() {
  const status = $('scan-status');
  status.textContent = 'Looking for model servers on this computer…';
  $('setup-help').hidden = true;
  $('found').replaceChildren();
  const found = (
    await Promise.all(
      LOCAL.map(async (p) => ((await listening(new URL(p.baseURL).origin)) ? p : null)),
    )
  ).filter((p): p is ProviderPreset => p !== null);
  status.textContent =
    found.length === 0
      ? ''
      : `Found ${found.length === 1 ? 'a model server' : `${found.length} model servers`}:`;
  $('setup-help').hidden = found.length > 0;
  $('found').replaceChildren(
    ...found.map((preset) => {
      const li = document.createElement('li');
      const text = document.createElement('div');
      text.className = 'provider-text';
      text.append(
        Object.assign(document.createElement('strong'), { textContent: preset.label }),
        Object.assign(document.createElement('span'), {
          className: 'muted',
          textContent: new URL(preset.baseURL).host,
        }),
      );
      const use = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'primary',
        textContent: 'Use',
      });
      use.setAttribute('aria-label', `Use ${preset.label}`);
      use.addEventListener('click', () => chooseLocal(preset, preset.baseURL));
      li.append(text, use);
      return li;
    }),
  );
}

function chooseLocal(preset: ProviderPreset, baseURL: string) {
  provider = newProvider(preset, baseURL);
  if (preset.id === 'custom') provider.name = `Model server at ${new URL(baseURL).host}`;
  back = 'step-local';
  void loadModels();
}

function setUpLocal() {
  $('rescan').addEventListener('click', () => void scan());
  $('custom-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('custom-url');
    let url: URL;
    try {
      url = new URL(input.value.trim());
    } catch {
      return say('Enter the server address, such as http://localhost:8080/v1.', 'error');
    }
    const custom = PRESETS.find((p) => p.id === 'custom');
    if (custom) chooseLocal(custom, url.href.replace(/\/$/, ''));
  });
}

// ---- Model and finish ------------------------------------------------------------------------

async function loadModels() {
  const p = provider;
  if (!p) return;
  say('Connecting…');
  const res = await send<ListModelsResponse>({ type: 'cadenza/list-models', config: configOf(p) });
  if (!res.ok) return showError(res.error, loadModels);
  if (res.models.length === 0) {
    return say('The server has no models. Download one, then try again.', 'error');
  }
  showModels(res.models);
}

function showModels(models: ModelInfo[]) {
  $('model').replaceChildren(
    ...models.map((m) => new Option(m.label === m.id ? m.id : `${m.label} (${m.id})`, m.id)),
  );
  $('model-heading').textContent = `Choose a model from ${provider?.name ?? 'the provider'}`;
  show('step-model');
  say(`Found ${models.length} model${models.length === 1 ? '' : 's'}.`, 'ok');
}

async function finish() {
  const p = provider;
  if (!p || finishing) return;
  p.model = $<HTMLSelectElement>('model').value || null;
  if (!p.model) return say('Choose a model.', 'error');
  finishing = true;
  const button = $<HTMLButtonElement>('finish');
  button.disabled = true;
  try {
    say(
      p.slowMode
        ? 'Checking a sample sentence… on a computer without a fast graphics card this can take a minute.'
        : 'Checking a sample sentence…',
    );
    const res = await send<TestResponse>({
      type: 'cadenza/test',
      config: configOf(p),
      explanations: p.explanations,
    });
    if (!res.ok) return showError(res.error, finish);

    // Replace an entry with the same id (a retry after an error), or add it.
    await updateSettings((s) => {
      const i = s.providers.findIndex((x) => x.id === p.id);
      if (i === -1) s.providers.push(p);
      else s.providers[i] = p;
      s.activeProviderId = p.id;
      s.enabled = true;
    });
  } finally {
    finishing = false;
    button.disabled = false;
  }
  show('step-done');
  new FieldSession($<HTMLTextAreaElement>('try'));
  $('try').focus();
}

// ---- Wiring --------------------------------------------------------------------------------

function init() {
  setUpHosted();
  setUpLocal();
  $('choose-hosted').addEventListener('click', () => {
    show('step-hosted');
    $('hosted-key').focus();
  });
  $('choose-local').addEventListener('click', () => {
    show('step-local');
    void scan();
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('button.back')) {
    b.addEventListener('click', () => {
      const from = steps.find((s) => !$(s).hidden);
      show(from === 'step-model' ? back : 'step-choose');
    });
  }
  $('finish').addEventListener('click', () => void finish());
  $('fix').addEventListener('click', async () => {
    const button = $<HTMLButtonElement>('fix');
    const action = fixAction;
    if (!action || button.disabled) return;
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
    }
  });
  $('open-settings').addEventListener('click', () => void browser.runtime.openOptionsPage());
}

init();
