import {
  getPreset,
  isLocalURL,
  type ModelInfo,
  PRESETS,
  type ProviderConfig,
  type ProviderPreset,
} from '@cadenza/providers';
import { CATEGORIES, CATEGORY_IDS, type Category, type Dialect, type Goals } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { explainError } from '../../lib/connect';
import { icon, lineSample } from '../../lib/icons';
import type {
  ListModelsResponse,
  PageMessage,
  TestResponse,
  WorkerError,
} from '../../lib/messages';
import { showSmallModelWarning } from '../../lib/model-size';
import {
  FIELD_KINDS,
  loadSettings,
  newProvider,
  type SavedProvider,
  type Settings,
  thinkingFor,
  updateSettings,
} from '../../lib/settings';
import { $ } from './dom';
import { renderDictionary, renderIgnored, renderSites, wireDictionary, wireSites } from './lists';
import { renderSecurity, wireSecurity } from './security';
import { renderUsage, wireLimit } from './usage';

const el = {
  layout: $<HTMLDivElement>('provider-layout'),
  lockedNote: $<HTMLParagraphElement>('keys-locked'),
  list: $<HTMLUListElement>('provider-list'),
  empty: $<HTMLParagraphElement>('provider-empty'),
  add: $<HTMLButtonElement>('add-provider'),
  editor: $<HTMLFormElement>('editor'),
  title: $<HTMLHeadingElement>('editor-title'),
  preset: $<HTMLSelectElement>('preset'),
  name: $<HTMLInputElement>('name'),
  baseURL: $<HTMLInputElement>('base-url'),
  keyRow: $<HTMLDivElement>('api-key-row'),
  keyHelp: $<HTMLSpanElement>('key-help'),
  apiKey: $<HTMLInputElement>('api-key'),
  showKey: $<HTMLButtonElement>('show-key'),
  model: $<HTMLSelectElement>('model'),
  loadModels: $<HTMLButtonElement>('load-models'),
  modelWarning: $<HTMLParagraphElement>('model-warning'),
  explanations: $<HTMLInputElement>('explanations'),
  slowMode: $<HTMLInputElement>('slow-mode'),
  thinkingRow: $<HTMLDivElement>('thinking-row'),
  thinking: $<HTMLInputElement>('thinking'),
  test: $<HTMLButtonElement>('test'),
  use: $<HTMLButtonElement>('use'),
  cancel: $<HTMLButtonElement>('cancel'),
  remove: $<HTMLButtonElement>('delete'),
  message: $<HTMLParagraphElement>('message'),
  fix: $<HTMLButtonElement>('fix'),
  dialect: $<HTMLFieldSetElement>('dialect'),
  categories: $<HTMLDivElement>('category-rows'),
  formality: $<HTMLFieldSetElement>('formality'),
  audience: $<HTMLSelectElement>('audience'),
  audienceHelp: $<HTMLParagraphElement>('audience-help'),
};

// ---- Tabs --------------------------------------------------------------------------------

const TABS = ['provider', 'writing', 'dictionary', 'sites', 'ignored', 'usage', 'passphrase'];

/**
 * One section shows at a time, chosen by the address's #fragment, so a tab can be linked to
 * (#passphrase from the locked note) and Back works. Switching moves focus to its heading.
 */
