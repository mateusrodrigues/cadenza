import { adoptStyles, attach, layerFor, themeOf } from './surface';

/**
 * The floating surface for the suggestion card and the field panel. One per document, in a
 * closed shadow root so pages can neither style nor read it; one popover is open at a time.
 * Mouse use never takes focus from the field the user is writing in; keyboard use moves focus
 * into it (see focusPopover) and the owner puts it back when it closes.
 */

export type PopoverKind = 'card' | 'panel';

export interface PopoverOptions {
  kind: PopoverKind;
  /** The field it belongs to: sets the theme and where in the page it attaches. */
  field: Element;
  /** Who opened it (a field session); only the owner updates or closes it. */
  owner: object;
  content: HTMLElement;
  /** Where to attach, in viewport coordinates; null closes the popover (e.g. scrolled away). */
  anchor: () => DOMRect | null;
  /** Line the popover's left edge up with the anchor's left (default) or right edge. */
  align?: 'start' | 'end';
  /** Called once when it closes for any reason. */
  onClose: () => void;
}

const GAP = 6;
const MARGIN = 8;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let box: HTMLDivElement | null = null;
let current: PopoverOptions | null = null;
let frame = 0;

export function openPopover(options: PopoverOptions): void {
  closePopover();
  current = options;
  const el = ensureBox();
  el.className = `cdz-root cdz-${options.kind}`;
  el.dataset.kind = options.kind;
  el.setAttribute(
    'aria-label',
    options.kind === 'card' ? 'Cadenza suggestion' : 'Cadenza suggestions',
  );
  // The card's change and explanation are read along with whichever button gets focus.
  if (options.kind === 'card')
    el.setAttribute('aria-describedby', 'cadenza-change cadenza-explanation');
  else el.removeAttribute('aria-describedby');
  el.replaceChildren(options.content);
  const h = host as HTMLElement;
  h.dataset.theme = themeOf(options.field);
  attach(h, layerFor(options.field));
  try {
    // The top layer: above page dialogs and any z-index.
    if (!h.matches(':popover-open')) h.showPopover();
  } catch {
    // No popover support; the host's z-index still applies.
  }
  listen(true);
  place();
}

/** Replace the content of an open popover the owner holds, keeping its place. */
export function updatePopover(owner: object, content: HTMLElement): void {
  if (current?.owner !== owner || !box) return;
  box.replaceChildren(content);
  place();
}

/** Close the popover (only if `owner` holds it, when given). */
export function closePopover(owner?: object): void {
  if (!current || (owner && current.owner !== owner)) return;
  const closing = current;
  current = null;
  listen(false);
  cancelAnimationFrame(frame);
  frame = 0;
  box?.replaceChildren();
  host?.remove();
  closing.onClose();
}

/**
 * Move keyboard focus into the open popover: a given panel row or button, else the main
 * action (Accept on a card, the first row of the panel).
 */
export function focusPopover(owner: object, want: { row?: number; action?: string } = {}): void {
  if (current?.owner !== owner || !box) return;
  const rows = Array.from(box.querySelectorAll<HTMLElement>('.cdz-panel__row'));
  if (want.row !== undefined && rows.length > 0) {
    const row = rows[Math.min(want.row, rows.length - 1)] as HTMLElement;
    for (const r of rows) r.tabIndex = -1;
    row.tabIndex = 0;
    row.focus({ preventScroll: false });
    return;
  }
  const target =
    (want.action ? box.querySelector<HTMLElement>(`button[data-action="${want.action}"]`) : null) ??
    box.querySelector<HTMLElement>('button[data-action="accept"]:not(.cdz-icon-btn)') ??
    rows[0] ??
    box.querySelector<HTMLElement>('button');
  target?.focus({ preventScroll: true });
}

export function openKind(owner: object): PopoverKind | null {
  return current?.owner === owner ? current.kind : null;
}

/** Recompute the position, e.g. after the anchor moved. */
export function repositionPopover(owner: object): void {
  if (current?.owner === owner) schedulePlace();
}

function ensureBox(): HTMLDivElement {
  if (box) return box;
  host = document.createElement('cadenza-ui');
  host.setAttribute('popover', 'manual');
  root = host.attachShadow({ mode: __CADENZA_E2E__ ? 'open' : 'closed' });
  adoptStyles(root, STYLE);
  box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Cadenza');
  // Keep focus (and the caret) in the field while the user clicks our buttons.
  box.addEventListener('mousedown', (e) => e.preventDefault());
  // Tab cycles through what can take focus instead of leaving for the page.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !box || !root) return;
    const stops = Array.from(
      box.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), [tabindex="0"]'),
    );
    const first = stops[0];
    const last = stops.at(-1);
    const active = root.activeElement;
    if (!first || !last) return;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
  root.append(box);
  return box;
}

