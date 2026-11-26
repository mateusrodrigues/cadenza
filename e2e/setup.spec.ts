import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { cardButton, clickUnderline, open, overlayCount } from './helpers';
import { type StubServer, startStubServer } from './stub-server';

// Phase 6: onboarding, sites, dictionary, goals, usage and the key passphrase.

const STUB = 'http://127.0.0.1:4600';
let stub: StubServer;

test.beforeAll(async () => {
  stub = await startStubServer(4600);
});
test.afterAll(async () => {
  await stub.close();
});

test('onboarding: connect a model server on this computer and try it', async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  await page.getByRole('button', { name: /Use a model on this computer/ }).click();
  await expect(page.locator('#rescan')).toBeVisible();
  await page.getByLabel('Server address').fill(`${STUB}/v1`);
  await page.locator('#custom-form').getByRole('button', { name: 'Connect' }).click();
  await expect(page.locator('#message')).toHaveText('Found 1 model.');
  await expect(page.getByLabel('Model')).toHaveValue('stub-model');

  // The stub refuses extension origins, like Ollama by default: the page offers the fix.
  await page.getByRole('button', { name: 'Test and finish' }).click();
  await expect(page.locator('#message')).toContainText('refused the connection');
  await page.getByRole('button', { name: 'Allow connection' }).click();
  await expect(page.getByRole('heading', { name: "You're set" })).toBeVisible({
    timeout: 15_000,
  });

  const settings = await storedSettings(worker);
  const active = settings.providers.find((p) => p.id === settings.activeProviderId);
  expect(active).toMatchObject({ baseURL: `${STUB}/v1`, model: 'stub-model', slowMode: true });

  // The try box on the page itself gets underlines.
  await page.locator('#try').click();
  await page.keyboard.type('See you tomorow.');
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(1, {
    timeout: 15_000,
  });
});

test('onboarding: clicking "Test and finish" twice saves the provider once', async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);
  // Allow the stub up front, so the first check passes (see the test above).
  await page.evaluate(
    (origin) => chrome.runtime.sendMessage({ type: 'cadenza/allow-origin', origin }),
    STUB,
  );
  await page.getByRole('button', { name: /Use a model on this computer/ }).click();
  await page.getByLabel('Server address').fill(`${STUB}/v1`);
  await page.locator('#custom-form').getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByLabel('Model')).toHaveValue('stub-model');

  // The stub answers "slow-model" after 4 s, like a local model on a CPU.
  await page.getByLabel('Model').evaluate((select: HTMLSelectElement) => {
    select.add(new Option('slow-model', 'slow-model'));
    select.value = 'slow-model';
  });

  // A second click while the sample check runs does nothing.
  const finish = page.getByRole('button', { name: 'Test and finish' });
  await finish.click();
  await expect(page.locator('#message')).toContainText('Checking a sample sentence');
  await expect(finish).toBeDisabled();
  await finish.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('heading', { name: "You're set" })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(1000);

  const settings = await storedSettings(worker);
  const stubs = settings.providers.filter((p) => p.baseURL === `${STUB}/v1`);
  expect(stubs).toHaveLength(1);
  expect(settings.activeProviderId).toBe(stubs[0]?.id);
});

test('a site turned off in settings shows nothing until turned back on', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book.');
  await overlayCount(page, 1);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#sites`);
  await options.getByLabel('Turn off on a site').fill('http://127.0.0.1:4173/apply.html');
  await options.getByRole('button', { name: 'Turn off', exact: true }).click();
  await expect(options.locator('#sites-list li')).toHaveText(/127\.0\.0\.1/);

  // The open field clears without any typing; the badge shows Cadenza is paused here.
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(0);
  await expect(page.locator('cadenza-badge')).toHaveAttribute('data-state', 'paused');

  await options.getByRole('button', { name: 'Turn on for 127.0.0.1' }).click();
  await expect(options.locator('#sites-list li')).toHaveCount(0);
  await overlayCount(page, 1);
});

