import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { card, open, overlayCount } from './helpers';

// Phase 7: keyboard access. Browser-level extension shortcuts can't be pressed from tests, so
// the worker sends the message its command handler sends; everything after that is real.

async function shortcut(worker: Worker) {
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) await chrome.tabs.sendMessage(tab.id, { type: 'cadenza/keyboard' });
  });
}

const focusedAction = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const host = document.querySelector('cadenza-ui');
    const active = host?.shadowRoot?.activeElement as HTMLElement | null | undefined;
    return active?.dataset.action ?? null;
  });

test('the shortcut opens the suggestion at the caret, Enter accepts it, focus returns', async ({
  context,
  worker,
}) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);

  // The caret sits between the two mistakes: the card is for the one after it.
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(9, 9));
  await page.bringToFront();
  await shortcut(worker);
  await expect(card(page).locator('del')).toHaveText('tomorow');
  await expect.poll(() => focusedAction(page)).toBe('accept');

  // Screen readers get a sentence for the change; the visual layout is hidden from them.
  await expect(card(page).locator('.cdz-sr')).toHaveText(
    'Correctness: change “tomorow” to “tomorrow”.',
  );
  const box = page.locator('cadenza-ui [role="dialog"]');
  await expect(box).toHaveAttribute('role', 'dialog');
  await expect(box).toHaveAttribute('aria-label', 'Cadenza suggestion');

  // Tab stays inside the card.
  const buttons = await card(page).locator('button').count();
  for (let i = 0; i < buttons; i++) await page.keyboard.press('Tab');
  await expect.poll(() => focusedAction(page)).toBe('accept');

  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('Read teh book tomorrow.');
  await expect(card(page)).toHaveCount(0);
  await expect(field).toBeFocused();
});

test('Escape closes a keyboard-opened card and puts the caret back', async ({
  context,
  worker,
}) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);
  await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 2));
  await page.bringToFront();

  await shortcut(worker);
  await expect(card(page).locator('del')).toHaveText('teh');
  await expect.poll(() => focusedAction(page)).toBe('accept');
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await expect(field).toBeFocused();
  expect(await field.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(2);

  // Typing goes on where it was.
  await page.keyboard.type('X');
  await expect(field).toHaveValue('ReXad teh book tomorow.');
});

test('pressed again, the shortcut moves from the card to the panel', async ({
  context,
  worker,
}) => {
  const page = await context.newPage();
  await open(page);
  const field = page.locator('#plain');
  await field.click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);
  await page.bringToFront();

  await shortcut(worker);
  await expect(card(page)).toHaveCount(1);
  await shortcut(worker);
  const panel = page.locator('cadenza-ui .cdz-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('cadenza-ui [role="dialog"]')).toHaveAttribute(
    'aria-label',
    'Cadenza suggestions',
  );
  await expect.poll(() => focusedAction(page)).toBe('row');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(field).toBeFocused();
});

test('in a rich editor, Escape restores the selection', async ({ context, worker }) => {
  const page = await context.newPage();
  await open(page);
  const editor = page.locator('#editor');
  await editor.locator('p').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Read teh book.');
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0))
    .toBe(1);
  await page.bringToFront();
  await shortcut(worker);
  await expect(card(page).locator('del')).toHaveText('teh');
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await page.keyboard.type('!');
  await expect(editor).toHaveText('Start. Read teh book.!');
});
