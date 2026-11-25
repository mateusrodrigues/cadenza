import { CATEGORIES, CATEGORY_IDS, type Category, type Suggestion } from '@cadenza/shared';

/**
 * Card and panel content. Everything shown comes from page text or model output, so it is
 * only ever set as text, never as HTML. Buttons act on trusted (user) clicks only: a page
 * can't accept a suggestion by dispatching a synthetic click.
 */

export interface CardActions {
  /** Resolves false if the change couldn't be applied. */
  accept(): Promise<boolean>;
  dismiss(): void;
  ignore(): void;
  /** Present for single-word spelling suggestions. */
  addWord?: () => void;
}

export function buildCard(s: Suggestion, actions: CardActions): HTMLElement {
  const card = h('div', 'card');
  const what = change(s);
  what.id = 'cadenza-change';
  card.append(chip(s.category, s.subtype), what);
  if (s.explanation) {
    const why = h('p', 'explanation', s.explanation);
    why.id = 'cadenza-explanation';
    card.append(why);
  }
  const error = h('p', 'error');
  error.hidden = true;
  const row = h('div', 'actions');
  row.append(
    button('Accept', 'primary', 'accept', async () => {
      if (!(await actions.accept())) {
        error.textContent = "Couldn't change the text here. Edit it by hand instead.";
        error.hidden = false;
      }
    }),
    button('Dismiss', '', 'dismiss', () => actions.dismiss()),
  );
  const { addWord } = actions;
  if (addWord) row.append(button('Add to dictionary', 'link', 'add-word', () => addWord()));
  row.append(button("Don't suggest this again", 'link', 'ignore', () => actions.ignore()));
  card.append(row, error);
  return card;
}

export interface PanelActions {
  accept(s: Suggestion): Promise<boolean>;
  dismiss(s: Suggestion): void;
  acceptAll(category: Category): Promise<boolean>;
  close(): void;
}

export function buildPanel(
  suggestions: Suggestion[],
  actions: PanelActions,
  error: string | null,
): HTMLElement {
  const panel = h('div', 'panel');
  const header = h('div', 'header');
  const n = suggestions.length;
  header.append(
    h('span', '', n === 0 ? 'Cadenza' : `Cadenza · ${n} ${n === 1 ? 'suggestion' : 'suggestions'}`),
    button('×', '', 'close', () => actions.close(), 'Close'),
  );
  panel.append(header);
  if (error) panel.append(h('p', 'panel-error', error));
  if (n === 0) {
    panel.append(h('p', 'empty', 'No suggestions. Nice writing.'));
    return panel;
  }
  for (const category of CATEGORY_IDS) {
    const items = suggestions.filter((s) => s.category === category);
    if (items.length === 0) continue;
    const group = h('section', 'group');
    group.dataset.category = category;
    const head = h('div', 'group-head');
    head.append(chip(category, null, items.length));
    if (category === 'correctness' && items.length > 1) {
      const all = button(
        'Accept all',
        'primary',
        'accept-all',
        () => void actions.acceptAll(category),
      );
      all.setAttribute('aria-label', `Accept all ${items.length} correctness suggestions`);
      head.append(all);
    }
    group.append(head);
    for (const s of items) {
      const item = h('div', 'item');
      item.dataset.id = s.id;
      // Each item's buttons are read with the change they act on ("Accept, change teh to the").
      const what = change(s);
      what.id = `cadenza-item-${s.id}`;
      item.append(what);
      if (s.explanation) item.append(h('p', 'explanation', s.explanation));
      const row = h('div', 'actions');
      const accept = button('Accept', 'primary', 'accept', () => void actions.accept(s));
      const dismiss = button('Dismiss', '', 'dismiss', () => actions.dismiss(s));
      accept.setAttribute('aria-describedby', what.id);
      dismiss.setAttribute('aria-describedby', what.id);
      row.append(accept, dismiss);
      item.append(row);
      group.append(item);
    }
    panel.append(group);
  }
  return panel;
}

function chip(category: Category, subtype: string | null, count?: number): HTMLElement {
  const info = CATEGORIES[category];
  const el = h('span', 'chip', info.label);
  el.style.setProperty('--c', info.color);
  if (subtype) el.append(h('span', 'subtype', ` · ${subtype}`));
  if (count !== undefined) el.append(h('span', 'subtype', ` (${count})`));
  return el;
}

function change(s: Suggestion): HTMLElement {
  const p = h('p', 'change');
  // Screen readers get a sentence; the struck-through/arrow layout is for the eye.
  p.append(
    h(
      'span',
      'sr',
      s.replacement
        ? `${CATEGORIES[s.category].label}: change “${s.original}” to “${s.replacement}”.`
        : `${CATEGORIES[s.category].label}: remove “${s.original}”.`,
    ),
  );
  const visual = h('span', '');
  visual.setAttribute('aria-hidden', 'true');
  visual.append(h('del', '', s.original));
  if (s.replacement) {
    visual.append(h('span', 'arrow', '→'), h('ins', '', s.replacement));
  } else {
    visual.append(h('span', 'remove', 'Remove'));
  }
  p.append(visual);
  return p;
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
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
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
