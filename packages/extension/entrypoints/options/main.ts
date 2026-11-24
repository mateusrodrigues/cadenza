import {
  getPreset,
  isLocalURL,
  type ModelInfo,
  PRESETS,
  type ProviderConfig,
  type ProviderPreset,
} from '@cadenza/providers';
import { CATEGORIES, CATEGORY_IDS, type Dialect } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import type {
  AllowOriginResponse,
  ListModelsResponse,
  PageMessage,
  TestResponse,
  WorkerError,
} from '../../lib/messages';
import {
  loadSettings,
  newProvider,
  type SavedProvider,
  type Settings,
  saveSettings,
} from '../../lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  list: $<HTMLUListElement>('provider-list'),
  add: $<HTMLButtonElement>('add-provider'),
  editor: $<HTMLFormElement>('editor'),
  title: $<HTMLHeadingElement>('editor-title'),
  preset: $<HTMLSelectElement>('preset'),
  name: $<HTMLInputElement>('name'),
  baseURL: $<HTMLInputElement>('base-url'),
  keyRow: $<HTMLLabelElement>('api-key-row'),
  keyHelp: $<HTMLSpanElement>('key-help'),
  apiKey: $<HTMLInputElement>('api-key'),
  model: $<HTMLSelectElement>('model'),
  loadModels: $<HTMLButtonElement>('load-models'),
  explanations: $<HTMLInputElement>('explanations'),
  slowMode: $<HTMLInputElement>('slow-mode'),
  test: $<HTMLButtonElement>('test'),
  cancel: $<HTMLButtonElement>('cancel'),
  message: $<HTMLParagraphElement>('message'),
  fix: $<HTMLButtonElement>('fix'),
  dialect: $<HTMLSelectElement>('dialect'),
  categories: $<HTMLFieldSetElement>('categories'),
};

const DIALECTS: [Dialect, string][] = [
  ['en-US', 'American English'],
  ['en-GB', 'British English'],
  ['en-CA', 'Canadian English'],
  ['en-AU', 'Australian English'],
];

let settings: Settings;
/** The provider being edited (a copy), or null when the editor is closed. */
let editing: SavedProvider | null = null;
let fixAction: (() => Promise<void>) | null = null;

function send<T>(message: PageMessage): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

// ---- Provider list ---------------------------------------------------------------------

