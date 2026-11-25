import { expect, PAGE_URL, test } from './fixtures';
import { cardButton, clickUnderline } from './helpers';

// Phase 7 site matrix: block editors (Notion and similar) make each paragraph its own small
// editable and create and remove them as the user types.

const highlighted = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    [...(CSS.highlights.get('cadenza-correctness') ?? [])].map((r) => (r as Range).toString()),
  );

test('each block is checked, and accepting in one leaves the others alone', async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(`${PAGE_URL}blocks.html`);
  const blocks = page.locator('.block');

  await blocks.first().click();
  await page.keyboard.type('Read teh book.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('See you tomorow.');
  await expect(blocks).toHaveCount(2);
  await expect.poll(() => highlighted(page).then((h) => h.sort())).toEqual(['teh', 'tomorow']);

  await blocks.nth(1).evaluate((el) => el.setAttribute('id', 'second'));
  await clickUnderline(page, '#second', 'tomorow');
  await cardButton(page, 'accept').click();
  await expect(blocks.nth(1)).toHaveText('See you tomorrow.');
  await expect(blocks.nth(0)).toHaveText('Read teh book.');
  await expect.poll(() => highlighted(page)).toEqual(['teh']);

  // A removed block takes its underlines and badge with it.
  await blocks.nth(1).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(blocks).toHaveCount(1);
  await expect.poll(() => highlighted(page)).toEqual(['teh']);
  await expect(page.locator('cadenza-badge')).toHaveCount(1, { timeout: 8000 });
});