function place(): void {
  if (!current || !box) return;
  const a = current.anchor();
  if (!a || a.bottom < 0 || a.top > window.innerHeight) {
    closePopover();
    return;
  }
  const { offsetWidth: w, offsetHeight: h } = box;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  let top = a.bottom + GAP;
  if (top + h > vh - MARGIN && a.top - GAP - h >= MARGIN) top = a.top - GAP - h;
  const want = current.align === 'end' ? a.right - w : a.left;
  const left = Math.min(Math.max(MARGIN, want), Math.max(MARGIN, vw - w - MARGIN));
  box.style.top = `${Math.max(MARGIN, top)}px`;
  box.style.left = `${left}px`;
}

function schedulePlace(): void {
  if (frame) return;
  // After the underline renderers have repositioned in their own frame callbacks.
  frame = requestAnimationFrame(() => {
    frame = 0;
    place();
  });
}

const onPointerDown = (e: PointerEvent) => {
  const path = e.composedPath();
  // Our own UI (this popover, a field badge) handles its own clicks.
  if (path.some((n) => n instanceof Element && n.localName.startsWith('cadenza-'))) return;
  closePopover();
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || !current) return;
  e.stopPropagation();
  closePopover();
};

function listen(on: boolean): void {
  const method = on ? 'addEventListener' : 'removeEventListener';
  document[method]('pointerdown', onPointerDown as EventListener, true);
  document[method]('keydown', onKeyDown as EventListener, true);
  window[method]('scroll', schedulePlace, true);
  window[method]('resize', schedulePlace);
}

/** Popover rules the kit leaves to the product: layout inside the card and panel. */
const STYLE = `
  .cdz-card, .cdz-panel { cursor: default; user-select: none; -webkit-user-select: none; }
  .cdz-contents { display: contents; }
  .cdz-card__head .cdz-cat { margin-right: auto; }
  .cdz-card__count { margin-left: 0; }
  .cdz-card__count:empty { display: none; }
  .cdz-change .cdz-arrow { color: var(--cdz-color-muted); font-family: var(--cdz-font-ui); }
  .cdz-change .cdz-remove { color: var(--cdz-color-muted); font: var(--cdz-font-size-sm)/1 var(--cdz-font-ui); }
  .cdz-card__never { display: flex; flex-wrap: wrap; gap: 0 12px; }
  .cdz-card__never .cdz-btn + .cdz-btn { margin-left: 0; }
  .cdz-error { color: var(--cdz-color-danger); font-size: var(--cdz-font-size-sm); line-height: var(--cdz-line-height-sm); }
  .cdz-error[hidden] { display: none; }
  .cdz-panel__head { display: flex; align-items: center; gap: var(--cdz-space-2);
    padding: 10px 8px 10px 14px; font-weight: var(--cdz-weight-semibold); }
  .cdz-panel__head .cdz-mark { color: var(--cdz-color-accent); flex: none; }
  .cdz-panel__title { flex: 1; }
  .cdz-panel__note { padding: 12px 14px; color: var(--cdz-color-muted); border-top: 1px solid var(--cdz-color-border); }
  .cdz-panel__grouphead { display: flex; align-items: center; gap: var(--cdz-space-2); padding: 2px 14px 4px; }
  .cdz-panel__count { color: var(--cdz-color-muted); font-size: var(--cdz-font-size-sm); }
  .cdz-panel__grouphead .cdz-btn { margin-left: auto; height: 28px; }
  .cdz-panel__rows { margin: 0; padding: 0; }
  .cdz-panel__row { cursor: default; }
  .cdz-panel__row:focus-visible { outline-offset: -1px; }
  .cdz-panel__row .cdz-change del { font-size: var(--cdz-font-size-sm); }
  .cdz-accept { color: var(--cdz-color-accent); }
  .cdz-panel__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 14px;
    border-top: 1px solid var(--cdz-color-border); color: var(--cdz-color-muted); font-size: var(--cdz-font-size-xs); }
  .cdz-panel__foot span { margin-right: 6px; }
`;
