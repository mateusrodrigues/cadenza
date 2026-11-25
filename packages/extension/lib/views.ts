import { CATEGORIES, CATEGORY_IDS, type Category, type Suggestion } from '@cadenza/shared';
import { icon, lineSample } from './icons';

/**
 * Card and panel content, built from the design system's components (kit.css). Everything
 * shown comes from page text or model output, so it is only ever set as text, never as HTML.
 * Buttons act on trusted (user) clicks only, and panel rows on trusted key presses: a page
 * can't accept a suggestion by dispatching a synthetic event.
 */

export interface CardActions {
  /** Resolves false if the change couldn't be applied. */
  accept(): Promise<boolean>;
  dismiss(): void;
  ignore(): void;
  close(): void;
  /** Present for single-word spelling suggestions. */
  addWord?: () => void;
  /** Position among the field's suggestions, with moves to the neighbours. */
  nav?: { index: number; total: number; prev(): void; next(): void };
}

export function buildCard(s: Suggestion, actions: CardActions): HTMLElement {
  const card = h('div', 'cdz-contents');
  const head = h('div', 'cdz-card__head');
  head.append(category(s.category));
  if (actions.nav && actions.nav.total > 1) {
    const { index, total, prev, next } = actions.nav;
    head.append(
      h('span', 'cdz-card__count', `${index + 1} of ${total}`),
      iconButton('prev', 'prev', 'Previous suggestion', prev),
      iconButton('next', 'next', 'Next suggestion', next),
    );
  } else {
    head.append(h('span', 'cdz-card__count'));
  }
  head.append(iconButton('close', 'close', 'Close', actions.close));

  const what = change(s);
  what.id = 'cadenza-change';
  card.append(head, what);
  if (s.explanation) {
    const why = h('p', 'cdz-card__why', s.explanation);
    why.id = 'cadenza-explanation';
    card.append(why);
  }
  const error = h('p', 'cdz-error');
  error.hidden = true;
  const row = h('div', 'cdz-card__actions');
  row.append(
    button('Accept', 'cdz-btn cdz-btn--primary', 'accept', async () => {
      if (!(await actions.accept())) {
        error.textContent = "Couldn't change the text here. Edit it by hand instead.";
        error.hidden = false;
      }
    }),
    button('Dismiss', 'cdz-btn', 'dismiss', () => actions.dismiss()),
  );
  const never = h('div', 'cdz-card__never');
  never.append(
    button("Don't suggest this again", 'cdz-btn cdz-btn--quiet', 'ignore', () => actions.ignore()),
  );
  const { addWord } = actions;
  if (addWord) {
    never.append(
      button('Add to dictionary', 'cdz-btn cdz-btn--quiet', 'add-word', () => addWord()),
    );
  }
  card.append(row, error, never);
  return card;
}

/**
 * The card after "Don't suggest this again" or "Add to dictionary": what happened, and Undo.
 * The message is announced, and read again with whichever button gets focus.
 */
export function buildDone(message: string, actions: { undo(): void; close(): void }): HTMLElement {
  const card = h('div', 'cdz-contents');
  const row = h('div', 'cdz-card__done');
  const text = h('p', 'cdz-card__donetext', message);
  text.id = 'cadenza-change';
  text.setAttribute('role', 'status');
  row.append(
    text,
    button('Undo', 'cdz-btn', 'undo', () => actions.undo()),
    iconButton('close', 'close', 'Close', actions.close),
  );
  card.append(row);
  return card;
}

export interface PanelActions {
  accept(s: Suggestion): Promise<boolean>;
  dismiss(s: Suggestion): void;
  acceptAll(category: Category): Promise<boolean>;
  close(): void;
  /** After a keyboard action re-renders the panel: keep focus on the row at this index. */
  focusRow(index: number): void;
}

/** What the panel says above (or instead of) the list. */
export type PanelNote = { text: string; error?: boolean } | null;

/** After Accept all: what changed, and Undo. */
export interface PanelUndo {
  text: string;
  undo(): void;
}

