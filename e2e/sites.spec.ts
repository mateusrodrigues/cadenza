import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Phase 5 site matrix: accept a suggestion in real editors on public demo pages (no sign-in),
// then check the editor's own state with its undo. Needs the network, so opt in with
// CADENZA_NET_TESTS=1. Uses the built-in test rules; no page text leaves the browser.

test.describe('real editors', () => {
  test.skip(process.env.CADENZA_NET_TESTS !== '1', 'set CADENZA_NET_TESTS=1 to load public sites');

  const SITES = [
    { name: 'ProseMirror', url: 'https://prosemirror.net/', editor: '.ProseMirror' },
    { name: 'Lexical', url: 'https://playground.lexical.dev/', editor: '.ContentEditable__root' },
    { name: 'Slate', url: 'https://slatejs.org/examples/richtext', editor: '[data-slate-editor]' },
  ];

  for (const site of SITES) {
    test(`${site.name}: accept updates the editor, and its undo reverts it`, async ({
      context,
    }) => {
      test.setTimeout(60_000);
      const page = await context.newPage();
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.goto(site.url, { waitUntil: 'domcontentloaded' });
      const editor = await findEditor(page, site.editor);
      await editor.click({ timeout: 10_000 });
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Read teh book.');

      const target = await page.waitForFunction(
        (selector) => {
          const el = document.querySelector(selector);
          for (const r of CSS.highlights.get('cadenza-correctness') ?? []) {
            const range = r as Range;
            if (range.toString() === 'teh' && el?.contains(range.startContainer)) {
              const rect = range.getClientRects()[0];
              if (rect) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          return null;
        },
        site.editor,
        { timeout: 15_000 },
      );
      const { x, y } = (await target.jsonValue()) as { x: number; y: number };
      await page.mouse.click(x, y);
      await page.locator('cadenza-ui button[data-action="accept"]').click();
      await expect(editor).toContainText('Read the book.');
      await expect(editor).not.toContainText('teh');
      await expect(page.locator('cadenza-ui .error')).toHaveCount(0);

      // The editor's own undo knows about the change: one undo brings the mistake back.
      await page.keyboard.press('ControlOrMeta+z');
      await expect(editor).toContainText('Read teh book.');
    });
  }
});

/** The first matching editor that is on top where it is drawn (demo pages stack several). */
async function findEditor(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    (sel) => {
      for (const el of document.querySelectorAll(sel)) {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + 20, r.top + Math.min(20, r.height / 2));
        if (r.height > 0 && top && el.contains(top)) {
          el.setAttribute('data-test-editor', '');
          return true;
        }
      }
      return false;
    },
    selector,
    { timeout: 20_000 },
  );
  return page.locator('[data-test-editor]');
}
