import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import type { ProviderConfig } from './types.js';

interface Seen {
  url?: string;
  headers?: Headers;
  body?: Record<string, unknown>;
}

/** A fetch stub that replies with `responses` in order and records each request. */
function stubFetch(responses: { status: number; body: unknown }[], seen: Seen[] = []) {
  let i = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    seen.push({
      url: req ? req.url : String(input),
      headers: new Headers(init?.headers ?? req?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = responses[Math.min(i++, responses.length - 1)] ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const base = { presetId: 'x', apiKey: 'test-key', model: 'm' };
const request = {
  model: 'm',
  system: 'sys',
  user: 'usr',
  jsonSchema: { type: 'object' },
  maxTokens: 100,
};

const anthropicMessage = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg',
  type: 'message',
  role: 'assistant',
  model: 'm',
  content: [{ type: 'text', text: '{"suggestions":[]}' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 3 },
  ...overrides,
});

describe('AnthropicProvider', () => {
  const config: ProviderConfig = {
    ...base,
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.example',
  };

  it('sends structured-output format, low effort and browser-access header', async () => {
    const seen: Seen[] = [];
    const p = new AnthropicProvider(
      config,
      stubFetch([{ status: 200, body: anthropicMessage() }], seen),
    );
    const res = await p.complete({ ...request, tier: 'json_schema' });
    expect(res).toEqual({
      text: '{"suggestions":[]}',
      truncated: false,
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    expect(seen[0]?.url).toBe('https://api.anthropic.example/v1/messages');
    expect(seen[0]?.headers?.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(seen[0]?.body).toMatchObject({
      system: 'sys',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } },
    });
  });

  it('retries once without effort when the model rejects it, and remembers', async () => {
    const seen: Seen[] = [];
    const p = new AnthropicProvider(
      config,
      stubFetch(
        [
          {
            status: 400,
            body: {
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: 'effort is not supported for this model',
              },
            },
          },
          { status: 200, body: anthropicMessage() },
        ],
        seen,
      ),
    );
    await p.complete({ ...request, tier: 'prompted' });
    await p.complete({ ...request, tier: 'prompted' });
    expect(
      seen.map((s) => (s.body?.output_config as { effort?: string } | undefined)?.effort),
    ).toEqual(['low', undefined, undefined]);
  });

  it('maps refusals, truncation and auth errors', async () => {
    const refused = new AnthropicProvider(
      config,
      stubFetch([{ status: 200, body: anthropicMessage({ stop_reason: 'refusal', content: [] }) }]),
    );
    await expect(refused.complete({ ...request, tier: 'prompted' })).rejects.toMatchObject({
      kind: 'refused',
    });
    const truncated = new AnthropicProvider(
      config,
      stubFetch([{ status: 200, body: anthropicMessage({ stop_reason: 'max_tokens' }) }]),
    );
    expect((await truncated.complete({ ...request, tier: 'prompted' })).truncated).toBe(true);
    const auth = new AnthropicProvider(
      config,
      stubFetch([
        {
          status: 401,
          body: {
            type: 'error',
            error: { type: 'authentication_error', message: 'invalid x-api-key' },
          },
        },
      ]),
    );
    await expect(auth.listModels()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('lists models with display names', async () => {
    const p = new AnthropicProvider(
      config,
      stubFetch([
        {
          status: 200,
          body: {
            data: [
              {
                type: 'model',
                id: 'model-a',
                display_name: 'Model A',
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
            has_more: false,
            first_id: 'model-a',
            last_id: 'model-a',
          },
        },
      ]),
    );
    expect(await p.listModels()).toEqual([{ id: 'model-a', label: 'Model A' }]);
  });
});

describe('GeminiProvider', () => {
  afterEach(() => vi.unstubAllGlobals());
  const config: ProviderConfig = {
    ...base,
    kind: 'gemini',
    baseURL: 'https://gemini.example',
  };

  it('sends JSON schema config and reads text and usage', async () => {
    const seen: Seen[] = [];
    vi.stubGlobal(
      'fetch',
      stubFetch(
        [
          {
            status: 200,
            body: {
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: '{"suggestions":[]}' }] },
                  finishReason: 'STOP',
                },
              ],
              usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4 },
            },
          },
        ],
        seen,
      ),
    );
    const res = await new GeminiProvider(config).complete({ ...request, tier: 'json_schema' });
    expect(res).toEqual({
      text: '{"suggestions":[]}',
      truncated: false,
      usage: { inputTokens: 20, outputTokens: 4 },
    });
    expect(seen[0]?.url).toMatch(/^https:\/\/gemini\.example\/.*models\/m:generateContent/);
    expect(seen[0]?.headers?.get('x-goog-api-key')).toBe('test-key');
    expect(seen[0]?.body).toMatchObject({
      systemInstruction: { parts: [{ text: 'sys' }] },
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' },
        maxOutputTokens: 100,
      },
    });
  });

  it('treats an invalid key (HTTP 400) as an auth error', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        {
          status: 400,
          body: {
            error: {
              code: 400,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'INVALID_ARGUMENT',
            },
          },
        },
      ]),
    );
    await expect(new GeminiProvider(config).listModels()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('maps safety blocks to refused', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([{ status: 200, body: { candidates: [{ finishReason: 'SAFETY' }] } }]),
    );
    await expect(
      new GeminiProvider(config).complete({ ...request, tier: 'prompted' }),
    ).rejects.toMatchObject({ kind: 'refused' });
  });

  it('lists only models that can generate content', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch([
        {
          status: 200,
          body: {
            models: [
              {
                name: 'models/gen-a',
                displayName: 'Gen A',
                inputTokenLimit: 1000,
                supportedGenerationMethods: ['generateContent'],
              },
              {
                name: 'models/embed-b',
                displayName: 'Embed B',
                supportedGenerationMethods: ['embedContent'],
              },
            ],
          },
        },
      ]),
    );
    expect(await new GeminiProvider(config).listModels()).toEqual([
      { id: 'gen-a', label: 'Gen A', contextWindow: 1000 },
    ]);
  });
});