export function buildPanel(
  suggestions: Suggestion[],
  actions: PanelActions,
  note: PanelNote,
  undo: PanelUndo | null = null,
): HTMLElement {
  const panel = h('div', 'cdz-contents');
  const header = h('div', 'cdz-panel__head');
  const n = suggestions.length;
  const mark = icon('fermata');
  mark.classList.add('cdz-mark');
  header.append(
    mark,
    h(
      'span',
      'cdz-panel__title',
      n === 0 ? 'Cadenza' : `${n} ${n === 1 ? 'suggestion' : 'suggestions'}`,
    ),
    iconButton('close', 'close', 'Close', () => actions.close()),
  );
  panel.append(header);
  const body = h('div', 'cdz-panel__body');
  panel.append(body);
  if (undo) {
    const row = h('div', 'cdz-panel__undo');
    const text = h('p', '', undo.text);
    text.id = 'cadenza-undo-text';
    text.setAttribute('role', 'status');
    const b = button('Undo', 'cdz-btn', 'undo', () => undo.undo());
    b.setAttribute('aria-describedby', text.id);
    row.append(text, b);
    body.append(row);
  }
  if (note) {
    const p = h('p', note.error ? 'cdz-panel__note cdz-error' : 'cdz-panel__note', note.text);
    if (note.error) p.setAttribute('role', 'alert');
    body.append(p);
  }
  if (n === 0) {
    if (!note) body.append(h('p', 'cdz-panel__note', 'No suggestions. Nice writing.'));
    return panel;
  }

  let index = 0;
  for (const cat of CATEGORY_IDS) {
    const items = suggestions.filter((s) => s.category === cat);
    if (items.length === 0) continue;
    const group = h('section', 'cdz-panel__group');
    group.dataset.category = cat;
    const head = h('div', 'cdz-panel__grouphead');
    head.append(category(cat), h('span', 'cdz-panel__count', String(items.length)));
    if (cat === 'correctness' && items.length > 1) {
      const all = button('Accept all', 'cdz-btn cdz-btn--primary', 'accept-all', () => {
        void actions.acceptAll(cat);
      });
      all.setAttribute('aria-label', `Accept all ${items.length} correctness suggestions`);
      head.append(all);
    }
    const list = h('ul', 'cdz-panel__rows');
    for (const s of items) list.append(panelRow(s, index++, actions));
    group.append(head, list);
    body.append(group);
  }

  const foot = h('div', 'cdz-panel__foot');
  foot.setAttribute('aria-hidden', 'true');
  foot.append(
    kbd('↑'),
    kbd('↓'),
    text('move'),
    kbd('Enter'),
    text('accept'),
    kbd('Del'),
    text('dismiss'),
  );
  panel.append(foot);
  return panel;
}

/**
 * One suggestion in the panel. Rows take focus one at a time (arrow keys move between them);
 * Enter accepts and Delete dismisses. The ✓ and × buttons are for the mouse.
 */
function panelRow(s: Suggestion, index: number, actions: PanelActions): HTMLLIElement {
  const row = h('li', 'cdz-panel__row');
  row.dataset.id = s.id;
  row.dataset.row = String(index);
  row.dataset.action = 'row';
  row.tabIndex = index === 0 ? 0 : -1;
  const what = change(s, true);
  what.id = `cadenza-item-${s.id}`;
  if (s.explanation) row.title = s.explanation;
  row.setAttribute('aria-describedby', what.id);
  row.setAttribute('aria-keyshortcuts', 'Enter Delete');
  const accept = iconButton('check', 'accept', 'Accept', () => void actions.accept(s));
  const dismiss = iconButton('close', 'dismiss', 'Dismiss', () => actions.dismiss(s));
  accept.classList.add('cdz-icon-btn--sm', 'cdz-accept');
  dismiss.classList.add('cdz-icon-btn--sm');
  for (const b of [accept, dismiss]) {
    b.tabIndex = -1;
    b.setAttribute('aria-describedby', what.id);
  }
  row.append(what, accept, dismiss);
  row.addEventListener('keydown', async (e) => {
    if (!e.isTrusted || e.target !== row) return;
    const rows = Array.from(
      row.closest('.cdz-panel__body')?.querySelectorAll<HTMLElement>('.cdz-panel__row') ?? [],
    );
    const move = (to: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!target) return;
      for (const r of rows) r.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    };
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(rows.length - 1);
    else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      await actions.accept(s);
      actions.focusRow(index);
      return;
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      actions.dismiss(s);
      actions.focusRow(index);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return row;
}

/** Category label: always the line sample and the name, never color alone. */
function category(cat: Category): HTMLElement {
  const el = h('span', `cdz-cat cdz-cat--${cat}`);
  el.append(lineSample(cat), CATEGORIES[cat].label);
  return el;
}

function change(s: Suggestion, compact = false): HTMLElement {
  const long = s.original.length + s.replacement.length > (compact ? 40 : 60);
  const p = h('p', long ? 'cdz-change cdz-change--stacked' : 'cdz-change');
  // Screen readers get a sentence; the struck-through/arrow layout is for the eye.
  p.append(
    h(
      'span',
      'cdz-sr',
      s.replacement
        ? `${CATEGORIES[s.category].label}: change “${s.original}” to “${s.replacement}”.`
        : `${CATEGORIES[s.category].label}: remove “${s.original}”.`,
    ),
  );
  const visual: HTMLElement[] = [h('del', '', s.original)];
  if (s.replacement) {
    if (!long) visual.push(h('span', 'cdz-arrow', '→'));
    visual.push(h('ins', '', s.replacement));
  } else {
    visual.push(h('span', 'cdz-remove', 'Remove'));
  }
  for (const el of visual) el.setAttribute('aria-hidden', 'true');
  p.append(...visual);
  return p;
}

function kbd(key: string): HTMLElement {
  return h('kbd', 'cdz-kbd', key);
}

function text(t: string): HTMLElement {
  return h('span', '', t);
}

function iconButton(
  name: Parameters<typeof icon>[0],
  action: string,
  label: string,
  onClick: () => unknown,
): HTMLButtonElement {
  const b = button('', 'cdz-icon-btn', action, onClick, label);
  b.append(icon(name));
  return b;
}

function button(
  label: string,
  className: string,
  action: string,
  onClick: () => unknown,
  ariaLabel?: string,
): HTMLButtonElement {
  const b = h('button', className, label);
  b.type = 'button';
  b.dataset.action = action;
  if (ariaLabel) {
    b.setAttribute('aria-label', ariaLabel);
    b.title = ariaLabel;
  }
  b.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    e.stopPropagation();
    onClick();
  });
  return b;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
