/**
 * Plain-text view of a contenteditable element with a map back to DOM text nodes.
 * Block boundaries and <br> become "\n" so paragraph splitting matches what the user sees.
 */
export interface TextMap {
  text: string;
  segments: { node: Text; start: number; end: number }[];
}

const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|table-row|flow-root)$/;

export function buildTextMap(root: HTMLElement): TextMap {
  let text = '';
  const segments: TextMap['segments'] = [];
  const blockCache = new Map<Element, boolean>();

  const isBlock = (el: Element): boolean => {
    let v = blockCache.get(el);
    if (v === undefined) {
      v = BLOCK_DISPLAY.test(getComputedStyle(el).display);
      blockCache.set(el, v);
    }
    return v;
  };

  const newline = () => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      const value = t.data;
      if (value.length === 0) return;
      segments.push({ node: t, start: text.length, end: text.length + value.length });
      text += value;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === 'BR') {
      text += '\n';
      return;
    }
    const block = el !== root && isBlock(el);
    if (block) newline();
    for (const child of el.childNodes) walk(child);
    if (block) newline();
  };

  walk(root);
  return { text, segments };
}

/** Map a [start, end) range in TextMap.text back to a DOM Range, or null if it can't be mapped. */
export function rangeFor(map: TextMap, start: number, end: number): Range | null {
  const a = locate(map, start, false);
  const b = locate(map, end, true);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function locate(map: TextMap, offset: number, isEnd: boolean) {
  for (const seg of map.segments) {
    const inside = isEnd
      ? offset > seg.start && offset <= seg.end
      : offset >= seg.start && offset < seg.end;
    if (inside) return { node: seg.node, offset: offset - seg.start };
  }
  return null;
}
