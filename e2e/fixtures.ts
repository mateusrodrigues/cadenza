import { join } from 'node:path';
import { type BrowserContext, test as base, chromium, type Worker } from '@playwright/test';

export const EXTENSION_PATH = join(
  import.meta.dirname,
  '../packages/extension/.output-e2e/chrome-mv3',
);
export const PAGE_URL = 'http://127.0.0.1:4173/';

/** Launches Chromium with the built Cadenza extension loaded. */
export const test = base.extend<{
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
