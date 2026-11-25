import { expect, test } from './fixtures';
import { card, cardButton, clickUnderline, open, overlayCount } from './helpers';

// Phase 5: cards, accepting and dismissing, undo, the panel, and editors' own state staying
// in sync. Runs on the built-in test rules (mock provider).

test('a click on an underline opens its card; Accept applies it and Ctrl+Z undoes it', async ({
  context,
}) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);

  await clickUnderline(page, '#plain', 'teh');
  await expect(card(page)).toContainText('Correctness');
  await expect(card(page).locator('del')).toHaveText('teh');
  await expect(card(page).locator('ins')).toHaveText('the');
  await expect(card(page)).toContainText('Spelling mistake.');
  await page.screenshot({
    path: 'test-results/card.png',
    clip: { x: 0, y: 0, width: 900, height: 260 },
  });
  // The field keeps focus while the card is open.
  await expect(field).toBeFocused();

  await cardButton(page, 'accept').click();
  await expect(field).toHaveValue('Read the book tomorow.');
  await expect(card(page)).toHaveCount(0);
  await overlayCount(page, 1);
  await expect(field).toBeFocused();

  await page.keyboard.press('ControlOrMeta+z');
  await expect(field).toHaveValue('Read teh book tomorow.');
  // The undone mistake is underlined again after the recheck.
  await overlayCount(page, 2);
});

test('accepting in a text input, and deleting a word without leaving two spaces', async ({
  context,
}) => {
  const page = await context.newPage();
  await open(page);
  const input = page.locator('#input');
  await input.click();
  await page.keyboard.type('Please reply ASAP, it is basically done.');
  await overlayCount(page, 2);
  await clickUnderline(page, '#input', 'ASAP');
  await expect(card(page)).toContainText('Tone');
  await cardButton(page, 'accept').click();
  await expect(input).toHaveValue('Please reply as soon as you can, it is basically done.');

  await clickUnderline(page, '#input', 'basically');
  await expect(card(page)).toContainText('Remove');
  await cardButton(page, 'accept').click();
  await expect(input).toHaveValue('Please reply as soon as you can, it is done.');
});

test('Dismiss hides a suggestion, and it stays hidden after the field is rechecked', async ({
  context,
}) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);
  await clickUnderline(page, '#plain', 'tomorow');
  await cardButton(page, 'dismiss').click();
  await expect(card(page)).toHaveCount(0);
  await overlayCount(page, 1);
  await expect(field).toHaveValue('Read teh book tomorow.');

  // A new paragraph triggers a new check; the dismissed one doesn't come back.
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nAnd teh pen.');
  await overlayCount(page, 2);
  const words = await page.evaluate(() =>
    [
      ...(document.querySelector('cadenza-overlay')?.shadowRoot?.querySelectorAll('span') ?? []),
    ].map((s) => s.textContent),
  );
  expect(words).toEqual(['teh', 'teh']);
});

test("Don't suggest this again applies everywhere until removed in settings", async ({
  context,
  worker,
  extensionId,
}) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);
  await clickUnderline(page, '#plain', 'tomorow');
  await cardButton(page, 'ignore').click();
  await overlayCount(page, 1);
  await expect
    .poll(() => worker.evaluate(async () => (await chrome.storage.local.get('ignored')).ignored))
    .toEqual([{ category: 'correctness', original: 'tomorow' }]);

  // Another field: not flagged.
  await page.locator('#controlled').click();
  await page.keyboard.type('See you tomorow and teh day after.');
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(2);

  // Listed in settings, and removable.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const item = options.locator('#ignored-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('tomorow');
  await item.getByRole('button', { name: 'Stop ignoring tomorow' }).click();
  await expect(item).toHaveCount(0);
  await options.close();

  // Open fields check again and show it; new ones flag it too.
  await expect(page.locator('cadenza-overlay[data-count="2"]')).toHaveCount(2);
  await page.locator('#input').click();
  await page.keyboard.type('Until tomorow.');
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(1);
});

test('a page script cannot accept a suggestion with a synthetic click', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book.');
  await overlayCount(page, 1);
  await clickUnderline(page, '#plain', 'teh');
  // (Test builds leave the shadow root open; real builds close it.)
  await page.evaluate(() => {
    const ui = document.querySelector('cadenza-ui')?.shadowRoot;
    const accept = ui?.querySelector<HTMLElement>('button[data-action="accept"]');
    if (!accept) throw new Error('No Accept button');
    accept.click();
  });
  await page.waitForTimeout(300);
  await expect(field).toHaveValue('Read teh book.');
});

