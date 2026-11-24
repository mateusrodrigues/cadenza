import { CATEGORIES, type Suggestion } from '@cadenza/shared';
import type { Renderer } from './renderer';
import { trackPosition } from './track';

/** Computed styles copied from the field so the mirror wraps text identically. */
const MIRRORED = [
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'fontStretch',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'textAlign',
  'direction',
  'tabSize',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const;

/**
 * Draws underlines for <textarea> and <input> fields, whose text isn't reachable as DOM
 * ranges. A transparent "mirror" copy of the field's text is laid over it inside a closed
 * shadow root; only the underline decorations are visible. The field itself is untouched.
 */
export class OverlayRenderer implements Renderer {
  private readonly host: HTMLElement;
  private readonly mirror: HTMLDivElement;
  private suggestions: Suggestion[] = [];
  private readonly untrack: () => void;

  constructor(private readonly field: HTMLTextAreaElement | HTMLInputElement) {
    this.host = document.createElement('cadenza-overlay');
    this.host.dataset.cadenzaOverlay = '';
    this.host.style.cssText =
      'all: initial; position: absolute; top: 0; left: 0; pointer-events: none; z-index: 2147483646;';
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .mirror { position: absolute; overflow: hidden; color: transparent; border-style: solid;
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
    this.suggestions = suggestions;
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

  /** Keep only suggestions whose text is still intact after an edit. */
  revalidate(): void {
    const text = this.field.value;
    const still = this.suggestions.filter((s) => text.slice(s.start, s.end) === s.original);
    if (still.length !== this.suggestions.length) this.render(still);
    else this.position();
  }

  position(): void {
    const f = this.field;
    if (!f.isConnected) return;
    const cs = getComputedStyle(f);
    const m = this.mirror.style;
    for (const prop of MIRRORED) m[prop] = cs[prop];
    const isInput = f instanceof HTMLInputElement;
    m.whiteSpace = isInput ? 'pre' : 'pre-wrap';
    m.overflowWrap = isInput ? 'normal' : 'break-word';
    m.wordBreak = cs.wordBreak;

    const rect = f.getBoundingClientRect();
    // Exclude the field's scrollbar so the mirror wraps at the same width.
    const borderX = Number.parseFloat(cs.borderLeftWidth) + Number.parseFloat(cs.borderRightWidth);
    const scrollbar = Math.max(0, f.offsetWidth - f.clientWidth - borderX);
    m.boxSizing = 'border-box';
    m.width = `${rect.width - scrollbar}px`;
    m.height = `${rect.height}px`;
    m.top = `${rect.top + window.scrollY}px`;
    m.left = `${rect.left + window.scrollX}px`;
    if (isInput)
      m.lineHeight = `${f.clientHeight - Number.parseFloat(cs.paddingTop) - Number.parseFloat(cs.paddingBottom)}px`;
    this.mirror.scrollTop = f.scrollTop;
    this.mirror.scrollLeft = f.scrollLeft;
  }

  destroy(): void {
    this.untrack();
    this.host.remove();
  }
}
