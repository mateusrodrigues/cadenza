import { expect, PAGE_URL, test } from './fixtures';

// These tests run against the built-in test rules (mock provider), so they need no model.

test('underlines mistakes in a textarea', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.locator('#textarea').click();
  await page.keyboard.type('Their going to the store tomorow.\nThis is very unique.');
  // "Their going", "tomorow", "very unique"
  await expect(page.locator('cadenza-overlay[data-count="3"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/textarea.png' });
});

test('underlines mistakes in a text input', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.locator('#input').click();
  await page.keyboard.type('I will recieve it ASAP');
  await expect(page.locator('cadenza-overlay[data-count="2"]')).toHaveCount(1);
});

test('drops an underline as soon as its text is edited, then rechecks', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const field = page.locator('#textarea');
  await field.click();
  await page.keyboard.type('Read teh book.');
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(1);
  await field.fill('');
  await page.keyboard.type('Read the book.');
  await expect(page.locator('cadenza-overlay[data-count="0"]')).toHaveCount(1);
});

test('underlines mistakes in a contenteditable editor with the Highlight API', async ({
  context,
}) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.locator('#editor p').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' This is very unique and teh best.');
  // The content script registers highlights in its isolated world; the page's main world
  // sees the same registry.
  await expect
    .poll(() =>
      page.evaluate(() => ({
        correctness: CSS.highlights.get('cadenza-correctness')?.size ?? 0,
        style: CSS.highlights.get('cadenza-style')?.size ?? 0,
      })),
    )
    .toEqual({ correctness: 1, style: 1 });
  // The editor's DOM is untouched: still one <p> with plain text.
  await expect(page.locator('#editor')).toHaveJSProperty(
    'innerHTML',
    '<p>First paragraph. This is very unique and teh best.</p>',
  );
  await page.screenshot({ path: 'test-results/contenteditable.png' });
});

test('stays off password fields and opted-out fields', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.locator('#password').click();
  await page.keyboard.type('teh');
  await page.locator('#optout').click();
  await page.keyboard.type('teh');
  await page.waitForTimeout(1500);
  await expect(page.locator('cadenza-overlay')).toHaveCount(0);
});

test('checks rich editors that turn spellcheck off (Gmail), but not code editors', async ({
  context,
}) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const correctness = () =>
    page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0);
  for (const id of ['#code-mono', '#code-cm']) {
    await page.locator(id).click();
    await page.keyboard.type('Read teh book.');
  }
  await page.waitForTimeout(1500);
  expect(await correctness()).toBe(0);
  await expect(page.locator('cadenza-badge')).toHaveCount(0);

  await page.locator('#mail-body').click();
  await page.keyboard.type('Read teh book.');
  await expect.poll(correctness).toBe(1);
});

test('popup shows the active provider', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator('#provider option:checked')).toHaveText('Test rules (no AI)');
  await expect(page.locator('#enabled')).toBeChecked();
});

test('checks a field that had focus before Cadenza loaded', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(`${PAGE_URL}autofocus.html`);
  await expect(page.locator('#auto')).toBeFocused();
  // No click: the focus event happened before the content script ran.
  await page.keyboard.type('Read teh book.');
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(1);
});

test('tabs left open when Cadenza reloads throw no errors, and clear their marks', async ({
  context,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  // Content-script errors surface here, not as page errors.
  const cdp = await context.newCDPSession(page);
  const errors: string[] = [];
  cdp.on('Runtime.exceptionThrown', (e) => {
    errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text);
  });
  await cdp.send('Runtime.enable');
  await page.locator('#textarea').click();
  await page.keyboard.type('Read teh book.');
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(1);

  // An update or a reload from chrome://extensions orphans this tab's content script.
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await page.waitForTimeout(1000);
  for (let i = 0; i < 3; i++) {
    await page.locator('#textarea').blur();
    await page.locator('#textarea').focus();
    await page.keyboard.type(' x');
    await page.waitForTimeout(300);
  }
  // The old script notices within its 5 s sweep and removes its underlines and badge.
  await expect(page.locator('cadenza-badge')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('cadenza-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});
