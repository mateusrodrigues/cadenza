import { CATEGORIES, type Suggestion } from '@cadenza/shared';
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

  constructor(private readonly field: HTMLTextAreaElement | HTMLInputElement) {
    this.host = document.createElement('cadenza-overlay');
    this.host.dataset.cadenzaOverlay = '';
    this.host.style.cssText =
      'all: initial; position: fixed; top: 0; left: 0; pointer-events: none; z-index: 2147483646;';
    const root = this.host.attachShadow({ mode: 'closed' });
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
    let pos = 0;
    for (const s of suggestions) {
      if (s.start < pos || text.slice(s.start, s.end) !== s.original) continue;
      frag.append(text.slice(pos, s.start));
      const span = document.createElement('span');
      span.className = `u-${s.category}`;
      span.textContent = text.slice(s.start, s.end);
      frag.append(span);
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

  destroy(): void {
    this.untrack();
    this.host.remove();
  }
}

/**
 * The part of the viewport where `el` can be seen: the viewport intersected with every
 * ancestor that clips its overflow. Null when nothing of it is visible.
 */
function visibleArea(
  el: Element,
): { top: number; right: number; bottom: number; left: number } | null {
  if (getComputedStyle(el).visibility === 'hidden') return null;
  let top = 0;
  let left = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  let node: Element | null = parentOf(el);
  while (node && node !== document.documentElement && node !== document.body) {
    const cs = getComputedStyle(node);
    if (cs.display === 'none') return null;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const r = node.getBoundingClientRect();
      const t = r.top + node.clientTop;
      const l = r.left + node.clientLeft;
      if (cs.overflowY !== 'visible') {
        top = Math.max(top, t);
        bottom = Math.min(bottom, t + node.clientHeight);
      }
      if (cs.overflowX !== 'visible') {
        left = Math.max(left, l);
        right = Math.min(right, l + node.clientWidth);
      }
    }
    if (cs.position === 'fixed') break;
    node = parentOf(node);
  }
  return top < bottom && left < right ? { top, right, bottom, left } : null;
}

/** The parent element, crossing out of shadow roots. */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}
