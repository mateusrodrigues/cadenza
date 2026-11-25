import kitCSS from './kit.css?inline';

/**
 * Shared plumbing for Cadenza's in-page surfaces (badge, card, panel): the design system's
 * stylesheet, the theme to draw in, and where in the page to attach.
 */

const sheets = new Map<string, CSSStyleSheet | null>();

function sheetFor(css: string): CSSStyleSheet | null {
  if (!sheets.has(css)) {
    try {
      // Constructed sheets aren't subject to the page's style-src policy, unlike <style>.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      sheets.set(css, sheet);
    } catch {
      sheets.set(css, null);
    }
  }
  return sheets.get(css) ?? null;
}

/** Style a shadow root with the design system (kit.css) plus the surface's own rules. */
export function adoptStyles(root: ShadowRoot, extra = ''): void {
  const parts = [kitCSS, extra].filter(Boolean);
  const built = parts.map(sheetFor);
  if (built.every((s): s is CSSStyleSheet => s !== null)) {
    try {
      root.adoptedStyleSheets = built;
      return;
    } catch {
      // Fall through to <style>.
    }
  }
  const style = document.createElement('style');
  style.textContent = parts.join('\n');
  root.prepend(style);
}

/**
 * Follow the field, not the OS: the first opaque background up from the field decides. Dark
 * below a relative luminance of 0.18.
 */
export function themeOf(field: Element): 'light' | 'dark' {
  for (let el: Element | null = field; el; el = parentOf(el)) {
    const rgba = parseColor(getComputedStyle(el).backgroundColor);
    if (rgba && rgba[3] >= 0.9) return luminance(rgba) < 0.18 ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Where a surface for this field attaches. A modal <dialog> makes everything outside it
 * inert and covers it, so surfaces for fields inside one go inside it.
 */
export function layerFor(field: Element): Element {
  const dialog = field.closest('dialog');
  try {
    if (dialog?.matches(':modal')) return dialog;
  } catch {
    // :modal unsupported; use the document.
  }
  return document.documentElement;
}

/** Make sure `host` sits in `parent` (appending moves it; skip when already there). */
export function attach(host: Element, parent: Element): void {
  if (host.parentNode !== parent) parent.append(host);
}

function parentOf(el: Element): Element | null {
  return el.parentElement ?? ((el.getRootNode() as ShadowRoot).host || null);
}

function parseColor(value: string): [number, number, number, number] | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m?.[1]) return null;
  const [r = 0, g = 0, b = 0, a = 1] = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [r, g, b, a];
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
