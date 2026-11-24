import type { BrowserContext, Locator, Page } from '@playwright/test';

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Where Cadenza's overlay draws, found by screenshotting the page with the overlay hidden and
 * shown and boxing the pixels that differ. Coordinates are page viewport pixels.
 */
export async function overlayInk(
  context: BrowserContext,
  page: Page,
  area: Locator,
): Promise<Box[]> {
  const clip = await area.boundingBox();
  if (!clip) throw new Error('area not visible');
  const pad = 40;
  const region = {
    x: Math.max(0, clip.x - pad),
    y: Math.max(0, clip.y - pad),
    width: clip.width + 2 * pad,
    height: clip.height + 2 * pad,
  };
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      for (const el of document.querySelectorAll<HTMLElement>('cadenza-overlay')) {
        el.style.visibility = h ? 'hidden' : '';
      }
      // The badge isn't an underline: keep it out of both shots.
      for (const el of document.querySelectorAll<HTMLElement>('cadenza-badge')) {
        el.style.visibility = 'hidden';
      }
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, hidden);
  await setHidden(true);
  const without = (await page.screenshot({ clip: region, caret: 'hide' })).toString('base64');
  await setHidden(false);
  const withInk = (await page.screenshot({ clip: region, caret: 'hide' })).toString('base64');
  return diffBoxes(context, without, withInk, region.x, region.y);
}

/** Pixels of the given color (±40 per channel) inside an area, boxed. */
export async function colorInk(
  context: BrowserContext,
  page: Page,
  area: Locator,
  rgb: [number, number, number],
): Promise<Box[]> {
  const clip = await area.boundingBox();
  if (!clip) throw new Error('area not visible');
  const shot = (await page.screenshot({ clip })).toString('base64');
  return analyze(context, shot, null, clip.x, clip.y, rgb);
}

async function diffBoxes(context: BrowserContext, a: string, b: string, ox: number, oy: number) {
  return analyze(context, a, b, ox, oy, null);
}

async function analyze(
  context: BrowserContext,
  a: string,
  b: string | null,
  ox: number,
  oy: number,
  rgb: [number, number, number] | null,
): Promise<Box[]> {
  const scratch = await context.newPage();
  try {
    return await scratch.evaluate(
      async ({ a, b, ox, oy, rgb }) => {
        const load = async (data: string) => {
          const img = new Image();
          img.src = `data:image/png;base64,${data}`;
          await img.decode();
          const c = new OffscreenCanvas(img.width, img.height);
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('no canvas');
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height);
        };
        const A = await load(a);
        const B = b ? await load(b) : null;
        const { width: w, height: h } = A;
        const a8 = A.data;
        const b8 = B?.data;
        const hit = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const p = i * 4;
          if (B) {
            let d = 0;
            for (let c = 0; c < 3; c++) d += Math.abs((a8[p + c] ?? 0) - (b8?.[p + c] ?? 0));
            hit[i] = d > 60 ? 1 : 0;
          } else if (rgb) {
            let near = true;
            for (let c = 0; c < 3; c++) near &&= Math.abs((a8[p + c] ?? 0) - (rgb[c] ?? 0)) < 40;
            hit[i] = near ? 1 : 0;
          }
        }
        // Connected components (8-neighbour, with a 2px gap allowed so wavy/dotted lines join).
        const seen = new Uint8Array(w * h);
        const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
        for (let i = 0; i < w * h; i++) {
          if (!hit[i] || seen[i]) continue;
          const box = { x0: w, x1: 0, y0: h, y1: 0 };
          const stack = [i];
          seen[i] = 1;
          while (stack.length) {
            const j = stack.pop() as number;
            const x = j % w;
            const y = (j - x) / w;
            box.x0 = Math.min(box.x0, x);
            box.x1 = Math.max(box.x1, x + 1);
            box.y0 = Math.min(box.y0, y);
            box.y1 = Math.max(box.y1, y + 1);
            for (let dy = -3; dy <= 3; dy++) {
              for (let dx = -3; dx <= 3; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const k = ny * w + nx;
                if (hit[k] && !seen[k]) {
                  seen[k] = 1;
                  stack.push(k);
                }
              }
            }
          }
          if ((box.x1 - box.x0) * (box.y1 - box.y0) >= 4) boxes.push(box);
        }
        return boxes
          .map((bx) => ({ x0: bx.x0 + ox, x1: bx.x1 + ox, y0: bx.y0 + oy, y1: bx.y1 + oy }))
          .sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
      },
      { a, b, ox, oy, rgb },
    );
  } finally {
    await scratch.close();
  }
}

/**
 * Where the text of `word` (line/column in a monospace field) is drawn, from the field's own
 * metrics: an independent reference for where its underline belongs.
 */
export async function expectedTextBox(
  field: Locator,
  offset: number,
  length: number,
): Promise<Box> {
  return field.evaluate(
    (el, { offset, length }) => {
      const f = el as HTMLTextAreaElement | HTMLInputElement;
      const cs = getComputedStyle(f);
      const ctx = new OffscreenCanvas(10, 10).getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
      const cw = ctx.measureText('M').width;
      const lh = Number.parseFloat(cs.lineHeight);
      const before = f.value.slice(0, offset);
      const line = before.split('\n').length - 1;
      const col = before.length - before.lastIndexOf('\n') - 1;
      const r = f.getBoundingClientRect();
      const left =
        r.left +
        Number.parseFloat(cs.borderLeftWidth) +
        Number.parseFloat(cs.paddingLeft) -
        f.scrollLeft;
      let top =
        r.top +
        Number.parseFloat(cs.borderTopWidth) +
        Number.parseFloat(cs.paddingTop) -
        f.scrollTop;
      if (f instanceof HTMLInputElement) top = r.top + (r.height - lh) / 2;
      return {
        x0: left + col * cw,
        x1: left + (col + length) * cw,
        y0: top + line * lh,
        y1: top + (line + 1) * lh,
      };
    },
    { offset, length },
  );
}

/** An underline box sits under the text box: same horizontal extent, in the lower part of the line. */
export function underlines(ink: Box, text: Box, tolerance = 3): boolean {
  return (
    Math.abs(ink.x0 - text.x0) <= tolerance &&
    Math.abs(ink.x1 - text.x1) <= tolerance &&
    ink.y0 >= text.y0 + (text.y1 - text.y0) / 2 &&
    ink.y1 <= text.y1 + 6
  );
}
