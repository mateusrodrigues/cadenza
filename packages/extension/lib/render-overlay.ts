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
  private spans = new Map<string, { spans: HTMLSpanElement[]; suggestion: Suggestion }>();
  private lines: { key: string; el: HTMLDivElement }[] = [];
  private active: string | null = null;

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
      /* Lines are blocks here, but the field indents only its first line. */
      .mirror > div + div { text-indent: 0; }
      ${Object.values(CATEGORIES)
        .map(
          (c) => `.u-${c.id} { text-decoration: underline ${c.lineStyle} ${c.color};
            text-decoration-thickness: 2px; text-underline-offset: 3px;
            text-decoration-skip-ink: none; }
          .u-${c.id}.a { background: ${c.tint}; border-radius: 2px; }`,
        )
        .join('\n')}`;
    this.mirror = document.createElement('div');
    this.mirror.className = 'mirror';
    root.append(style, this.mirror);
    document.documentElement.append(this.host);

    this.untrack = trackPosition(field, () => this.position());
  }

  /**
   * One block per line of the field's text, so an edit re-lays out only its own line and the
   * browser reuses the layout of the rest (long documents stay fast to type in). Lines that
   * didn't change keep their elements.
   */
  render(suggestions: Suggestion[]): void {
    this.host.dataset.count = String(suggestions.length);
    const f = this.field;
    if (f instanceof HTMLInputElement || getComputedStyle(f).whiteSpace === 'pre') {
      // Fields that scroll sideways keep the text in one flow: Chrome measures a scroll
      // container's width without its end padding when the text sits in child blocks.
      this.renderFlat(suggestions);
    } else {
      this.renderLines(suggestions);
    }
    this.setActive(this.active);
    this.position();
  }

  setActive(id: string | null): void {
    this.active = id;
    for (const [key, { spans }] of this.spans) {
      for (const span of spans) span.classList.toggle('a', key === id);
    }
  }

  reveal(id: string): void {
    const span = this.spans.get(id)?.spans[0];
    if (!span) return;
    this.field.scrollIntoView({ block: 'nearest' });
    this.position();
    const f = this.field;
    // The mirror scrolls with the field, so the span's offset is its place in the field.
    const top = span.offsetTop;
    if (top < f.scrollTop || top + span.offsetHeight > f.scrollTop + f.clientHeight) {
      f.scrollTop = Math.max(0, top - f.clientHeight / 3);
    }
    const left = span.offsetLeft;
    if (left < f.scrollLeft || left + span.offsetWidth > f.scrollLeft + f.clientWidth) {
      f.scrollLeft = Math.max(0, left - f.clientWidth / 3);
    }
    this.position();
  }

  private renderFlat(suggestions: Suggestion[]): void {
    const text = this.field.value;
    const frag = document.createDocumentFragment();
    this.spans.clear();
    this.lines = [];
    let pos = 0;
    for (const s of suggestions) {
      if (s.start < pos || text.slice(s.start, s.end) !== s.original) continue;
      frag.append(text.slice(pos, s.start));
      const span = document.createElement('span');
      span.className = `u-${s.category}`;
      span.textContent = text.slice(s.start, s.end);
      frag.append(span);
      this.spans.set(s.id, { spans: [span], suggestion: s });
      pos = s.end;
    }
    // A trailing newline would otherwise collapse and shift the last line.
    frag.append(`${text.slice(pos)}\u200b`);
    this.mirror.replaceChildren(frag);
  }

  private renderLines(suggestions: Suggestion[]): void {
    const lines = layoutLines(this.field.value, suggestions);
    if (this.lines.length === 0) this.mirror.replaceChildren();
    const old = this.lines;
    // Reuse unchanged lines from the start and the end; rebuild the ones in between.
    let head = 0;
    while (head < old.length && head < lines.length && old[head]?.key === lines[head]?.key) head++;
    let tail = 0;
    while (
      tail < old.length - head &&
      tail < lines.length - head &&
      old[old.length - 1 - tail]?.key === lines[lines.length - 1 - tail]?.key
    ) {
      tail++;
    }
    const before = old[old.length - tail]?.el ?? null;
    for (const line of old.slice(head, old.length - tail)) line.el.remove();
    const fresh = lines
      .slice(head, lines.length - tail)
      .map((l) => ({ key: l.key, el: buildLine(l) }));
    const frag = document.createDocumentFragment();
    for (const l of fresh) frag.append(l.el);
    this.mirror.insertBefore(frag, before);
    this.lines = [...old.slice(0, head), ...fresh, ...old.slice(old.length - tail)];

    this.spans.clear();
    this.lines.forEach((line, i) => {
      const spec = lines[i];
      if (!spec) return;
      line.el.querySelectorAll('span').forEach((span, j) => {
        const seg = spec.marks[j];
        if (!seg) return;
        const entry = this.spans.get(seg.suggestion.id);
        if (entry) entry.spans.push(span);
        else this.spans.set(seg.suggestion.id, { spans: [span], suggestion: seg.suggestion });
      });
    });
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
    for (const { spans, suggestion } of this.spans.values()) {
      if (
        spans.some((span) => visibleRects(span.getClientRects(), area).some((r) => hits(r, x, y)))
      )
        return suggestion;
    }
    return null;
  }

  rectsOf(id: string): DOMRect[] {
    const entry = this.spans.get(id);
    if (!entry) return [];
    this.position();
    const rects = entry.spans.flatMap((span) => Array.from(span.getClientRects()));
    return visibleRects(rects, visibleBox(this.field));
  }

  destroy(): void {
    this.untrack();
    this.host.remove();
  }
}

interface LineSpec {
  /** Text and marks of the line; equal keys render identically. */
  key: string;
  text: string;
  marks: { start: number; end: number; suggestion: Suggestion }[];
}

/** Split the text into lines, with each suggestion cut into the lines it covers. */
export function layoutLines(text: string, suggestions: Suggestion[]): LineSpec[] {
  const valid: Suggestion[] = [];
  let pos = 0;
  for (const s of suggestions) {
    if (s.start < pos || text.slice(s.start, s.end) !== s.original) continue;
    valid.push(s);
    pos = s.end;
  }
  const out: LineSpec[] = [];
  let lineStart = 0;
  let k = 0;
  for (const line of text.split('\n')) {
    const lineEnd = lineStart + line.length;
    while (k < valid.length && (valid[k] as Suggestion).end <= lineStart) k++;
    const marks: LineSpec['marks'] = [];
    for (let j = k; j < valid.length; j++) {
      const s = valid[j] as Suggestion;
      if (s.start >= lineEnd) break;
      const start = Math.max(s.start, lineStart) - lineStart;
      const end = Math.min(s.end, lineEnd) - lineStart;
      if (end > start) marks.push({ start, end, suggestion: s });
    }
    const key = `${line}\u0000${marks.map((m) => `${m.start}:${m.end}:${m.suggestion.category}:${m.suggestion.id}`).join(',')}`;
    out.push({ key, text: line, marks });
    lineStart = lineEnd + 1;
  }
  return out;
}

function buildLine(line: LineSpec): HTMLDivElement {
  const div = document.createElement('div');
  let pos = 0;
  for (const m of line.marks) {
    if (m.start > pos) div.append(line.text.slice(pos, m.start));
    const span = document.createElement('span');
    span.className = `u-${m.suggestion.category}`;
    span.textContent = line.text.slice(m.start, m.end);
    div.append(span);
    pos = m.end;
  }
  if (pos < line.text.length) div.append(line.text.slice(pos));
  // An empty line still takes a line's height, as it does in the field.
  if (line.text === '') div.append(document.createElement('br'));
  return div;
}
