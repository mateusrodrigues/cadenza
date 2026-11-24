export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The part of the viewport where `el` can be seen: the viewport intersected with every
 * ancestor that clips its overflow. Null when nothing of it is visible.
 */
export function visibleArea(el: Element): Box | null {
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
export function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** The parts of `rects` inside `area`, dropping those entirely outside it. */
export function visibleRects(rects: Iterable<DOMRect>, area: Box | null): DOMRect[] {
  if (!area) return [];
  const out: DOMRect[] = [];
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue;
    if (r.bottom <= area.top || r.top >= area.bottom) continue;
    if (r.right <= area.left || r.left >= area.right) continue;
    out.push(r);
  }
  return out;
}

/** Is the point on `rect`'s text or the underline drawn just below it? */
export function hits(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 6;
}

/** `el`'s border box intersected with the part of the viewport where it can be seen. */
export function visibleBox(el: Element): Box | null {
  const area = visibleArea(el);
  if (!area) return null;
  const r = el.getBoundingClientRect();
  const box = {
    top: Math.max(area.top, r.top),
    right: Math.min(area.right, r.right),
    bottom: Math.min(area.bottom, r.bottom),
    left: Math.max(area.left, r.left),
  };
  return box.top < box.bottom && box.left < box.right ? box : null;
}
