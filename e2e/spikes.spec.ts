import { expect, PAGE_URL, test } from './fixtures';

/**
 * Phase 0 spikes that need a real browser. Results are recorded in docs/spikes.md.
 * Tests that need a local model server are skipped unless CADENZA_SPIKE_LOCAL_URL is set:
 *   CADENZA_SPIKE_LOCAL_URL=http://127.0.0.1:8360/v1 CADENZA_SPIKE_LOCAL_MODEL=phi4-14b \
 *     npx playwright test spikes
 */
const LOCAL_URL = process.env.CADENZA_SPIKE_LOCAL_URL;
const LOCAL_MODEL = process.env.CADENZA_SPIKE_LOCAL_MODEL;

test.describe('spikes', () => {
  test('API-key storage: can content scripts be locked out of storage.local?', async ({
    worker,
  }) => {
    const result = await worker.evaluate(async () => {
      const local = chrome.storage.local as chrome.storage.StorageArea & {
        setAccessLevel?: (o: { accessLevel: string }) => Promise<void>;
      };
      const session = chrome.storage.session as typeof local;
      const tryLock = async (area: typeof local) => {
        if (typeof area.setAccessLevel !== 'function') return 'not available';
        try {
          await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
          return 'ok';
        } catch (e) {
          return `error: ${(e as Error).message}`;
        }
      };
      return { local: await tryLock(local), session: await tryLock(session) };
    });
    console.log('storage access level:', JSON.stringify(result));
    expect(result.session).toBe('ok');
  });

  test.describe(() => {
    test.skip(!LOCAL_URL, 'set CADENZA_SPIKE_LOCAL_URL to run');

    test('service worker reaches a local server without a host permission', async ({ worker }) => {
      const result = await worker.evaluate(async (url) => {
        const origin = `${new URL(url).origin}/*`;
        const granted = await chrome.permissions.contains({ origins: [origin] });
        try {
          const res = await fetch(`${url}/models`);
          return { granted, status: res.status, ok: res.ok };
        } catch (e) {
          return { granted, error: String(e) };
        }
      }, LOCAL_URL as string);
      console.log('local fetch from worker:', JSON.stringify(result));
      expect(result.granted).toBe(false);
      expect(result).toMatchObject({ ok: true });
    });

    test('full pipeline: typing in a page produces underlines from the local model', async ({
      context,
      worker,
    }) => {
      test.setTimeout(10 * 60_000);
      await worker.evaluate(
        async ({ url, model }) => {
          await chrome.storage.local.set({
            settings: {
              enabled: true,
              provider: {
                presetId: 'custom',
                kind: 'openai-compatible',
                baseURL: url,
                apiKey: null,
                model,
              },
              check: {
                dialect: 'en-US',
                categories: ['correctness', 'clarity', 'style', 'tone'],
                explanations: false,
              },
              disabledSites: [],
            },
          });
        },
        { url: LOCAL_URL as string, model: LOCAL_MODEL ?? '' },
      );
      const page = await context.newPage();
      await page.goto(PAGE_URL);
      await page.locator('#textarea').click();
      const t0 = Date.now();
      await page.keyboard.type('I will definately send teh report tomorow.');
      await expect(page.locator('cadenza-overlay:not([data-count="0"])')).toHaveCount(1, {
        timeout: 9 * 60_000,
      });
      const count = await page.locator('cadenza-overlay').getAttribute('data-count');
      console.log(
        `local model underlined ${count} spans in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      await page.screenshot({ path: 'test-results/local-model.png' });
    });
  });
});
