/**
 * The floating surface for the suggestion card and the field panel. One per document, in a
 * closed shadow root so pages can neither style nor read it; one popover is open at a time.
 * It never takes focus from the field the user is writing in.
 */

export type PopoverKind = 'card' | 'panel';

export interface PopoverOptions {
  kind: PopoverKind;
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
  el.dataset.kind = options.kind;
  el.replaceChildren(options.content);
  if (!host?.isConnected) document.documentElement.append(host as HTMLElement);
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
  host.style.cssText =
    'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  root = host.attachShadow({ mode: __CADENZA_E2E__ ? 'open' : 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  box = document.createElement('div');
  box.className = 'popover';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Cadenza');
  // Keep focus (and the caret) in the field while the user clicks our buttons.
  box.addEventListener('mousedown', (e) => e.preventDefault());
  root.append(style, box);
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

const STYLE = `
  :host { all: initial; }
  .popover {
    --bg: #ffffff; --fg: #1b1d29; --muted: #6b6f80; --border: #dfe1e8; --hover: #f2f3f7;
    --accent: #242942; --accent-fg: #ffffff; --del: #b4232a; --ins: #18794e;
    position: fixed; box-sizing: border-box; min-width: 240px; max-width: min(380px, calc(100vw - 16px));
    max-height: min(480px, calc(100vh - 16px)); overflow: auto;
    background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 8px 28px rgba(15, 17, 30, .18), 0 1px 3px rgba(15, 17, 30, .12);
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; text-align: left;
    cursor: default; user-select: none; -webkit-user-select: none;
  }
  @media (prefers-color-scheme: dark) {
    .popover { --bg: #1d1f29; --fg: #eceef4; --muted: #a0a4b5; --border: #343747; --hover: #282b38;
      --accent: #e4e6f0; --accent-fg: #15161d; --del: #ff8589; --ins: #5fd39a; }
  }
  .popover[data-kind="card"] { padding: 12px 14px; }
  .popover[data-kind="panel"] { width: 360px; padding: 0; }
  .chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
    color: var(--muted); }
  .chip::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .chip .subtype { font-weight: 400; }
  .change { margin: 8px 0 0; font-size: 14px; overflow-wrap: anywhere; }
  .change del { color: var(--del); text-decoration: line-through; text-decoration-thickness: 1px; }
  .change ins { color: var(--ins); text-decoration: none; font-weight: 600; }
  .change .arrow { color: var(--muted); margin: 0 4px; }
  .change .remove { color: var(--muted); font-size: 12px; margin-left: 6px; }
  .explanation { margin: 6px 0 0; color: var(--muted); }
  .actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  button { font: inherit; border-radius: 6px; padding: 4px 12px; cursor: pointer;
    border: 1px solid var(--border); background: transparent; color: var(--fg); }
  button:hover { background: var(--hover); }
  button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
  button.primary:hover { opacity: .9; }
  button.link { border: none; padding: 4px 2px; color: var(--muted); text-decoration: underline;
    text-underline-offset: 2px; }
  button.link:hover { background: transparent; color: var(--fg); }
  button:focus-visible { outline: 2px solid #3e63dd; outline-offset: 1px; }
  .error { margin: 8px 0 0; color: var(--del); }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 10px 14px; border-bottom: 1px solid var(--border); font-weight: 600; }
  .header button { border: none; padding: 2px 6px; color: var(--muted); font-size: 16px; line-height: 1; }
  .group { padding: 4px 0 8px; border-bottom: 1px solid var(--border); }
  .group:last-child { border-bottom: none; }
  .group-head { display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px 2px; }
  .group-head button { padding: 2px 8px; font-size: 12px; }
  .item { padding: 6px 14px; }
  .item:hover { background: var(--hover); }
  .item .change { margin: 0; font-size: 13px; display: -webkit-box; -webkit-line-clamp: 3;
    -webkit-box-orient: vertical; overflow: hidden; }
  .item .explanation { margin-top: 2px; font-size: 12px; }
  .item .actions { margin-top: 6px; }
  .item button { padding: 2px 10px; font-size: 12px; }
  .empty { padding: 16px 14px; color: var(--muted); }
  .panel-error { padding: 8px 14px 0; color: var(--del); }
`;
