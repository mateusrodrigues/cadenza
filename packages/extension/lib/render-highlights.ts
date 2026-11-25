import { CATEGORIES, CATEGORY_IDS, type Category, type Suggestion } from '@cadenza/shared';
import { hits, visibleBox, visibleRects } from './geometry';
import type { Renderer } from './renderer';
import { buildTextMap, rangeFor, type TextMap } from './text-map';

const STYLE_ID = 'cadenza-highlight-style';

/**
 * Draws underlines in contenteditable editors with the CSS Custom Highlight API. Ranges are
 * registered with the browser; the editor's DOM is never modified, so frameworks like React,
 * ProseMirror or Lexical don't see foreign nodes.
 *
 * Highlights are document-wide, so all editable fields in a document share one Highlight per
 * category; each renderer adds and removes only its own ranges.
 */
export class HighlightRenderer implements Renderer {
  private ranges = new Map<Range, Suggestion>();
  private active: string | null = null;
  private activeRange: { range: Range; category: Category } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onCount: (n: number) => void = () => {},
  ) {
    ensureStyle(root.getRootNode());
  }

  render(suggestions: Suggestion[], map: TextMap = buildTextMap(this.root)): void {
    this.clear();
    for (const s of suggestions) {
      if (map.text.slice(s.start, s.end) !== s.original) continue;
      const range = rangeFor(map, s.start, s.end);
      if (!range) continue;
      this.ranges.set(range, s);
      highlightFor(s.category).add(range);
    }
    this.setActive(this.active);
    this.onCount(this.ranges.size);
  }

  setActive(id: string | null): void {
    if (this.activeRange) {
      activeFor(this.activeRange.category).delete(this.activeRange.range);
      this.activeRange = null;
    }
    this.active = id;
    for (const [range, s] of this.ranges) {
      if (s.id !== id) continue;
      activeFor(s.category).add(range);
      this.activeRange = { range, category: s.category };
    }
  }

  reveal(id: string): void {
    if (this.rectsOf(id).length > 0) return;
    for (const [range, s] of this.ranges) {
      if (s.id === id) range.startContainer.parentElement?.scrollIntoView({ block: 'nearest' });
    }
  }

  hitTest(x: number, y: number): Suggestion | null {
    const area = visibleBox(this.root);
    for (const [range, s] of this.ranges) {
      if (visibleRects(range.getClientRects(), area).some((r) => hits(r, x, y))) return s;
    }
    return null;
  }

  rectsOf(id: string): DOMRect[] {
    for (const [range, s] of this.ranges) {
      if (s.id === id) return visibleRects(range.getClientRects(), visibleBox(this.root));
    }
    return [];
  }

  private clear(): void {
    if (this.activeRange) activeFor(this.activeRange.category).delete(this.activeRange.range);
    this.activeRange = null;
    for (const [range, s] of this.ranges) highlightFor(s.category).delete(range);
    this.ranges.clear();
  }

  destroy(): void {
    this.clear();
    this.onCount(0);
  }
}

function highlightName(c: Category): string {
  return `cadenza-${c}`;
}

function activeFor(c: Category): Highlight {
  return highlightFor(c, `cadenza-active-${c}`);
}

function highlightFor(c: Category, name = highlightName(c)): Highlight {
  let h = CSS.highlights.get(name);
  if (!h) {
    h = new Highlight();
    h.priority = 10 - CATEGORIES[c].priority;
    CSS.highlights.set(name, h);
  }
  return h;
}

/**
 * `::highlight()` rules only apply in the tree that holds them, so an editor inside a shadow
 * root needs its own copy.
 */
function ensureStyle(root: Node): void {
  const target = root instanceof ShadowRoot ? root : document;
  if (target.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CATEGORY_IDS.map((id) => {
    const c = CATEGORIES[id];
    return `::highlight(${highlightName(id)}) { text-decoration: underline ${c.lineStyle} ${c.color}; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
::highlight(cadenza-active-${id}) { background-color: ${c.tint}; }`;
  }).join('\n');
  if (target instanceof ShadowRoot) target.append(style);
  else (document.head ?? document.documentElement).append(style);
}
