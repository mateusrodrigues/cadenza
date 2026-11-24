import { ProviderError } from './errors.js';
import { MockProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider, ProviderConfig } from './types.js';

export * from './errors.js';
export * from './mock.js';
export * from './openai-compatible.js';
export * from './presets.js';
export * from './types.js';

export function createProvider(config: ProviderConfig): Provider {
  switch (config.kind) {
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
    case 'mock':
      return new MockProvider();
    case 'anthropic':
    case 'gemini':
      // Adapters land in Phase 2 (official vendor SDKs; bundling verified in Phase 0).
      throw new ProviderError('not_implemented', `The ${config.kind} adapter is not built yet.`);
  }
}
