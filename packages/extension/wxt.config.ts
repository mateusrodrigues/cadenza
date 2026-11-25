import { defineConfig } from 'wxt';

/**
 * End-to-end test builds (CADENZA_E2E=1) go to their own folder and pre-grant access to the
 * test stub server only, because browser permission prompts can't be clicked in automated
 * tests. Normal builds never include this.
 */
const E2E = process.env.CADENZA_E2E === '1';
export const E2E_STUB_ORIGIN = 'http://127.0.0.1:4600';

export default defineConfig({
  imports: false,
  outDir: E2E ? '.output-e2e' : '.output',
  // Test builds open the card and panel shadow roots so tests can click their buttons.
  vite: () => ({ define: { __CADENZA_E2E__: JSON.stringify(E2E) } }),
  manifest: {
    name: 'Cadenza',
    description: 'Writing suggestions in any text field, using the AI provider you choose.',
    // declarativeNetRequestWithHostAccess: only acts on hosts the user granted (see
    // lib/origin-rules.ts); activeTab: the popup reads the current tab's site for its
    // on/off switch. Neither adds an install warning.
    permissions: ['storage', 'declarativeNetRequestWithHostAccess', 'activeTab'],
    // Endpoints the user adds (local servers, custom URLs) are requested at runtime.
    optional_host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', 'https://*/*'],
    ...(E2E ? { host_permissions: [`${E2E_STUB_ORIGIN}/*`] } : {}),
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: 'Cadenza' },
    // Keyboard access to suggestions; people can change the keys in Chrome's shortcut settings.
    commands: {
      'open-suggestion': {
        suggested_key: { default: 'Alt+Shift+Period' },
        description: 'Show the suggestion at the cursor',
      },
    },
  },
});
