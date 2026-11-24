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
 * Lives in a closed shadow root and never takes focus. Full card/panel UI arrives in Phase 5.
 */
export class FieldBadge {
  private readonly host: HTMLElement;
  private readonly dot: HTMLDivElement;
  private readonly untrack: () => void;

  constructor(private readonly field: HTMLElement) {
    this.host = document.createElement('cadenza-badge');
    this.host.style.cssText =
      'all: initial; position: absolute; z-index: 2147483646; pointer-events: none;';
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .dot { box-sizing: border-box; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
        display: none; align-items: center; justify-content: center; color: #fff;
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
    document.documentElement.append(this.host);
    this.untrack = trackPosition(field, () => this.position());
    this.set({ kind: 'idle' });
  }

  get kind(): BadgeState['kind'] {
    return (this.host.dataset.state ?? 'idle') as BadgeState['kind'];
  }

  set(state: BadgeState): void {
    this.host.dataset.state = state.kind;
    // Hoverable only when there is an error to explain; otherwise never intercept clicks.
    this.host.style.pointerEvents = state.kind === 'error' ? 'auto' : 'none';
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
      }
    } else if (state.kind === 'error') {
      this.dot.textContent = '!';
      this.host.title = `Cadenza: ${state.message}`;
      this.dot.style.background = '';
    }
    this.position();
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
