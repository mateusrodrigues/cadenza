import type { Page } from '@playwright/test';
import { expect, PAGE_URL } from './fixtures';

// Helpers for tests that click underlines and card buttons (test builds open those shadow roots).

export const APPLY_URL = `${PAGE_URL}apply.html`;

export async function open(page: Page) {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(APPLY_URL);
}

/** Center of the underlined `word` in the field, from the drawn underline itself. */
export async function underline(page: Page, field: string, word: string) {
  const handle = await page.waitForFunction(
    ([selector, w]) => {
      const el = document.querySelector(selector as string) as HTMLElement;
      const box = el.getBoundingClientRect();
      const inField = (r: DOMRect) =>
        r.width > 0 && r.left >= box.left && r.right <= box.right && r.top >= box.top;
      const rects: DOMRect[] = [];
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        for (const o of document.querySelectorAll('cadenza-overlay')) {
          for (const s of o.shadowRoot?.querySelectorAll('span') ?? []) {
            if (s.textContent === w) rects.push(...s.getClientRects());
          }
        }
      } else {
        for (const [, h] of CSS.highlights) {
          for (const r of h as Highlight) {
            if (r.toString() === w && el.contains((r as Range).startContainer)) {
              rects.push(...(r as Range).getClientRects());
            }
          }
        }
      }
      const r = rects.find(inField);
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    },
    [field, word],
  );
  return (await handle.jsonValue()) as { x: number; y: number };
}

export async function clickUnderline(page: Page, field: string, word: string) {
  const { x, y } = await underline(page, field, word);
  await page.mouse.click(x, y);
  await expect(page.locator('cadenza-ui .cdz-card')).toBeVisible();
}

export const card = (page: Page) => page.locator('cadenza-ui .cdz-card');
export const cardButton = (page: Page, action: string) =>
  page.locator(`cadenza-ui .cdz-card button[data-action="${action}"]`);
export const overlayCount = (page: Page, n: number) =>
  expect(page.locator(`cadenza-overlay[data-count="${n}"]`)).toHaveCount(1);
