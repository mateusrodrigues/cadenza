import type { Page, Worker } from '@playwright/test';
import { expect, PAGE_URL, test } from './fixtures';
import { type Box, colorInk, expectedTextBox, overlayInk, underlines } from './pixels';
import { type StubServer, startStubServer } from './stub-server';

// Phase 4 exit: underlines stay aligned while typing, scrolling and resizing. Alignment is
// checked in pixels against an independent reference: in a monospace field the position of
// every character follows from the font's advance width and the field's metrics.

const ALIGN_URL = `${PAGE_URL}align.html`;
let stub: StubServer;
test.beforeAll(async () => {
  stub = await startStubServer(4600);
});
test.afterAll(async () => {
  await stub.close();
});

async function open(page: Page) {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(ALIGN_URL);
}

/** Every underline drawn in `field` sits under one of `words`, and every word has one. */
async function expectAligned(
  context: Parameters<typeof overlayInk>[0],
  page: Page,
  fieldSelector: string,
  words: string[],
) {
  const field = page.locator(fieldSelector);
  const value = await field.inputValue();
  const expected: Box[] = [];
  for (const w of words) expected.push(await expectedTextBox(field, value.indexOf(w), w.length));
  const ink = await overlayInk(context, page, field);
  const report = JSON.stringify({ ink, expected });
  expect(ink.length, report).toBe(words.length);
  for (const e of expected) {
    expect(
      ink.some((i) => underlines(i, e)),
      report,
    ).toBe(true);
  }
}

async function useSlowStub(worker: Worker, page: Page) {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        version: 2,
        enabled: true,
        providers: [
          {
            id: 'slow',
            name: 'Slow stub',
            presetId: 'custom',
            kind: 'openai-compatible',
            baseURL: 'http://127.0.0.1:4600/v1',
            apiKey: null,
            model: 'slow-model',
            explanations: false,
            slowMode: false,
          },
        ],
        activeProviderId: 'slow',
        dialect: 'en-US',
        categories: ['correctness', 'clarity', 'style', 'tone'],
        disabledSites: [],
      },
    });
  });
  const options = await page.context().newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'cadenza/allow-origin', origin: 'http://127.0.0.1:4600' }),
  );
  await options.close();
}

test('textarea underlines sit under their words', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#mono').click();
  await page.keyboard.type('One teh two.\nThree tomorow four.');
  await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '2');
  await expectAligned(context, page, '#mono', ['teh', 'tomorow']);
});

test('underlines follow edits before the next result arrives', async ({ context, worker }) => {
  const page = await context.newPage();
  await useSlowStub(worker, page);
  await open(page);
  await page.locator('#mono').click();
  await page.keyboard.type('One teh two.\nThree tomorow four.');
  await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '2', {
    timeout: 15_000,
  });
  const postsBefore = stub.origins.filter((o) => o?.startsWith('POST')).length;

  // Type at the start: "teh" shifts right, "tomorow" stays. Checked well inside the
  // 4 s the slow model takes, so they can only be there by following the edit.
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('Well, ');
  await expectAligned(context, page, '#mono', ['teh', 'tomorow']);
  // Add a line above: both move down a line.
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('Hi.\n');
  await expectAligned(context, page, '#mono', ['teh', 'tomorow']);
  // Edit inside a flagged word: only that underline goes.
  await page.locator('#mono').evaluate((el: HTMLTextAreaElement) => {
    const at = el.value.indexOf('teh') + 2;
    el.setSelectionRange(at, at);
  });
  await page.keyboard.type('x');
  await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '1');
  await expectAligned(context, page, '#mono', ['tomorow']);
  // No new result has arrived yet.
  expect(stub.origins.filter((o) => o?.startsWith('POST')).length).toBeLessThanOrEqual(
    postsBefore + 1,
  );
});

