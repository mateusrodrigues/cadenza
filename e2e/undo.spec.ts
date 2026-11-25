import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { card, cardButton, clickUnderline, open, overlayCount } from './helpers';

// Undo after the actions that reach past the field: "Don't suggest this again", "Add to
// dictionary" (both stored for every site) and Accept all (many changes at once).

const stored = (worker: Worker, key: string) =>
  worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k] ?? [], key);

const focusedAction = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector('cadenza-ui');
    const active = host?.shadowRoot?.activeElement as HTMLElement | null | undefined;
    return active?.dataset.action ?? null;
  });

test("Undo after Don't suggest this again brings the suggestion back", async ({
  context,
  worker,
}) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);
  await clickUnderline(page, '#plain', 'tomorow');
  await cardButton(page, 'ignore').click();

  // The card turns into a confirmation where it was; focus stays in the field.
  await expect(card(page)).toContainText('Won’t suggest “tomorow” again.');
  await expect(page.locator('#plain')).toBeFocused();
  await overlayCount(page, 1);
  await expect.poll(() => stored(worker, 'ignored')).toHaveLength(1);

  await cardButton(page, 'undo').click();
  await expect(card(page)).toHaveCount(0);
  await overlayCount(page, 2);
  await expect.poll(() => stored(worker, 'ignored')).toEqual([]);
  // The settings change rechecks the field; it stays flagged.
  await page.waitForTimeout(500);
  await overlayCount(page, 2);
});

test('Undo after Add to dictionary, from the keyboard', async ({ context, worker }) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(9, 9));
  await page.bringToFront();
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) await chrome.tabs.sendMessage(tab.id, { type: 'cadenza/keyboard' });
  });
  await expect.poll(() => focusedAction(page)).toBe('accept');
  for (let i = 0; i < 8 && (await focusedAction(page)) !== 'add-word'; i++) {
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');

  // Focus moves to Undo on the confirmation, which the screen reader hears with it.
  await expect(card(page)).toContainText('Added “tomorow” to your dictionary.');
  await expect.poll(() => focusedAction(page)).toBe('undo');
  await expect.poll(() => stored(worker, 'dictionary')).toEqual(['tomorow']);
  await overlayCount(page, 1);

  await page.keyboard.press('Enter');
  await expect(card(page)).toHaveCount(0);
  await expect(field).toBeFocused();
  await overlayCount(page, 2);
  await expect.poll(() => stored(worker, 'dictionary')).toEqual([]);
});

test('the confirmation closes by itself, but not while the pointer is on it', async ({
  context,
}) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book.');
  await overlayCount(page, 1);
  await clickUnderline(page, '#plain', 'teh');
  await cardButton(page, 'ignore').click();
  await cardButton(page, 'undo').hover();
  await page.waitForTimeout(7000);
  await expect(card(page)).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(card(page)).toHaveCount(0, { timeout: 8000 });
});

test('Undo after Accept all puts back every change', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow, it is very unique.');
  await overlayCount(page, 3);

  await page.locator('cadenza-badge').click();
  const panel = page.locator('cadenza-ui .cdz-panel');
  await panel.locator('button[data-action="accept-all"]').click();
  await expect(field).toHaveValue('Read the book tomorrow, it is very unique.');
  await expect(panel.locator('.cdz-panel__undo')).toContainText('Accepted 2 changes.');

  await panel.locator('.cdz-panel__undo button[data-action="undo"]').click();
  await expect(field).toHaveValue('Read teh book tomorow, it is very unique.');
  await expect(panel.locator('.cdz-panel__undo')).toHaveCount(0);
  await expect(panel.locator('.cdz-panel__row')).toHaveCount(3);
  await overlayCount(page, 3);
});

test('Undo after Accept all goes away once the text changes', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);
  await page.locator('cadenza-badge').click();
  const panel = page.locator('cadenza-ui .cdz-panel');
  await panel.locator('button[data-action="accept-all"]').click();
  await expect(panel.locator('.cdz-panel__undo')).toHaveCount(1);

  await field.press('End');
  await page.keyboard.type(' Then');
  await expect(panel.locator('.cdz-panel__undo')).toHaveCount(0);
});

test('a contenteditable editor: Undo after Accept all', async ({ context }) => {
  const page = await context.newPage();
  await open(page);
  const editor = page.locator('#editor');
  await editor.locator('p').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Read teh book tomorow.');
  const marks = () => page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0);
  await expect.poll(marks).toBe(2);
  await page.locator('cadenza-badge').click();
  const panel = page.locator('cadenza-ui .cdz-panel');
  await panel.locator('button[data-action="accept-all"]').click();
  await expect(editor).toHaveText('Start. Read the book tomorrow.');
  await panel.locator('.cdz-panel__undo button[data-action="undo"]').click();
  await expect(editor).toHaveText('Start. Read teh book tomorow.');
  await expect(editor).toHaveJSProperty('innerHTML', '<p>Start. Read teh book tomorow.</p>');
  await expect.poll(marks).toBe(2);
});
