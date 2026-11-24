import { CATEGORIES, CATEGORY_IDS, type Category, type Suggestion } from '@cadenza/shared';
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

  constructor(
    private readonly root: HTMLElement,
    private readonly onCount: (n: number) => void = () => {},
  ) {
    ensureStyle();
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
    this.onCount(this.ranges.size);
  }

  /**
   * Live Ranges move with DOM edits, so most underlines follow the text automatically. Drop
   * any whose text no longer matches the suggestion.
   */
  revalidate(): void {
    for (const [range, s] of this.ranges) {
      if (range.toString() !== s.original) {
        highlightFor(s.category).delete(range);
        this.ranges.delete(range);
      }
    }
    this.onCount(this.ranges.size);
  }

  /** Suggestions currently drawn, with their live ranges (used for hit-testing in Phase 5). */
  entries(): [Range, Suggestion][] {
    return [...this.ranges];
  }

  private clear(): void {
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

function highlightFor(c: Category): Highlight {
  const name = highlightName(c);
  let h = CSS.highlights.get(name);
  if (!h) {
    h = new Highlight();
    h.priority = 10 - CATEGORIES[c].priority;
    CSS.highlights.set(name, h);
  }
  return h;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CATEGORY_IDS.map((id) => {
    const c = CATEGORIES[id];
    return `::highlight(${highlightName(id)}) { text-decoration: underline ${c.lineStyle} ${c.color}; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-skip-ink: none; }`;
  }).join('\n');
  (document.head ?? document.documentElement).append(style);
}