test('Add to dictionary hides the word everywhere until removed', async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book tomorow.');
  await overlayCount(page, 2);
  await clickUnderline(page, '#plain', 'tomorow');
  await cardButton(page, 'add-word').click();
  await overlayCount(page, 1);
  await expect
    .poll(() =>
      worker.evaluate(async () => (await chrome.storage.local.get('dictionary')).dictionary),
    )
    .toEqual(['tomorow']);

  // Grammar suggestions don't offer it.
  await page.locator('#input').click();
  await page.keyboard.type('Their going tomorow.');
  await overlayCount(page, 1);
  await clickUnderline(page, '#input', 'Their going');
  await expect(cardButton(page, 'add-word')).toHaveCount(0);
  await page.keyboard.press('Escape');

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#dictionary`);
  await expect(options.locator('#dictionary-list .word')).toHaveText(['tomorow']);
  await options.getByRole('button', { name: 'Remove tomorow' }).click();
  await expect(options.locator('#dictionary-list li')).toHaveCount(0);
  await expect(page.locator('cadenza-overlay[data-count="2"]')).toHaveCount(2);

  // Words can be added in settings too.
  await options.getByLabel('Add a word').fill('teh');
  await options.getByRole('button', { name: 'Add word' }).click();
  await expect(options.locator('#dictionary-list .word')).toHaveText(['teh']);
  // "Read teh book tomorow." keeps tomorow; "Their going tomorow." is unaffected.
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(1);
  await expect(page.locator('cadenza-overlay[data-count="2"]')).toHaveCount(1);
});

test('goals and the daily limit are saved; usage lists checks', async ({
  context,
  extensionId,
  worker,
}) => {
  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book.');
  await overlayCount(page, 1);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#writing`);
  // Both at once, as two quick clicks would be: neither change may undo the other.
  await options.evaluate(() => {
    const formal = document.querySelector<HTMLInputElement>(
      'input[name="formality"][value="formal"]',
    );
    const audience = document.querySelector<HTMLSelectElement>('#audience');
    if (!formal || !audience) throw new Error('Writing controls not found');
    formal.click();
    audience.value = 'expert';
    audience.dispatchEvent(new Event('change'));
  });
  await options.getByRole('link', { name: 'Usage' }).click();
  // The limit field is off until the switch is on.
  await expect(options.getByLabel('Checks per day')).toBeDisabled();
  await options.getByRole('switch', { name: 'Daily limit' }).check();
  await options.getByLabel('Checks per day').fill('50');
  await options.getByLabel('Checks per day').press('Tab');
  await expect
    .poll(async () => {
      const s = await storedSettings(worker);
      return [s.goals, s.dailyLimit];
    })
    .toEqual([{ formality: 'formal', audience: 'expert' }, 50]);

  const rows = options.locator('#usage-table tbody tr');
  await expect(rows).toHaveCount(7);
  await expect(rows.first().locator('th')).toContainText('(today)');
  await expect(rows.first().locator('td').first()).not.toHaveText('0');
});

