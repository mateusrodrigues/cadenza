import { CATEGORIES, type Category, type Suggestion } from '@cadenza/shared';
import { trackPosition } from './track';

export type BadgeState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; suggestions: Suggestion[] }
  | { kind: 'error'; message: string };

const SIZE = 18;

/**
 * Small status mark in the bottom-right corner of a field: a pulsing ring while checking,
 * a count colored by the most important category when there are suggestions, "!" on errors.
 * A click opens the field's panel. Lives in a closed shadow root and never takes focus.
 */
export class FieldBadge {
  private readonly host: HTMLElement;
  private readonly dot: HTMLDivElement;
  private readonly untrack: () => void;
  private signature = '';

  constructor(
    private readonly field: HTMLElement,
    onClick: () => void,
  ) {
    this.host = document.createElement('cadenza-badge');
    this.host.style.cssText =
      'all: initial; position: absolute; z-index: 2147483646; pointer-events: none;';
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .dot { box-sizing: border-box; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
        display: none; align-items: center; justify-content: center; color: #fff; cursor: pointer;
        font: 600 11px/1 system-ui, sans-serif; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
      .dot[data-kind="checking"] { display: flex; background: transparent; box-shadow: none;
        border: 2px solid #8b8fa3; border-top-color: transparent;
        animation: spin 0.9s linear infinite; }
      .dot[data-kind="done"] { display: flex; }
      .dot[data-kind="error"] { display: flex; background: #6b6f80; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .dot[data-kind="checking"] { animation: none; border-top-color: #8b8fa3; opacity: .6; }
      }`;
    this.dot = document.createElement('div');
    this.dot.className = 'dot';
    root.append(style, this.dot);
    // Keep focus in the field; act on real clicks only.
    this.host.addEventListener('mousedown', (e) => e.preventDefault());
    this.host.addEventListener('click', (e) => {
      if (e.isTrusted && this.host.style.pointerEvents === 'auto') onClick();
    });
    document.documentElement.append(this.host);
    this.untrack = trackPosition(field, () => this.position());
    this.set({ kind: 'idle' });
  }

  get kind(): BadgeState['kind'] {
    return (this.host.dataset.state ?? 'idle') as BadgeState['kind'];
  }

  set(state: BadgeState): void {
    // Called on every frame while typing: skip when nothing shown would change.
    const signature =
      state.kind === 'done'
        ? `done:${state.suggestions.length}:${state.suggestions.length ? topCategory(state.suggestions) : ''}`
        : state.kind === 'error'
          ? `error:${state.message}`
          : state.kind;
    if (signature === this.signature) return;
    this.signature = signature;
    this.host.dataset.state = state.kind;
    // Clickable only when there's something to show; otherwise never intercept clicks.
    const active =
      state.kind === 'error' || (state.kind === 'done' && state.suggestions.length > 0);
    this.host.style.pointerEvents = active ? 'auto' : 'none';
    this.dot.dataset.kind = state.kind;
    this.dot.textContent = '';
    this.host.title = '';
    if (state.kind === 'done') {
      const n = state.suggestions.length;
      this.host.dataset.count = String(n);
      if (n === 0) {
        this.dot.dataset.kind = 'idle';
      } else {
        this.dot.textContent = n > 99 ? '99+' : String(n);
        this.dot.style.background = CATEGORIES[topCategory(state.suggestions)].color;
        this.host.title = `Cadenza: ${n} ${n === 1 ? 'suggestion' : 'suggestions'}`;
      }
    } else if (state.kind === 'error') {
      this.dot.textContent = '!';
      this.host.title = `Cadenza: ${state.message}`;
      this.dot.style.background = '';
    }
    this.position();
  }

  /** Where the badge is on screen (the panel opens next to it). */
  rect(): DOMRect {
    return this.dot.getBoundingClientRect();
  }

  position(): void {
    if (!this.field.isConnected) return;
    const r = this.field.getBoundingClientRect();
    this.host.style.top = `${r.bottom + window.scrollY - SIZE - 6}px`;
    this.host.style.left = `${r.right + window.scrollX - SIZE - 6}px`;
  }

  destroy(): void {
    this.untrack();
    this.host.remove();
  }
}

function topCategory(suggestions: Suggestion[]): Category {
  return suggestions.reduce<Category>(
    (best, s) => (CATEGORIES[s.category].priority < CATEGORIES[best].priority ? s.category : best),
    suggestions[0]?.category ?? 'correctness',
  );
}
