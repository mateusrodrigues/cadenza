import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { MockProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { Provider, ProviderConfig } from './types.js';

export * from './anthropic.js';
export * from './errors.js';
export * from './gemini.js';
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
      return new AnthropicProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
  }
}
