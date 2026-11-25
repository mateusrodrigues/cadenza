import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Phase 5 site matrix: accept a suggestion in real editors on public demo pages (no sign-in),
// then check the editor's own state with its undo. Needs the network, so opt in with
// CADENZA_NET_TESTS=1. Uses the built-in test rules; no page text leaves the browser.

test.describe('real editors', () => {
  test.skip(process.env.CADENZA_NET_TESTS !== '1', 'set CADENZA_NET_TESTS=1 to load public sites');

  const SITES: { name: string; url: string; editor: string; undoMergesTyping?: boolean }[] = [
    { name: 'ProseMirror', url: 'https://prosemirror.net/', editor: '.ProseMirror' },
    { name: 'Lexical', url: 'https://playground.lexical.dev/', editor: '.ContentEditable__root' },
    { name: 'Slate', url: 'https://slatejs.org/examples/richtext', editor: '[data-slate-editor]' },
    // Phase 7 additions: the editors behind common mail, chat and social sites.
    // Quill isn't here: its public demos don't take focus under automation. Check it by hand.
    { name: 'Draft.js', url: 'https://draftjs.org/', editor: '.public-DraftEditor-content' },
    // Trix folds an edit into the typing just before it, so one undo removes both.
    {
      name: 'Trix',
      url: 'https://trix-editor.org/',
      editor: 'trix-editor',
      undoMergesTyping: true,
    },
    // Sets spellcheck="false" on its editable, like Gmail; still a writing field.
    {
      name: 'CKEditor 5',
      url: 'https://ckeditor.com/ckeditor-5/demo/feature-rich/',
      editor: '.ck-editor__editable',
    },
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
      // Near the start: demo content can hold images whose click opens a caption box.
      await editor.click({ position: { x: 24, y: 12 }, timeout: 10_000 });
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Read teh book.');

      const target = await page.waitForFunction(
        () => {
          // findEditor marked its parent; it may sit in an open shadow root.
          const deep = (root: Document | ShadowRoot): Element | null =>
            root.querySelector('[data-test-editor-parent]') ??
            Array.from(root.querySelectorAll('*'))
              .map((n) => (n.shadowRoot ? deep(n.shadowRoot) : null))
              .find(Boolean) ??
            null;
          const el = deep(document);
          for (const r of CSS.highlights.get('cadenza-correctness') ?? []) {
            const range = r as Range;
            if (range.toString() === 'teh' && el?.contains(range.startContainer)) {
              const rect = range.getClientRects()[0];
              if (rect) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          return null;
        },
        undefined,
        { timeout: 15_000 },
      );
      const { x, y } = (await target.jsonValue()) as { x: number; y: number };
      await page.mouse.click(x, y);
      await page.locator('cadenza-ui button[data-action="accept"]').click();
      await expect(editor).toContainText('Read the book.');
      await expect(editor).not.toContainText('teh');
      await expect(page.locator('cadenza-ui .cdz-error:not([hidden])')).toHaveCount(0);

      // The editor's own undo knows about the change: one undo brings the mistake back.
      await page.keyboard.press('ControlOrMeta+z');
      if (site.undoMergesTyping) await expect(editor).not.toContainText('Read the book.');
      else await expect(editor).toContainText('Read teh book.');
    });
  }
});

test.describe('code editors', () => {
  test.skip(process.env.CADENZA_NET_TESTS !== '1', 'set CADENZA_NET_TESTS=1 to load public sites');

  test('CodeMirror: code is never checked', async ({ context }) => {
    test.setTimeout(60_000);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('https://codemirror.net/', { waitUntil: 'domcontentloaded' });
    const editor = await findEditor(page, '.cm-content');
    await editor.click({ timeout: 10_000 });
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('// Read teh book.');
    await page.waitForTimeout(2500);
    const marked = await page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0);
    expect(marked).toBe(0);
    await expect(page.locator('cadenza-badge')).toHaveCount(0);
  });
});

/** The first matching editor that is on top where it is drawn (demo pages stack several). */
async function findEditor(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    (sel) => {
      // Includes editors inside open shadow roots (CKEditor's demo is a web component).
      const all = (root: Document | ShadowRoot): Element[] => [
        ...root.querySelectorAll(sel),
        ...Array.from(root.querySelectorAll('*')).flatMap((n) =>
          n.shadowRoot ? all(n.shadowRoot) : [],
        ),
      ];
      for (const el of all(document)) {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        // Editors taller than the window start above it; probe the middle of the visible part.
        const y = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2;
        let top = document.elementFromPoint(r.left + 20, y);
        while (top?.shadowRoot) {
          const inner = top.shadowRoot.elementFromPoint(r.left + 20, y);
          if (!inner || inner === top) break;
          top = inner;
        }
        if (r.height > 0 && top && el.contains(top)) {
          // On the parent: some editors (CKEditor) reset their own root's attributes.
          el.parentElement?.setAttribute('data-test-editor-parent', '');
          return true;
        }
      }
      return false;
    },
    selector,
    { timeout: 20_000 },
  );
  return page.locator(`[data-test-editor-parent] > ${selector}`).first();
}