test('underlines follow scrolling of the field, the page and a container', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  const mono = page.locator('#mono');
  await mono.click();
  await page.keyboard.type('A tomorow line.\n2\n3\n4\n5\nThe teh line.\nend');
  await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '2');
  // Scrolled all the way down (bottom padding included): only "teh" is visible.
  await mono.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expectAligned(context, page, '#mono', ['teh']);
  await mono.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expectAligned(context, page, '#mono', ['tomorow']);
  await page.evaluate(() => window.scrollBy(0, 37));
  await expectAligned(context, page, '#mono', ['tomorow']);

  // A field inside a scrolled container: underlines never show outside the container.
  await page.evaluate(() => window.scrollTo(0, 0));
  const clipped = page.locator('#clipped');
  await clipped.click();
  await page.keyboard.type('Read teh book.\nSee you tomorow.');
  await expect(page.locator('cadenza-overlay').nth(1)).toHaveAttribute('data-count', '2');
  await expectAligned(context, page, '#clipped', ['teh', 'tomorow']);
  await page.locator('#scroller').evaluate((el) => {
    el.scrollTop = 135; // the first line of the field, underline included, is above the container
  });
  const box = await page.locator('#scroller').boundingBox();
  const ink = await overlayInk(context, page, clipped);
  expect(ink.length, JSON.stringify({ ink, box })).toBe(1);
  for (const i of ink) {
    expect(i.y0).toBeGreaterThanOrEqual((box?.y ?? 0) - 1);
    expect(i.y1).toBeLessThanOrEqual((box?.y ?? 0) + (box?.height ?? 0) + 1);
  }
  await expectAligned(context, page, '#clipped', ['tomorow']);
});

test('underlines follow the field when it is resized or moved', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  const mono = page.locator('#mono');
  await mono.click();
  await page.keyboard.type('One teh two.\nThree tomorow four.');
  await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '2');
  await mono.evaluate((el) => {
    el.style.width = '420px';
    el.style.height = '180px';
    el.style.marginLeft = '45px';
  });
  await expectAligned(context, page, '#mono', ['teh', 'tomorow']);
  // The page reflows above the field (no scroll or resize event): it follows within a moment.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '33px';
    document.body.prepend(spacer);
  });
  await page.waitForTimeout(400);
  await expectAligned(context, page, '#mono', ['teh', 'tomorow']);
  // The window is resized.
  await page.setViewportSize({ width: 700, height: 600 });
  await expectAligned(context, page, '#mono', ['teh', 'tomorow']);
});

test('fields scrolled sideways: a text input and a textarea with wrap="off"', async ({
  context,
}) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#narrow').click();
  await page.keyboard.type('aaaa bbbb cccc dddd eeee teh');
  await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '1');
  expect(await page.locator('#narrow').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expectAligned(context, page, '#narrow', ['teh']);

  await page.locator('#wrapoff').click();
  await page.keyboard.type('xxxxxxxxxxxxxxxxxxxxxx tomorow');
  await expect(page.locator('cadenza-overlay').nth(1)).toHaveAttribute('data-count', '1');
  expect(await page.locator('#wrapoff').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expectAligned(context, page, '#wrapoff', ['tomorow']);
});

test('underlines in an editor inside a shadow root', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  const editor = page.locator('#shadow-editor');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Read teh book.');
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0))
    .toBe(1);
  // The underline is painted (correctness red), not just registered.
  const red = await colorInk(context, page, editor, [0xe5, 0x48, 0x4d]);
  expect(red.length).toBeGreaterThan(0);
});

test('underlines survive an editor replacing its text nodes', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#rerender p').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Read teh book.');
  const highlighted = () =>
    page.evaluate(() =>
      [...(CSS.highlights.get('cadenza-correctness') ?? [])].map((r) => [
        r.toString(),
        (r as Range).startContainer.isConnected,
      ]),
    );
  await expect.poll(highlighted).toEqual([['teh', true]]);
  await page.keyboard.press('Home');
  await page.keyboard.type('Now ');
  // Immediately after the edit, before the next check: still on "teh", in the new node.
  await expect.poll(highlighted, { timeout: 500 }).toEqual([['teh', true]]);
});
