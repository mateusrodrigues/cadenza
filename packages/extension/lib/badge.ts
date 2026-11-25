import type { Suggestion } from '@cadenza/shared';
import { icon } from './icons';
import { adoptStyles, attach, layerFor, themeOf } from './surface';
import { trackPosition } from './track';

export type BadgeState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; suggestions: Suggestion[] }
  | { kind: 'error'; message: string }
  | { kind: 'paused'; message: string };

const SIZE = 24;
const INSET = 8;

/**
 * The field's status mark (kit: `.cdz-badge`). It sits inside the field, at the bottom right,
 * or centred on the right in single-line fields:
 * - a count when there are suggestions (always shown);
 * - "!" on errors (always shown);
 * - a turning arc while checking, the Cadenza mark when there's nothing to fix, and a pause
 *   mark when Cadenza is off here (only while the field has focus, to keep pages calm).
 * A click opens the field's panel. Count changes are announced politely, once per check.
 * Lives in a closed shadow root and never takes focus.
 */
export class FieldBadge {
  private readonly host: HTMLElement;
  private readonly badge: HTMLDivElement;
  private readonly live: HTMLSpanElement;
  private readonly untrack: () => void;
  private signature = '';
  private focused = false;
  private visible = false;

  constructor(
    private readonly field: HTMLElement,
    onClick: () => void,
  ) {
    this.host = document.createElement('cadenza-badge');
    const root = this.host.attachShadow({ mode: 'closed' });
    adoptStyles(root, STYLE);
    const wrap = document.createElement('div');
    wrap.className = 'cdz-root';
    this.badge = document.createElement('div');
    this.badge.className = 'cdz-badge';
    this.badge.setAttribute('aria-hidden', 'true');
    this.live = document.createElement('span');
    this.live.className = 'cdz-sr';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    wrap.append(this.badge, this.live);
    root.append(wrap);
    // Keep focus in the field; act on real clicks only.
    this.badge.addEventListener('mousedown', (e) => e.preventDefault());
    this.badge.addEventListener('click', (e) => {
      if (e.isTrusted && this.visible) onClick();
    });
    attach(this.host, layerFor(field));
    this.untrack = trackPosition(field, () => this.position());
    this.set({ kind: 'idle' });
  }

  get kind(): BadgeState['kind'] {
    return (this.host.dataset.state ?? 'idle') as BadgeState['kind'];
  }

  /** The field gained or lost focus: quiet states show only while it has it. */
  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.signature = '';
    this.set(this.last);
  }

  private last: BadgeState = { kind: 'idle' };

  set(state: BadgeState): void {
    this.last = state;
    // Called on every frame while typing: skip when nothing shown would change.
    const count = state.kind === 'done' ? state.suggestions.length : 0;
    const signature = `${state.kind}:${count}:${'message' in state ? state.message : ''}:${this.focused}`;
    if (signature === this.signature) return;
    const announce = state.kind !== this.kind || count !== Number(this.host.dataset.count ?? -1);
    this.signature = signature;
    this.host.dataset.state = state.kind;
    this.host.dataset.count = String(count);
    this.host.dataset.theme = themeOf(this.field);

    const b = this.badge;
    b.replaceChildren();
    b.removeAttribute('data-state');
    let title = '';
    let show = false;
    if (state.kind === 'done' && count > 0) {
      b.dataset.state = 'count';
      b.textContent = count > 99 ? '99+' : String(count);
      title = `Cadenza: ${count} ${count === 1 ? 'suggestion' : 'suggestions'}`;
      show = true;
    } else if (state.kind === 'error') {
      b.dataset.state = 'error';
      b.textContent = '!';
      title = `Cadenza: ${state.message}`;
      show = true;
    } else if (state.kind === 'paused') {
      b.dataset.state = 'paused';
      b.append(icon('pause', 14));
      title = `Cadenza: ${state.message}`;
      show = this.focused;
    } else if (state.kind === 'checking') {
      b.dataset.state = 'checking';
      b.append(icon('spinner', 14));
      title = 'Cadenza is checking…';
      show = this.focused;
    } else if (state.kind === 'done') {
      b.append(icon('fermata', 16));
      title = 'Cadenza: no suggestions';
      show = this.focused;
    }
    this.visible = show;
    b.hidden = !show;
    // Hidden, the host must never catch clicks meant for the page.
    this.host.style.pointerEvents = show ? 'auto' : 'none';
    this.host.style.visibility = show ? 'visible' : 'hidden';
    b.title = title;
    this.host.title = show ? title : '';
    // Announce settled results only (not "checking" on every pause in typing).
    if (announce && (state.kind === 'done' || state.kind === 'error') && this.focused) {
      this.live.textContent = state.kind === 'done' ? title.replace('Cadenza: ', '') : title;
    }
    this.position();
  }

  /** Where the badge is on screen (the panel opens next to it). */
  rect(): DOMRect {
    return this.badge.getBoundingClientRect();
  }

  position(): void {
    if (!this.field.isConnected || !this.visible) return;
    const r = this.field.getBoundingClientRect();
    const singleLine = this.field instanceof HTMLInputElement || r.height < SIZE + 2 * INSET + 8;
    const top = singleLine ? r.top + (r.height - SIZE) / 2 : r.bottom - SIZE - INSET;
    this.host.style.setProperty('--cdz-y', `${Math.round(top)}px`);
    this.host.style.setProperty('--cdz-x', `${Math.round(r.right - SIZE - INSET)}px`);
  }

  destroy(): void {
    this.untrack();
    this.host.remove();
  }
}

const STYLE = `
  /* The host is the badge's box (kit.css makes hosts 0×0); pages see one 24px element. */
  :host { width: ${SIZE}px !important; height: ${SIZE}px !important;
    transform: translate(var(--cdz-x, -9999px), var(--cdz-y, -9999px)) !important; }
  .cdz-badge { position: static; user-select: none; -webkit-user-select: none; }
  .cdz-badge[hidden] { display: none; }
  .cdz-badge svg { display: block; }
`;