function showTab(name: string, focus: boolean) {
  const tab = TABS.includes(name) ? name : 'provider';
  for (const s of document.querySelectorAll<HTMLElement>('.tab')) {
    s.hidden = s.dataset.tab !== tab;
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>('#tabs a')) {
    if (a.hash === `#${tab}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const heading = document.getElementById(`${tab}-title`);
  document.title = `${heading?.textContent ?? 'Settings'} · Cadenza settings`;
  if (focus) heading?.focus();
}

// ---- Settings ----------------------------------------------------------------------------

const DIALECTS: [Dialect, string][] = [
  ['en-US', 'American'],
  ['en-GB', 'British'],
  ['en-CA', 'Canadian'],
  ['en-AU', 'Australian'],
];

const FORMALITY: [Goals['formality'], string][] = [
  ['any', 'No preference'],
  ['informal', 'Casual'],
  ['neutral', 'Neutral'],
  ['formal', 'Formal'],
];

const AUDIENCE: [Goals['audience'], string, string][] = [
  ['any', 'Anyone', 'No preference: Cadenza judges from the text.'],
  ['general', 'General readers', 'Cadenza points out jargon and suggests plainer words.'],
  ['expert', 'Specialists', 'Terms of the field are fine; Cadenza leaves jargon alone.'],
];

const CATEGORY_HELP: Record<Category, string> = {
  correctness: 'Spelling, grammar and punctuation',
  clarity: 'Shorter, plainer ways to say it',
  style: 'Weak or repeated words',
  tone: 'How a sentence may land',
};

/** Last loaded settings, for rendering. Changes always load fresh settings (see `update`). */
let settings: Settings;
/** The provider in the form (a copy), or null when there is none. */
let editing: SavedProvider | null = null;
let isNew = false;
let fixAction: (() => Promise<void>) | null = null;
/** The models in the picker; a saved model starts as its id alone, with no size. */
let listed: ModelInfo[] = [];

/**
 * Change settings starting from what is stored now, so a change made elsewhere (the popup, a
 * card, another tab) isn't overwritten by this page's older copy.
 */
async function update(change: (s: Settings) => void): Promise<void> {
  settings = await updateSettings(change);
}

function send<T>(message: PageMessage): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

// ---- Provider: saved list ----------------------------------------------------------------

function renderList() {
  el.empty.hidden = settings.providers.length > 0;
  el.list.replaceChildren(
    ...settings.providers.map((p) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = p.id;
      const selected = !isNew && editing?.id === p.id;
      b.setAttribute('aria-current', String(selected));
      const text = document.createElement('span');
      const local = p.kind === 'mock' || isLocalURL(p.baseURL);
      text.append(
        Object.assign(document.createElement('strong'), { textContent: p.name }),
        Object.assign(document.createElement('span'), {
          className: 'muted',
          textContent: [p.model ?? 'No model chosen', local ? 'on this computer' : null]
            .filter(Boolean)
            .join(' · '),
        }),
      );
      b.append(text);
      if (p.id === settings.activeProviderId) {
        const use = document.createElement('span');
        use.className = 'in-use';
        use.append(icon('check', 14), 'In use');
        b.append(use);
      }
      b.addEventListener('click', () => openEditor(p, false));
      li.append(b);
      return li;
    }),
  );
}

// ---- Provider: form ----------------------------------------------------------------------

function presetOptions() {
  const group = (label: string, presets: ProviderPreset[]) => {
    const g = document.createElement('optgroup');
    g.label = label;
    g.append(...presets.map((p) => new Option(p.label, p.id)));
    return g;
  };
  el.preset.replaceChildren(
    group(
      'Hosted, with your key',
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

function openEditor(provider: SavedProvider, fresh: boolean) {
  editing = structuredClone(provider);
  isNew = fresh;
  el.title.textContent = fresh ? 'Add provider' : `Edit ${provider.name}`;
  el.preset.value = provider.presetId;
  fillEditor();
  setModels(editing.model ? [{ id: editing.model, label: editing.model }] : [], editing.model);
  void refreshLocalModels();
  say('');
  el.editor.hidden = false;
  syncButtons();
  renderList();
  if (fresh) el.name.focus();
}

/** Show the provider in use (or the first), or a new one when there are none. */
function openDefault() {
  const p =
    settings.providers.find((x) => x.id === settings.activeProviderId) ?? settings.providers[0];
  if (p) openEditor(p, false);
  else addProvider(false);
}

function addProvider(focus = true) {
  const preset = getPreset('openai') ?? PRESETS[0];
  if (!preset) return;
  openEditor(newProvider(preset), true);
  if (!focus) el.name.blur();
}

function syncButtons() {
  const inUse = !isNew && editing?.id === settings.activeProviderId;
  el.use.hidden = isNew || inUse;
  el.remove.hidden = isNew;
  el.cancel.hidden = !isNew || settings.providers.length === 0;
  el.add.hidden = isNew;
}

function fillEditor() {
  if (!editing) return;
  const preset = getPreset(editing.presetId);
  const isMock = editing.kind === 'mock';
  el.name.value = editing.name;
  el.baseURL.value = editing.baseURL;
  el.baseURL.disabled = isMock;
  el.apiKey.value = editing.apiKey ?? '';
  showKey(false);
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
  el.thinking.checked = editing.thinking ?? false;
  showThinking();
}

/** The thinking switch shows only for a model seen thinking (in a test or a check). */
function showThinking() {
  const model = el.model.value || editing?.model;
  el.thinkingRow.hidden = !model || editing?.thinkingModel !== model;
}

function showKey(show: boolean) {
  el.apiKey.type = show ? 'text' : 'password';
  el.showKey.setAttribute('aria-pressed', String(show));
  const label = show ? 'Hide key' : 'Show key';
  el.showKey.setAttribute('aria-label', label);
  el.showKey.title = label;
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
  editing.thinking = el.thinking.checked;
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
  listed = list;
  syncModelWarning();
}

function syncModelWarning() {
  showSmallModelWarning(el.modelWarning, listed, el.model.value);
}

/**
 * A model server on this computer lists its models quickly and at no cost, so list them when
 * the form opens to learn the saved model's size. Quiet: a server that isn't running now is
 * reported only when the user asks (Load models, Test connection).
 */
async function refreshLocalModels() {
  const p = editing;
  if (!p || p.kind === 'mock' || !p.model || !isLocalURL(p.baseURL)) return;
  const res = await send<ListModelsResponse>({ type: 'cadenza/list-models', config: configOf(p) });
  // Skip if another provider was opened, or the list was loaded or changed meanwhile.
  if (!res.ok || editing !== p || listed.length !== 1 || el.model.value !== p.model) return;
  setModels(res.models, p.model);
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
    ...(thinkingFor(p) ? { thinking: thinkingFor(p) } : {}),
  });
  if (!res.ok) return showError(res.error, p, test);
  const found = res.found.map((f) => `“${f.original}” → “${f.replacement}”`).join(', ');
  const n = res.found.length;
  const firstSeen = res.reasoned && p.thinkingModel !== p.model;
  let note = '';
  if (res.thinkingFellBack) {
    note = ' It thought for too long, so Cadenza asked again without thinking.';
  } else if (firstSeen) {
    note = ' This model thinks before it answers. You can turn that on below.';
  }
  if (res.reasoned && p.model) {
    p.thinkingModel = p.model;
    showThinking();
  }
  say(
    `Connected. Replied in ${(res.ms / 1000).toFixed(1)} s with ${n} suggestion${n === 1 ? '' : 's'}${found ? `: ${found}` : ''}.${note}`,
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
  const wasNew = isNew;
  await update((s) => {
    const i = s.providers.findIndex((x) => x.id === p.id);
    if (i === -1) s.providers.push(p);
    else s.providers[i] = p;
    if (!s.activeProviderId || wasNew) s.activeProviderId = p.id;
  });
  openEditor(p, false);
  say(wasNew ? 'Saved, and now in use.' : 'Saved.', 'ok');
}

async function useProvider() {
  if (!editing || isNew) return;
  const id = editing.id;
  await update((s) => {
    s.activeProviderId = id;
  });
  syncButtons();
  renderList();
  say('Now in use.', 'ok');
}

async function deleteProvider() {
  if (!editing || isNew) return;
  const p = editing;
  const sure = window.confirm(
    `Delete ${p.name}?${p.apiKey ? ' Its API key is deleted from this browser too.' : ''}`,
  );
  if (!sure) return;
  await update((s) => {
    s.providers = s.providers.filter((x) => x.id !== p.id);
    if (s.activeProviderId === p.id) s.activeProviderId = s.providers[0]?.id ?? null;
  });
  openDefault();
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

/** Explain an error and, where Cadenza can fix it, offer a button that fixes it and retries. */
function showError(error: WorkerError, p: SavedProvider, retry: () => Promise<void>) {
  const problem = explainError(error, p.baseURL);
  say(problem.message, 'error');
  const fix = problem.fix;
  if (fix) {
    offerFix(fix.label, async () => {
      const failed = await fix.run();
      if (failed) return say(failed, 'error');
      await retry();
    });
  }
}

// ---- Writing -----------------------------------------------------------------------------

/** Radio choices drawn as pills, under the fieldset's legend. */
function pills<T extends string>(
  set: HTMLFieldSetElement,
  name: string,
  choices: [T, string][],
  current: T,
  onChange: (value: T) => void,
) {
  for (const l of set.querySelectorAll('label')) l.remove();
  for (const [value, text] of choices) {
    const label = document.createElement('label');
    const radio = Object.assign(document.createElement('input'), {
      type: 'radio',
      name,
      value,
      checked: value === current,
    });
    radio.addEventListener('change', () => onChange(value));
    label.append(radio, text);
    set.append(label);
  }
}

function renderWriting() {
  pills(el.dialect, 'dialect', DIALECTS, settings.dialect, (dialect) => {
    void update((s) => {
      s.dialect = dialect;
    });
  });
  pills(el.formality, 'formality', FORMALITY, settings.goals.formality, (formality) => {
    void update((s) => {
      s.goals = { ...s.goals, formality };
    });
  });
  el.audience.replaceChildren(
    ...AUDIENCE.map(([id, l]) => new Option(l, id, false, id === settings.goals.audience)),
  );
  const help = () => {
    el.audienceHelp.textContent = AUDIENCE.find(([id]) => id === el.audience.value)?.[2] ?? '';
  };
  help();
  el.audience.onchange = () => {
    help();
    void update((s) => {
      s.goals = { ...s.goals, audience: el.audience.value as Goals['audience'] };
    });
  };

  const rows = CATEGORY_IDS.map((id) => {
    const label = document.createElement('label');
    label.className = 'cat-row';
    const box = Object.assign(document.createElement('input'), {
      type: 'checkbox',
      checked: settings.categories.includes(id),
      value: id,
    });
    const name = document.createElement('span');
    name.className = `cdz-cat cdz-cat--${id}`;
    name.append(lineSample(id), CATEGORIES[id].label);
    const what = Object.assign(document.createElement('span'), {
      className: 'muted',
      textContent: CATEGORY_HELP[id],
    });
    label.append(box, name, what);
    box.addEventListener('change', async () => {
      const chosen = CATEGORY_IDS.filter(
        (c) => el.categories.querySelector<HTMLInputElement>(`input[value="${c}"]`)?.checked,
      );
      // At least one category stays on.
      if (chosen.length === 0) {
        box.checked = true;
        return;
      }
      await update((s) => {
        s.categories = chosen;
      });
    });
    return label;
  });
  el.categories.replaceChildren(...rows);
}

/** Where to check: text fields, text areas, rich editors. Any of them may be off, even all. */
function renderFieldKinds() {
  for (const kind of FIELD_KINDS) {
    const box = $<HTMLInputElement>(`kind-${kind}`);
    box.checked = settings.fieldKinds[kind];
    box.onchange = () =>
      void update((s) => {
        s.fieldKinds = { ...s.fieldKinds, [kind]: box.checked };
      });
  }
}

/** The keyboard shortcut for suggestions, as the user has it set in Chrome. */
async function renderShortcut() {
  const keys = $('shortcut-keys');
  const command = (await browser.commands.getAll()).find((c) => c.name === 'open-suggestion');
  const parts = command?.shortcut?.split('+').map((k) => ({ Period: '.', Comma: ',' })[k] ?? k);
  keys.replaceChildren(
    ...(parts ?? []).map((k) =>
      Object.assign(document.createElement('kbd'), { className: 'cdz-kbd', textContent: k }),
    ),
  );
  keys.setAttribute('aria-label', parts ? `Shortcut: ${parts.join(' ')}` : '');
  $('shortcut-help').textContent = parts
    ? 'Opens the suggestion at the cursor. Chrome keeps extension shortcuts in its own settings.'
    : 'No shortcut set. Chrome keeps extension shortcuts in its own settings.';
}

// ---- Wiring ------------------------------------------------------------------------------

/** While the keys are locked, providers can't be edited (saving would need the keys). */
async function applyLockState() {
  const state = await renderSecurity();
  settings = await loadSettings();
  const locked = state === 'locked';
  el.layout.hidden = locked;
  el.lockedNote.hidden = !locked;
  if (locked) {
    editing = null;
    return;
  }
  // Keep the open form (and what was typed) unless its provider went away.
  const still = editing && (isNew || settings.providers.some((p) => p.id === editing?.id));
  if (still) {
    syncButtons();
    renderList();
  } else {
    openDefault();
  }
}

async function init() {
  showTab(location.hash.slice(1), false);
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1), true));

  settings = await loadSettings();
  presetOptions();
  // Before anything else is awaited, so a choice made while the page loads isn't lost.
  wireProviderForm();
  renderWriting();
  renderFieldKinds();
  await applyLockState();
  wireSecurity(applyLockState);
  wireDictionary();
  wireSites();
  await wireLimit();
  await Promise.all([
    renderIgnored(),
    renderDictionary(),
    renderSites(),
    renderUsage(),
    renderShortcut(),
  ]);
  browser.storage.local.onChanged.addListener(async (changes) => {
    if (changes.ignored) void renderIgnored();
    if (changes.dictionary) void renderDictionary();
    if (changes.usage) void renderUsage();
    if (changes.settings) {
      settings = await loadSettings();
      void renderSites();
      syncButtons();
      renderList();
    }
  });
  browser.storage.session.onChanged.addListener((changes) => {
    if (changes.unlockKey) void applyLockState();
  });
}

/** The provider form's controls. Each acts on `editing`, so they're safe before it is set. */
function wireProviderForm() {
  el.add.addEventListener('click', () => addProvider());
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
    if (editing && isNew && isLocalURL(el.baseURL.value)) {
      el.slowMode.checked = true;
      el.explanations.checked = false;
    }
  });
  el.apiKey.addEventListener('change', () => {
    if (el.apiKey.value.trim() && el.model.options.length <= 1) void loadModels();
  });
  el.showKey.addEventListener('click', () => showKey(el.apiKey.type === 'password'));
  el.loadModels.addEventListener('click', () => void loadModels());
  el.model.addEventListener('change', syncModelWarning);
  el.test.addEventListener('click', () => void test());
  el.model.addEventListener('change', () => showThinking());
  el.thinking.addEventListener('change', () => {
    // A thinking check can take a minute; slow mode waits for it.
    if (el.thinking.checked) el.slowMode.checked = true;
  });
  el.use.addEventListener('click', () => void useProvider());
  el.remove.addEventListener('click', () => void deleteProvider());
  el.cancel.addEventListener('click', () => openDefault());
  el.fix.addEventListener('click', () => void fixAction?.());
  el.editor.addEventListener('submit', (e) => void save(e));
}

void init();