test('passphrase: keys are encrypted, locked keys stop checks, unlocking resumes them', async ({
  context,
  extensionId,
  worker,
}) => {
  await worker.evaluate(async (base) => {
    await chrome.storage.local.set({
      settings: {
        version: 2,
        enabled: true,
        providers: [
          {
            id: 's',
            name: 'Stub',
            presetId: 'custom',
            kind: 'openai-compatible',
            baseURL: base,
            apiKey: null,
            hasKey: true,
            model: 'stub-model',
            explanations: false,
            slowMode: false,
          },
        ],
        activeProviderId: 's',
      },
    });
  }, `${STUB}/v1`);
  await putSecret(worker, 'apiKeys', { s: 'secret-test-key' });

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#passphrase`);
  // Let Cadenza's requests reach the stub without an extension Origin (see providers.spec).
  await options.evaluate(
    (origin) => chrome.runtime.sendMessage({ type: 'cadenza/allow-origin', origin }),
    STUB,
  );
  await options.getByLabel('New passphrase').fill('correct horse');
  await options.getByLabel('Repeat passphrase').fill('correct horse');
  await options.getByRole('button', { name: 'Lock keys' }).click();
  await expect(options.locator('#security-message')).toContainText('Keys encrypted');
  const stored = await worker.evaluate(readSecrets);
  expect(stored.apiKeys).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain('secret-test-key');
  await options.getByRole('button', { name: 'Lock now' }).click();
  await expect(options.locator('#locked')).toBeVisible();
  await expect(options.locator('#provider-list')).toBeHidden();

  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book.');
  await expect(page.locator('cadenza-badge')).toHaveAttribute('data-state', 'error');

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByLabel('Passphrase').fill('wrong passphrase');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.locator('#unlock-message')).toHaveText('That passphrase is not right.');
  await popup.getByLabel('Passphrase').fill('correct horse');
  await popup.getByRole('button', { name: 'Unlock' }).click();
  await expect(popup.locator('#unlock')).toBeHidden();

  // Unlocking rechecks open fields, and the request carries the decrypted key.
  await overlayCount(page, 1);
  expect(stub.auth.at(-1)).toBe('Bearer secret-test-key');
  await expect(options.locator('#locked')).toBeHidden();
  await expect(options.locator('#provider-list li')).toHaveCount(1);

  // Saving settings while unlocked keeps the key encrypted.
  await options.getByRole('link', { name: 'Writing' }).click();
  await options.getByRole('radio', { name: 'Neutral' }).check();
  await expect.poll(async () => (await worker.evaluate(readSecrets)).apiKeys).toBeUndefined();

  await options.getByRole('link', { name: 'Passphrase' }).click();
  await options.getByRole('button', { name: 'Remove passphrase' }).click();
  await expect
    .poll(async () => (await worker.evaluate(readSecrets)).apiKeys)
    .toEqual({
      s: 'secret-test-key',
    });
});

test('errors shown in the page never quote the provider (keys can appear in them)', async ({
  context,
  extensionId,
  worker,
}) => {
  await worker.evaluate(async (base) => {
    await chrome.storage.local.set({
      settings: {
        version: 2,
        enabled: true,
        providers: [
          {
            id: 'x',
            name: 'Stub',
            presetId: 'custom',
            kind: 'openai-compatible',
            baseURL: base,
            apiKey: null,
            model: 'auth-fail',
            explanations: false,
            slowMode: false,
          },
        ],
        activeProviderId: 'x',
      },
    });
  }, `${STUB}/v1`);
  await putSecret(worker, 'apiKeys', { x: 'sk-test-secret-key' });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(
    (origin) => chrome.runtime.sendMessage({ type: 'cadenza/allow-origin', origin }),
    STUB,
  );

  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book.');
  const badge = page.locator('cadenza-badge');
  await expect(badge).toHaveAttribute('data-state', 'error');
  await expect(badge).toHaveAttribute(
    'title',
    'Cadenza: The API key was rejected. Check it in Cadenza settings.',
  );
  expect(await page.content()).not.toContain('sk-te');
});

interface StoredSettings {
  providers: { id: string; baseURL: string; model: string; slowMode: boolean }[];
  activeProviderId: string;
  goals: unknown;
  dailyLimit: number | null;
}

async function storedSettings(worker: Worker): Promise<StoredSettings> {
  return worker.evaluate(
    async () => (await chrome.storage.local.get('settings')).settings as StoredSettings,
  );
}

/** The key store's records (see lib/secrets.ts), read in the worker's origin. */
function readSecrets(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('cadenza-secrets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('secrets');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('secrets', 'readonly');
      const store = tx.objectStore('secrets');
      const out: Record<string, unknown> = {};
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve(out);
        out[String(c.key)] = c.value;
        c.continue();
      };
    };
  });
}

async function putSecret(worker: Worker, name: string, value: unknown) {
  await worker.evaluate(
    ([n, v]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('cadenza-secrets', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('secrets');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('secrets', 'readwrite');
          tx.objectStore('secrets').put(v, n as string);
          tx.oncomplete = () => resolve();
        };
      }),
    [name, value] as const,
  );
}

