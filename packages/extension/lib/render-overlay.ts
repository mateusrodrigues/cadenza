import { CATEGORIES, type Suggestion } from '@cadenza/shared';
import { hits, visibleArea, visibleBox, visibleRects } from './geometry';
import type { Renderer } from './renderer';
import { trackPosition } from './track';

/** Computed styles copied from the field so the mirror lays text out identically. */
const MIRRORED = [
  'box-sizing',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
  'font-optical-sizing',
  'letter-spacing',
  'word-spacing',
  'line-height',
  'text-transform',
  'text-indent',
  'text-align',
  'text-rendering',
  'direction',
  'unicode-bidi',
  'writing-mode',
  'tab-size',
  'hyphens',
  'word-break',
  'overflow-wrap',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
] as const;

/**
 * Draws underlines for <textarea> and <input> fields, whose text isn't reachable as DOM
 * ranges. A transparent "mirror" copy of the field's text is laid over it inside a closed
 * shadow root; only the underline decorations are visible. The field itself is untouched.
 */
export class OverlayRenderer implements Renderer {
  private readonly host: HTMLElement;
  private readonly mirror: HTMLDivElement;
  private readonly untrack: () => void;
  private spans = new Map<string, { span: HTMLSpanElement; suggestion: Suggestion }>();

  constructor(private readonly field: HTMLTextAreaElement | HTMLInputElement) {
    this.host = document.createElement('cadenza-overlay');
    this.host.dataset.cadenzaOverlay = '';
    this.host.style.cssText =
      'all: initial; position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483646;';
    // Test builds open it so tests can find the underlines (see wxt.config.ts).
    const root = this.host.attachShadow({ mode: __CADENZA_E2E__ ? 'open' : 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .mirror { position: fixed; overflow: hidden; color: transparent; border-style: solid;
        border-color: transparent; background: transparent; margin: 0; }
      ${Object.values(CATEGORIES)
        .map(
          (c) => `.u-${c.id} { text-decoration: underline ${c.lineStyle} ${c.color};
            text-decoration-thickness: 2px; text-underline-offset: 3px;
            text-decoration-skip-ink: none; }`,
        )
        .join('\n')}`;
    this.mirror = document.createElement('div');
    this.mirror.className = 'mirror';
    root.append(style, this.mirror);
    document.documentElement.append(this.host);

    this.untrack = trackPosition(field, () => this.position());
  }

  render(suggestions: Suggestion[]): void {
    this.host.dataset.count = String(suggestions.length);
    const text = this.field.value;
    const frag = document.createDocumentFragment();
    this.spans.clear();
    let pos = 0;
    for (const s of suggestions) {
      if (s.start < pos || text.slice(s.start, s.end) !== s.original) continue;
      frag.append(text.slice(pos, s.start));
      const span = document.createElement('span');
      span.className = `u-${s.category}`;
      span.textContent = text.slice(s.start, s.end);
      frag.append(span);
      this.spans.set(s.id, { span, suggestion: s });
      pos = s.end;
    }
    // A trailing newline would otherwise collapse and shift the last line.
    frag.append(`${text.slice(pos)}​`);
    this.mirror.replaceChildren(frag);
    this.position();
  }

  position(): void {
    const f = this.field;
    const rect = f.getBoundingClientRect();
    const clip = f.isConnected ? visibleArea(f) : null;
    if (!clip || rect.width === 0 || rect.height === 0) {
      this.host.style.display = 'none';
      return;
    }
    this.host.style.display = '';
    const cs = getComputedStyle(f);
    const m = this.mirror.style;
    for (const prop of MIRRORED) m.setProperty(prop, cs.getPropertyValue(prop));
    const isInput = f instanceof HTMLInputElement;
    // Inputs never wrap; textareas wrap unless wrap="off" (computed white-space: pre).
    m.whiteSpace = isInput ? 'pre' : cs.whiteSpace;

    // Exclude a textarea's scrollbar so the mirror wraps at the same width. (Inputs have none,
    // and Chrome reports an input's clientWidth without its padding, so don't measure them.)
    const borderX = Number.parseFloat(cs.borderLeftWidth) + Number.parseFloat(cs.borderRightWidth);
    const scrollbar = isInput ? 0 : Math.max(0, f.offsetWidth - f.clientWidth - borderX);
    m.boxSizing = 'border-box';
    m.width = `${rect.width - scrollbar}px`;
    m.height = `${rect.height}px`;
    m.top = `${rect.top}px`;
    m.left = `${rect.left}px`;
    if (isInput) {
      const inner =
        f.clientHeight - Number.parseFloat(cs.paddingTop) - Number.parseFloat(cs.paddingBottom);
      m.lineHeight = `${inner}px`;
    }
    // Hide underlines that a scrolled container (or the window edge) hides the text under.
    m.clipPath = `inset(${Math.max(0, clip.top - rect.top)}px ${Math.max(0, rect.right - clip.right)}px ${Math.max(0, rect.bottom - clip.bottom)}px ${Math.max(0, clip.left - rect.left)}px)`;
    this.mirror.scrollTop = f.scrollTop;
    this.mirror.scrollLeft = f.scrollLeft;
  }

  hitTest(x: number, y: number): Suggestion | null {
    if (this.spans.size === 0) return null;
    this.position();
    const area = visibleBox(this.field);
    for (const { span, suggestion } of this.spans.values()) {
      if (visibleRects(span.getClientRects(), area).some((r) => hits(r, x, y))) return suggestion;
    }
    return null;
  }

  rectsOf(id: string): DOMRect[] {
    const entry = this.spans.get(id);
    if (!entry) return [];
    this.position();
    return visibleRects(entry.span.getClientRects(), visibleBox(this.field));
  }

  destroy(): void {
    this.untrack();
    this.host.remove();
  }
}