test('Escape and clicks elsewhere close the card', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book.');
  await overlayCount(page, 1);
  await clickUnderline(page, '#plain', 'teh');
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await clickUnderline(page, '#plain', 'teh');
  await page.mouse.click(5, 5);
  await expect(card(page)).toHaveCount(0);
  // Clicking plain text in the field doesn't open a card.
  const box = await page.locator('#plain').boundingBox();
  await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) - 20, (box?.y ?? 0) + 50);
  await page.waitForTimeout(200);
  await expect(card(page)).toHaveCount(0);
});

test('contenteditable: Accept goes through the editor and Ctrl+Z undoes it', async ({
  context,
}) => {
  const page = await context.newPage();
  await open(page);
  const editor = page.locator('#editor');
  await editor.locator('p').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Read teh book tomorow.');
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0))
    .toBe(2);
  await clickUnderline(page, '#editor', 'teh');
  await cardButton(page, 'accept').click();
  await expect(editor).toHaveText('Start. Read the book tomorow.');
  // Still the editor's own single paragraph: nothing of ours was inserted.
  await expect(editor).toHaveJSProperty('innerHTML', '<p>Start. Read the book tomorow.</p>');
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0))
    .toBe(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveText('Start. Read teh book tomorow.');
});

test('framework state stays in sync: a controlled field and an editor that owns its model', async ({
  context,
}) => {
  const page = await context.newPage();
  await open(page);

  // Controlled textarea: its change handler sees the accepted text.
  await page.locator('#controlled').click();
  await page.keyboard.type('Their going tomorow.');
  await overlayCount(page, 2);
  const before = await page.evaluate(
    () => (window as unknown as { controlledChanges: number }).controlledChanges,
  );
  await clickUnderline(page, '#controlled', 'Their going');
  await cardButton(page, 'accept').click();
  await expect(page.locator('#controlled')).toHaveValue("They're going tomorow.");
  await expect(page.locator('#controlled-preview')).toHaveText("They're going tomorow.");
  expect(
    await page.evaluate(
      () => (window as unknown as { controlledChanges: number }).controlledChanges,
    ),
  ).toBe(before + 1);

  // Model editor: the change goes through its beforeinput handler into its model and its
  // own undo history; the underlines follow its re-render.
  const model = page.locator('#model-editor');
  await model.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' I will recieve it.');
  await expect(page.locator('#model-preview')).toHaveText('Start. I will recieve it.');
  await clickUnderline(page, '#model-editor', 'recieve');
  await cardButton(page, 'accept').click();
  await expect(page.locator('#model-preview')).toHaveText('Start. I will receive it.');
  await expect(model).toHaveText('Start. I will receive it.');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...(CSS.highlights.get('cadenza-correctness') ?? [])].filter((r) =>
            document.getElementById('model-editor')?.contains((r as Range).startContainer),
          ).length,
      ),
    )
    .toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#model-preview')).toHaveText('Start. I will recieve it.');
});

test('the badge opens a panel; Accept all fixes every correctness issue in one undo step', async ({
  context,
}) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow, it is very unique.');
  await overlayCount(page, 3);

  await page.locator('cadenza-badge').click();
  const panel = page.locator('cadenza-ui .cdz-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.cdz-panel__head')).toContainText('3 suggestions');
  await expect(
    panel.locator('.cdz-panel__group[data-category="correctness"] .cdz-panel__row'),
  ).toHaveCount(2);
  await expect(
    panel.locator('.cdz-panel__group[data-category="style"] .cdz-panel__row'),
  ).toHaveCount(1);
  await expect(field).toBeFocused();
  await page.screenshot({
    path: 'test-results/panel.png',
    clip: { x: 0, y: 0, width: 900, height: 420 },
  });

  await panel.locator('button[data-action="accept-all"]').click();
  await expect(field).toHaveValue('Read the book tomorrow, it is very unique.');
  // The panel stays open and now lists what's left.
  await expect(panel.locator('.cdz-panel__row')).toHaveCount(1);
  await expect(panel.locator('.cdz-panel__head')).toContainText('1 suggestion');

  await panel.locator('.cdz-panel__row button[data-action="dismiss"]').click();
  await expect(panel.locator('.cdz-panel__note')).toHaveText('No suggestions. Nice writing.');
  await overlayCount(page, 0);

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(field).toHaveValue('Read teh book tomorow, it is very unique.');
});
