import type { ProviderKind } from './types.js';

export interface ProviderPreset {
  id: string;
  /** Vendor name, shown only in the provider picker. */
  label: string;
  kind: ProviderKind;
  baseURL: string;
  /** Whether an API key is required. Local servers usually need none. */
  needsKey: boolean;
  local: boolean;
  extraHeaders?: Record<string, string>;
  /** Where users get a key, or setup docs for local servers. */
  helpURL?: string;
}

export const PRESETS: ProviderPreset[] = [
  // Hosted vendors
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    needsKey: true,
    local: false,
    helpURL: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    needsKey: true,
    local: false,
    helpURL: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com',
    needsKey: true,
    local: false,
    helpURL: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    needsKey: true,
    local: false,
    // Add HTTP-Referer once Cadenza has a public site; OpenRouter uses it for app attribution.
    extraHeaders: { 'X-Title': 'Cadenza' },
    helpURL: 'https://openrouter.ai/keys',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai-compatible',
    baseURL: 'https://api.mistral.ai/v1',
    needsKey: true,
    local: false,
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1',
    needsKey: true,
    local: false,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseURL: 'https://api.deepseek.com/v1',
    needsKey: true,
    local: false,
  },
  {
    id: 'xai',
    label: 'xAI',
    kind: 'openai-compatible',
    baseURL: 'https://api.x.ai/v1',
    needsKey: true,
    local: false,
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai-compatible',
    baseURL: 'https://api.together.xyz/v1',
    needsKey: true,
    local: false,
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    kind: 'openai-compatible',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    needsKey: true,
    local: false,
  },
  // Local servers
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai-compatible',
    baseURL: 'http://localhost:11434/v1',
    needsKey: false,
    local: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'openai-compatible',
    baseURL: 'http://localhost:1234/v1',
    needsKey: false,
    local: true,
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp server',
    kind: 'openai-compatible',
    baseURL: 'http://localhost:8080/v1',
    needsKey: false,
    local: true,
  },
  {
    id: 'vllm',
    label: 'vLLM',
    kind: 'openai-compatible',
    baseURL: 'http://localhost:8000/v1',
    needsKey: false,
    local: true,
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible endpoint',
    kind: 'openai-compatible',
    baseURL: '',
    needsKey: false,
    local: false,
  },
  // Development
  {
    id: 'mock',
    label: 'Test rules (no AI)',
    kind: 'mock',
    baseURL: '',
    needsKey: false,
    local: true,
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** True for endpoints on this machine or the local network (no data leaves the user's network). */
export function isLocalURL(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}