function renderList() {
  el.list.replaceChildren(
    ...settings.providers.map((p) => {
      const li = document.createElement('li');
      const radio = Object.assign(document.createElement('input'), {
        type: 'radio',
        name: 'active',
        checked: p.id === settings.activeProviderId,
        title: 'Use this provider',
      });
      radio.setAttribute('aria-label', `Use ${p.name}`);
      radio.addEventListener('change', async () => {
        settings.activeProviderId = p.id;
        await saveSettings(settings);
      });
      const text = document.createElement('div');
      text.className = 'provider-text';
      const name = Object.assign(document.createElement('strong'), { textContent: p.name });
      const local = p.kind === 'mock' || isLocalURL(p.baseURL);
      const meta = Object.assign(document.createElement('span'), {
        className: 'muted',
        textContent: [
          p.model ?? 'No model chosen',
          local ? 'on this computer' : null,
          p.slowMode ? 'slow model mode' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
      text.append(name, meta);
      const edit = button('Edit', () => openEditor(p, false));
      const remove = button('Remove', async () => {
        settings.providers = settings.providers.filter((x) => x.id !== p.id);
        if (settings.activeProviderId === p.id) {
          settings.activeProviderId = settings.providers[0]?.id ?? null;
        }
        await saveSettings(settings);
        if (editing?.id === p.id) closeEditor();
        renderList();
      });
      li.append(radio, text, edit, remove);
      return li;
    }),
  );
}

function button(label: string, onClick: () => void) {
  const b = Object.assign(document.createElement('button'), {
    type: 'button',
    textContent: label,
  });
  b.addEventListener('click', onClick);
  return b;
}

// ---- Editor ------------------------------------------------------------------------------

function presetOptions() {
  const group = (label: string, presets: ProviderPreset[]) => {
    const g = document.createElement('optgroup');
    g.label = label;
    g.append(...presets.map((p) => new Option(p.label, p.id)));
    return g;
  };
  el.preset.replaceChildren(
    group(
      'Hosted',
      PRESETS.filter((p) => !p.local && p.id !== 'custom'),
    ),
    group(
      'On this computer',
      PRESETS.filter((p) => p.local && p.kind !== 'mock'),
    ),
    group(
      'Other',
      PRESETS.filter((p) => p.id === 'custom' || p.kind === 'mock'),
    ),
  );
}

function openEditor(provider: SavedProvider, isNew: boolean) {
  editing = structuredClone(provider);
  el.title.textContent = isNew ? 'Add provider' : `Edit ${provider.name}`;
  el.editor.dataset.new = String(isNew);
  el.preset.value = provider.presetId;
  fillEditor();
  setModels(editing.model ? [{ id: editing.model, label: editing.model }] : [], editing.model);
  say('');
  el.editor.hidden = false;
  el.add.hidden = true;
  el.name.focus();
}

function closeEditor() {
  editing = null;
  el.editor.hidden = true;
  el.add.hidden = false;
}

function fillEditor() {
  if (!editing) return;
  const preset = getPreset(editing.presetId);
  const isMock = editing.kind === 'mock';
  el.name.value = editing.name;
  el.baseURL.value = editing.baseURL;
  el.baseURL.disabled = isMock;
  el.apiKey.value = editing.apiKey ?? '';
  el.keyRow.hidden = isMock || !(preset?.needsKey || editing.presetId === 'custom');
  el.apiKey.placeholder = preset?.needsKey ? '' : 'Optional';
  el.keyHelp.replaceChildren();
  if (preset?.helpURL) {
    el.keyHelp.append(
      Object.assign(document.createElement('a'), {
        href: preset.helpURL,
        target: '_blank',
        rel: 'noopener',
        textContent: 'Get a key',
      }),
    );
  }
  el.explanations.checked = editing.explanations;
  el.slowMode.checked = editing.slowMode;
}

/** Read form fields into `editing` and return it. */
function readEditor(): SavedProvider {
  if (!editing) throw new Error('No provider is being edited');
  editing.name = el.name.value.trim() || getPreset(editing.presetId)?.label || 'Provider';
  editing.baseURL = el.baseURL.value.trim();
  editing.apiKey = el.apiKey.value.trim() || null;
  editing.model = el.model.value || null;
  editing.explanations = el.explanations.checked;
  editing.slowMode = el.slowMode.checked;
  return editing;
}

function configOf(p: SavedProvider): ProviderConfig {
  const { presetId, kind, baseURL, apiKey, model, extraHeaders } = p;
  return { presetId, kind, baseURL, apiKey, model, ...(extraHeaders ? { extraHeaders } : {}) };
}

function setModels(models: ModelInfo[], selected: string | null) {
  const list =
    selected && !models.some((m) => m.id === selected)
      ? [{ id: selected, label: selected }, ...models]
      : models;
  el.model.replaceChildren(
    ...list.map(
      (m) =>
        new Option(
          m.label === m.id ? m.id : `${m.label} (${m.id})`,
          m.id,
          false,
          m.id === selected,
        ),
    ),
  );
}

async function loadModels() {
  const p = readEditor();
  say('Loading models…');
  const res = await send<ListModelsResponse>({ type: 'cadenza/list-models', config: configOf(p) });
  if (!res.ok) return showError(res.error, p, loadModels);
  setModels(res.models, p.model ?? res.models[0]?.id ?? null);
  say(`Found ${res.models.length} model${res.models.length === 1 ? '' : 's'}.`, 'ok');
}

async function test() {
  const p = readEditor();
  if (!p.model) return say('Choose a model first.', 'error');
  say(
    p.slowMode
      ? 'Checking a sample sentence… this can take a minute on slow models.'
      : 'Checking a sample sentence…',
  );
  const res = await send<TestResponse>({
    type: 'cadenza/test',
    config: configOf(p),
    explanations: p.explanations,
  });
  if (!res.ok) return showError(res.error, p, test);
  const found = res.found.map((f) => `“${f.original}” → “${f.replacement}”`).join(', ');
  const n = res.found.length;
  say(
    `Works: ${(res.ms / 1000).toFixed(1)} s, ${n} suggestion${n === 1 ? '' : 's'}${found ? `: ${found}` : ''}.`,
    'ok',
  );
}

async function save(event: SubmitEvent) {
  event.preventDefault();
  const p = readEditor();
  if (p.kind !== 'mock') {
    try {
      new URL(p.baseURL);
    } catch {
      return say('Enter a valid endpoint URL.', 'error');
    }
    if (getPreset(p.presetId)?.needsKey && !p.apiKey) return say('Enter an API key.', 'error');
    if (!p.model) return say('Choose a model (use “Load models”).', 'error');
  }
  const i = settings.providers.findIndex((x) => x.id === p.id);
  if (i === -1) settings.providers.push(p);
  else settings.providers[i] = p;
  if (!settings.activeProviderId || el.editor.dataset.new === 'true') {
    settings.activeProviderId = p.id;
  }
  await saveSettings(settings);
  closeEditor();
  renderList();
}

// ---- Messages and fixes ------------------------------------------------------------------

function say(text: string, kind: 'info' | 'ok' | 'error' = 'info') {
  el.message.textContent = text;
  el.message.dataset.kind = kind;
  el.fix.hidden = true;
  fixAction = null;
}

function offerFix(label: string, action: () => Promise<void>) {
  el.fix.textContent = label;
  el.fix.hidden = false;
  fixAction = action;
}

/**
 * Explain an error and, where Cadenza can fix it, offer a button. Permission requests must run
 * directly from a click, so they happen in the fix button's handler.
 */
function showError(error: WorkerError, p: SavedProvider, retry: () => Promise<void>) {
  const local = isLocalURL(p.baseURL);
  let origin: string | null = null;
  try {
    origin = new URL(p.baseURL).origin;
  } catch {}

  const refusedOrigin = local && error.status === 403;
  const unreachable = error.kind === 'network';
  if (origin && (refusedOrigin || unreachable)) {
    say(
      refusedOrigin
        ? 'The server refused the connection because it doesn’t accept requests from browser extensions.'
        : `Could not reach ${origin}. If the server is running, it may be blocking browser requests.`,
      'error',
    );
    const o = origin;
    offerFix('Allow connection', async () => {
      const granted = await browser.permissions.request({ origins: [`${o}/*`] });
      if (!granted) return say('Cadenza was not allowed to connect.', 'error');
      if (local) {
        const res = await send<AllowOriginResponse>({ type: 'cadenza/allow-origin', origin: o });
        if (!res.ok) return say(res.error.message, 'error');
      }
      await retry();
    });
    return;
  }
  say(describe(error), 'error');
}

function describe(error: WorkerError): string {
  switch (error.kind) {
    case 'auth':
      return 'The API key was rejected.';
    case 'not_found':
      return 'The endpoint or model was not found. Check the URL and model.';
    case 'rate_limited':
      return 'The provider is limiting requests. Try again in a moment.';
    case 'refused':
      return 'The model declined the request.';
    case 'bad_output':
      return `The model’s reply couldn’t be used: ${error.message}`;
    case 'unavailable':
      return 'The provider is having problems. Try again later.';
    default:
      return error.message;
  }
}

// ---- Writing settings --------------------------------------------------------------------

function renderWriting() {
  el.dialect.replaceChildren(
    ...DIALECTS.map(([id, label]) => new Option(label, id, false, id === settings.dialect)),
  );
  el.dialect.onchange = async () => {
    settings.dialect = el.dialect.value as Dialect;
    await saveSettings(settings);
  };
  const boxes = CATEGORY_IDS.map((id) => {
    const label = document.createElement('label');
    label.className = 'check';
    const box = Object.assign(document.createElement('input'), {
      type: 'checkbox',
      checked: settings.categories.includes(id),
      value: id,
    });
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = CATEGORIES[id].color;
    label.append(box, swatch, ` ${CATEGORIES[id].label}`);
    box.addEventListener('change', async () => {
      const chosen = CATEGORY_IDS.filter(
        (c) => el.categories.querySelector<HTMLInputElement>(`input[value="${c}"]`)?.checked,
      );
      if (chosen.length === 0) {
        box.checked = true;
        return;
      }
      settings.categories = chosen;
      await saveSettings(settings);
    });
    return label;
  });
  for (const l of el.categories.querySelectorAll('label')) l.remove();
  el.categories.append(...boxes);
}

// ---- Wiring ------------------------------------------------------------------------------

async function init() {
  settings = await loadSettings();
  presetOptions();
  renderList();
  renderWriting();

  el.add.addEventListener('click', () => {
    const preset = getPreset('openai') ?? PRESETS[0];
    if (preset) openEditor(newProvider(preset), true);
  });
  el.preset.addEventListener('change', () => {
    const preset = getPreset(el.preset.value);
    if (!preset || !editing) return;
    const keepName = el.name.value.trim() !== getPreset(editing.presetId)?.label;
    const fresh = newProvider(preset);
    editing = { ...fresh, id: editing.id, ...(keepName ? { name: el.name.value.trim() } : {}) };
    fillEditor();
    setModels([], editing.model);
    say('');
  });
  el.baseURL.addEventListener('change', () => {
    // Moving a new endpoint onto this computer usually means a slower model.
    if (editing && el.editor.dataset.new === 'true' && isLocalURL(el.baseURL.value)) {
      el.slowMode.checked = true;
      el.explanations.checked = false;
    }
  });
  el.apiKey.addEventListener('change', () => {
    if (el.apiKey.value.trim() && el.model.options.length <= 1) void loadModels();
  });
  el.loadModels.addEventListener('click', () => void loadModels());
  el.test.addEventListener('click', () => void test());
  el.cancel.addEventListener('click', closeEditor);
  el.fix.addEventListener('click', () => void fixAction?.());
  el.editor.addEventListener('submit', (e) => void save(e));
}

void init();
