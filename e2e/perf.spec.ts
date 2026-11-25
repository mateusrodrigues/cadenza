import type { Page } from '@playwright/test';
import { expect, PAGE_URL, test } from './fixtures';

// Phase 7 performance budget: Cadenza's own work per input event stays under 4 ms while typing
// in long documents with many underlines. Test builds time the input handler and the per-frame
// underline update (lib/perf.ts).

const BUDGET_MS = 4;

async function stats(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('cadenza-perf')));
  const raw = await page.evaluate(() => document.documentElement.dataset.cadenzaPerf ?? '{}');
  const samples = JSON.parse(raw) as Record<string, number[]>;
  const summary: Record<string, { n: number; p50: number; p95: number; max: number }> = {};
  for (const [name, list] of Object.entries(samples)) {
    const sorted = [...list].sort((a, b) => a - b);
    const at = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    summary[name] = { n: list.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? 0 };
  }
  return summary;
}

for (const [field, settle] of [
  ['#long-textarea', 'overlay'],
  ['#long-editor', 'highlights'],
] as const) {
  test(`typing in a long document stays under ${BUDGET_MS} ms per input event (${field})`, async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`${PAGE_URL}perf.html`);
    await page.locator(field).click();
    // Let the first check draw every underline.
    if (settle === 'overlay') {
      await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '180', {
        timeout: 15_000,
      });
    } else {
      await expect
        .poll(() => page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0), {
          timeout: 15_000,
        })
        .toBe(120);
    }
    await stats(page); // reset

    // Type in the middle of the document, where every later underline has to move.
    await page.locator(field).evaluate((el) => {
      if (el instanceof HTMLTextAreaElement) el.setSelectionRange(5000, 5000);
      else {
        const p = el.children[30]?.firstChild;
        if (p) getSelection()?.collapse(p, 10);
      }
    });
    await page.keyboard.type(' and some more words typed here', { delay: 20 });
    await page.waitForTimeout(100);
    const s = await stats(page);
    test.info().annotations.push({ type: 'perf', description: JSON.stringify(s) });
    console.log(field, JSON.stringify(s));
    expect(s.input?.n).toBeGreaterThan(0);
    expect(s.frame?.n).toBeGreaterThan(0);
    expect(s.input?.p95 ?? 0).toBeLessThan(BUDGET_MS);
    expect(s.frame?.p95 ?? 0).toBeLessThan(BUDGET_MS);
  });
}
