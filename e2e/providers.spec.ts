import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESETS } from '@cadenza/providers';
import { type BrowserContext, chromium } from '@playwright/test';
import { EXTENSION_PATH, expect, PAGE_URL, test } from './fixtures';
import { type StubServer, startStubServer } from './stub-server';

const STUB = 'http://127.0.0.1:4600';
let stub: StubServer;

test.beforeAll(async () => {
  stub = await startStubServer(4600);
});
test.afterAll(async () => {
  await stub.close();
});

test('settings: add a local server that refuses extensions, allow it, and use it', async ({
  context,
  extensionId,
  worker,
}) => {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: 'Add provider' }).click();
  await options.getByRole('radio', { name: 'Custom endpoint' }).check();
  await options.getByLabel('Name').fill('Stub server');
  await options.getByLabel('Endpoint URL').fill(`${STUB}/v1`);
  await options.getByLabel('Endpoint URL').blur();
  await options.locator('#api-key').fill('stub-test-key');
  // A new endpoint on this computer defaults to slow model mode without explanations.
  await expect(options.getByLabel('Slow model mode')).toBeChecked();
  await expect(options.getByLabel('Explain each suggestion')).not.toBeChecked();

  // Chrome sends no Origin on these GETs (the e2e build holds the host permission), so models
  // load; the POST that checks text carries the extension's Origin and is refused.
  await options.getByRole('button', { name: 'Load models' }).click();
  await expect(options.locator('#message')).toHaveText('Found 1 model.');
  await options.getByRole('button', { name: 'Test connection' }).click();
  await expect(options.locator('#message')).toContainText('refused the connection');
  expect(stub.origins.at(-1)).toMatch(/^POST .* chrome-extension:\/\//);
  await options.getByRole('button', { name: 'Allow connection' }).click();
  await expect(options.locator('#message')).toContainText('Works:');
  await expect(options.locator('#message')).toContainText('“tomorow” → “tomorrow”');
  // After allowing, Cadenza's requests reach the server without an extension Origin.
  expect(stub.origins.at(-1)).toMatch(/^POST \S+ -$/);

  await options.getByRole('button', { name: 'Save' }).click();
  await expect(options.locator('#provider-list li')).toHaveCount(2);
  await expect(options.getByRole('radio', { name: 'Use Stub server' })).toBeChecked();
  expect(stub.auth.at(-1)).toBe('Bearer stub-test-key');
  // The key is kept out of chrome.storage (content scripts run before the worker can lock it).
  const stored = await worker.evaluate(() => chrome.storage.local.get(null));
  expect(JSON.stringify(stored)).not.toContain('stub-test-key');
  expect(JSON.stringify(stored)).toContain('Stub server');

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#provider option:checked')).toHaveText('Stub server');
  await expect(popup.locator('#model')).toHaveText('stub-model');

  // Slow mode: three paragraphs are checked one request at a time until all are done.
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.locator('#textarea').click();
  await page.keyboard.type('See you tomorow.\nRead teh book.\nAll good here.');
  await expect(page.locator('cadenza-badge[data-state="done"]')).toHaveAttribute(
    'data-count',
    '2',
    {
      timeout: 15_000,
    },
  );
  await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '2');
});

test('settings: switching the active provider and removing one', async ({
  context,
  extensionId,
  worker,
}) => {
  await worker.evaluate(async () => {
    const base = { kind: 'openai-compatible', apiKey: null, explanations: true, slowMode: false };
    await chrome.storage.local.set({
      settings: {
        version: 2,
        enabled: true,
        providers: [
          {
            ...base,
            id: 'a',
            name: 'First',
            presetId: 'custom',
            baseURL: 'http://127.0.0.1:4600/v1',
            model: 'm1',
          },
          {
            ...base,
            id: 'b',
            name: 'Second',
            presetId: 'custom',
            baseURL: 'http://127.0.0.1:4600/v1',
            model: 'm2',
          },
        ],
        activeProviderId: 'a',
        dialect: 'en-US',
        categories: ['correctness', 'clarity', 'style', 'tone'],
        disabledSites: [],
      },
    });
  });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('radio', { name: 'Use Second' }).check();
  await options
    .locator('#provider-list li', { hasText: 'Second' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(options.locator('#provider-list li')).toHaveCount(1);
  const active = await worker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    return (settings as { activeProviderId: string }).activeProviderId;
  });
  expect(active).toBe('a');
});

test('settings from an earlier version are migrated', async ({ context, extensionId, worker }) => {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        enabled: true,
        provider: {
          presetId: 'custom',
          kind: 'openai-compatible',
          baseURL: 'http://127.0.0.1:4600/v1',
          apiKey: null,
          model: 'old-model',
        },
        check: { dialect: 'en-GB', categories: ['correctness'], explanations: false },
        disabledSites: [],
      },
    });
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('#model')).toHaveText('old-model');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByLabel('English variant')).toHaveValue('en-GB');
  await expect(options.getByLabel('Correctness')).toBeChecked();
  await expect(options.getByLabel('Clarity')).not.toBeChecked();
});