test('while off on a site, the field is not read: no text reaches the worker', async ({
  context,
  extensionId,
  worker,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#sites`);
  await options.getByLabel('Turn off on a site').fill('127.0.0.1');
  await options.getByRole('button', { name: 'Turn off', exact: true }).click();
  await expect(options.locator('#sites-list li')).toHaveCount(1);

  const checks = () =>
    worker.evaluate(() =>
      (globalThis as { cadenzaChecksReceived?: () => number }).cadenzaChecksReceived?.(),
    );
  const before = await checks();
  const page = await context.newPage();
  await open(page);
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book.');
  await page.locator('#input').click();
  await page.keyboard.type('Their going.');
  await expect(page.locator('cadenza-badge').first()).toHaveAttribute('data-state', 'paused');
  await page.waitForTimeout(1500);
  expect(await checks()).toBe(before);
  await expect(page.locator('cadenza-overlay[data-count="0"]')).toHaveCount(2);

  // Back on: the fields are checked again.
  await options.getByRole('button', { name: 'Turn on for 127.0.0.1' }).click();
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(2);
  expect(await checks()).toBeGreaterThan(before ?? 0);
});

test('Google Docs: Cadenza stays out (support is coming), other Google pages still work', async ({
  context,
  worker,
}) => {
  // Stand-in pages at the real addresses; nothing goes to the network.
  await context.route('https://docs.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><textarea id="t" rows="4" cols="60"></textarea>',
    }),
  );
  const checks = () =>
    worker.evaluate(() =>
      (globalThis as { cadenzaChecksReceived?: () => number }).cadenzaChecksReceived?.(),
    );
  const before = await checks();

  const doc = await context.newPage();
  await doc.goto('https://docs.google.com/document/d/test/edit');
  await doc.locator('#t').click();
  await doc.keyboard.type('Read teh book.');
  await doc.waitForTimeout(1500);
  await expect(doc.locator('cadenza-overlay')).toHaveCount(0);
  await expect(doc.locator('cadenza-badge')).toHaveCount(0);
  expect(await checks()).toBe(before);

  // The same page elsewhere on docs.google.com (Forms) is checked as usual.
  const form = await context.newPage();
  await form.goto('https://docs.google.com/forms/d/test/viewform');
  await form.locator('#t').click();
  await form.keyboard.type('Read teh book.');
  await expect(form.locator('cadenza-overlay[data-count="1"]')).toHaveCount(1);
});

test('Where to check: a kind of field turned off is not read, and comes back when turned on', async ({
  context,
  extensionId,
  worker,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html#writing`);
  const kindOn = async (kind: string) =>
    worker.evaluate(
      async (k) =>
        (
          (await chrome.storage.local.get('settings')).settings as {
            fieldKinds: Record<string, boolean>;
          }
        ).fieldKinds[k],
      kind,
    );
  await options.getByRole('switch', { name: 'Text fields' }).uncheck();
  await options.getByRole('switch', { name: 'Rich editors' }).uncheck();
  await expect.poll(() => kindOn('input')).toBe(false);
  await expect.poll(() => kindOn('rich')).toBe(false);
  await expect(options.getByRole('switch', { name: 'Text areas' })).toBeChecked();

  const checks = () =>
    worker.evaluate(
      () => (globalThis as { cadenzaChecksReceived?: () => number }).cadenzaChecksReceived?.() ?? 0,
    );
  const correctness = () =>
    page.evaluate(() => CSS.highlights.get('cadenza-correctness')?.size ?? 0);
  const page = await context.newPage();
  await open(page);
  const before = await checks();

  // Off: the text field and the rich editor send nothing and show no badge.
  await page.locator('#input').click();
  await page.keyboard.type('Read teh book.');
  await page.locator('#editor p').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Read teh book.');
  await page.waitForTimeout(1500);
  expect(await checks()).toBe(before);
  expect(await correctness()).toBe(0);
  await expect(page.locator('cadenza-badge[data-state="paused"]')).toHaveCount(0);
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(0);

  // On: the text area is checked as usual.
  await page.locator('#plain').click();
  await page.keyboard.type('Read teh book.');
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(1);

  // Turning the others back on checks what was typed there, without more typing.
  await options.getByRole('switch', { name: 'Rich editors' }).check();
  await options.getByRole('switch', { name: 'Text fields' }).check();
  await expect.poll(correctness).toBe(1);
  await expect(page.locator('cadenza-overlay[data-count="1"]')).toHaveCount(2);
});
