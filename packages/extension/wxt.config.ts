import { defineConfig } from 'wxt';

export default defineConfig({
  imports: false,
  manifest: {
    name: 'Cadenza',
    description: 'Writing suggestions in any text field, using the AI provider you choose.',
    permissions: ['storage'],
    // Endpoints the user adds (local servers, custom URLs) are requested at runtime.
    optional_host_permissions: ['http://localhost/*', 'http://127.0.0.1/*', 'https://*/*'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: 'Cadenza' },
  },
});