test('keys saved by an earlier version move out of chrome.storage', async () => {
  // Write old-style settings (key inside), then restart the browser so the worker starts again.
  const profile = mkdtempSync(join(tmpdir(), 'cadenza-e2e-'));
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
  const workerOf = async (c: BrowserContext) =>
    c.serviceWorkers()[0] ?? (await c.waitForEvent('serviceworker'));
  let context = await launch();
  await (await workerOf(context)).evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        enabled: true,
        provider: {
          presetId: 'custom',
          kind: 'openai-compatible',
          baseURL: 'http://127.0.0.1:4600/v1',
          apiKey: 'legacy-test-key',
          model: 'stub-model',
        },
        check: { dialect: 'en-US', categories: ['correctness'], explanations: false },
        disabledSites: [],
      },
    });
  });
  await context.close();

  context = await launch();
  try {
    const worker = await workerOf(context);
    await expect
      .poll(() => worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))))
      .not.toContain('legacy-test-key');
    // …and the key still reaches the server (GETs carry no extension Origin, so no allow step).
    const options = await context.newPage();
    await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
    await options.locator('#provider-list li').nth(1).getByRole('button', { name: 'Edit' }).click();
    await options.getByRole('button', { name: 'Load models' }).click();
    await expect(options.locator('#message')).toHaveText('Found 1 model.');
    expect(stub.auth.at(-1)).toBe('Bearer legacy-test-key');
  } finally {
    await context.close();
  }
});

test('content scripts cannot read chrome.storage once the worker has run', async ({
  context,
  worker,
}) => {
  await worker.evaluate(() => chrome.runtime.getPlatformInfo()); // the worker is up
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.locator('#textarea').click(); // make sure the content script has run
  const cdp = await context.newCDPSession(page);
  const contexts: { id: number; name: string; auxData?: { type?: string } }[] = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  await cdp.send('Runtime.enable');
  const isolated = contexts.find((c) => c.auxData?.type === 'isolated' && c.name === 'Cadenza');
  expect(isolated, 'Cadenza content-script world').toBeDefined();
  const { result } = await cdp.send('Runtime.evaluate', {
    contextId: isolated?.id,
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      if (!chrome.storage?.local) return 'no storage API';
      try { await chrome.storage.local.get(null); return 'readable'; }
      catch (e) { return 'blocked: ' + e.message; }
    })()`,
  });
  expect(result.value).toBe('blocked: Access to storage is not allowed from this context.');
});

test.describe('hosted providers (network)', () => {
  test.skip(process.env.CADENZA_NET_TESTS !== '1', 'set CADENZA_NET_TESTS=1 to call vendor APIs');

  for (const preset of PRESETS.filter((p) => p.needsKey)) {
    test(`${preset.label}: reachable from the extension; a bad key reads as an auth error`, async ({
      context,
      extensionId,
    }) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      const res = await page.evaluate(
        (config) => chrome.runtime.sendMessage({ type: 'cadenza/list-models', config }),
        {
          presetId: preset.id,
          kind: preset.kind,
          baseURL: preset.baseURL,
          apiKey: 'cadenza-invalid-test-key',
          model: null,
          ...(preset.extraHeaders ? { extraHeaders: preset.extraHeaders } : {}),
        },
      );
      // Some providers (OpenRouter) list models without a key; that still proves the request
      // got through. Otherwise the bad key must read as an auth error, not a network error.
      if (!res.ok) expect(res.error.kind).toBe('auth');
    });
  }
});

test('check results survive the service worker being stopped', async ({ context, worker }) => {
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        version: 2,
        enabled: true,
        providers: [
          {
            id: 'stub',
            name: 'Stub',
            presetId: 'custom',
            kind: 'openai-compatible',
            baseURL: 'http://127.0.0.1:4600/v1',
            apiKey: null,
            model: 'stub-model',
            explanations: false,
            slowMode: false,
          },
        ],
        activeProviderId: 'stub',
        dialect: 'en-US',
        categories: ['correctness', 'clarity', 'style', 'tone'],
        disabledSites: [],
      },
    });
  });
  // The stub refuses extension origins on POST; allow it the way the settings page does.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'cadenza/allow-origin', origin: 'http://127.0.0.1:4600' }),
  );

  const page = await context.newPage();
  await page.goto(PAGE_URL);
  const typeText = async () => {
    await page.locator('#textarea').click();
    await page.keyboard.type('See you tomorow.');
    await expect(page.locator('cadenza-overlay')).toHaveAttribute('data-count', '1', {
      timeout: 15_000,
    });
  };
  await typeText();
  const posts = () => stub.origins.filter((o) => o?.startsWith('POST')).length;
  const before = posts();

  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await page.reload();
  await typeText();
  expect(posts()).toBe(before);
});
