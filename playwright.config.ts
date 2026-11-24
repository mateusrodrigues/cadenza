import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
