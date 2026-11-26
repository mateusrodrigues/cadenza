import { describe, expect, it } from 'vitest';
import { classifyHttpError, ProviderError } from './errors.js';
import { createProvider } from './index.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { PRESETS } from './presets.js';

function stubFetch(status: number, body: unknown, seen: { url?: string; body?: unknown } = {}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(input instanceof Request ? input.url : input);
    seen.body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const config = {
  presetId: 'custom',
  kind: 'openai-compatible' as const,
  baseURL: 'http://127.0.0.1:9/v1',
  apiKey: null,
  model: 'm',
};

const request = {
  model: 'm',
  system: 'sys',
  user: 'usr',
  jsonSchema: { type: 'object' },
  maxTokens: 100,
};

describe('OpenAICompatibleProvider', () => {
  it('sends a json_schema response_format and reads content and usage', async () => {
    const seen: { url?: string; body?: unknown } = {};
    const provider = new OpenAICompatibleProvider(
      config,
      stubFetch(
        200,
        {
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{"suggestions":[]}' },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
        seen,
      ),
    );
    const res = await provider.complete({ ...request, tier: 'json_schema' });
    expect(seen.url).toBe('http://127.0.0.1:9/v1/chat/completions');
    expect(seen.body).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
    expect(res).toEqual({
      text: '{"suggestions":[]}',
      truncated: false,
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('omits response_format for the prompted tier', async () => {
    const seen: { body?: unknown } = {};
    const provider = new OpenAICompatibleProvider(
      config,
      stubFetch(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] }, seen),
    );
    const res = await provider.complete({ ...request, tier: 'prompted' });
    expect(seen.body).not.toHaveProperty('response_format');
    expect(res.truncated).toBe(true);
  });

  it('maps schema rejections to unsupported_output and auth failures to auth', async () => {
    const schemaFail = new OpenAICompatibleProvider(
      config,
      stubFetch(400, { error: { message: 'JSON schema conversion failed' } }),
    );
    await expect(schemaFail.complete({ ...request, tier: 'json_schema' })).rejects.toMatchObject({
      kind: 'unsupported_output',
    });
    const authFail = new OpenAICompatibleProvider(
      config,
      stubFetch(401, { error: { message: 'bad key' } }),
    );
    await expect(authFail.complete({ ...request, tier: 'json_schema' })).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(authFail.complete({ ...request, tier: 'json_schema' })).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('reports cancellation', async () => {
    const provider = new OpenAICompatibleProvider(
      config,
      (async (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        })) as typeof fetch,
    );
    const ac = new AbortController();
    const p = provider.complete({ ...request, tier: 'prompted', signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('classifyHttpError', () => {
  it('classifies common statuses', () => {
    expect(classifyHttpError(429, '')).toBe('rate_limited');
    expect(classifyHttpError(400, 'maximum context length exceeded')).toBe('context_too_long');
    expect(classifyHttpError(503, '')).toBe('unavailable');
  });

  it('reads a 501 about structured output as a tier to skip', () => {
    expect(classifyHttpError(501, '501 structured output is unavailable')).toBe(
      'unsupported_output',
    );
    expect(classifyHttpError(501, 'Not Implemented')).toBe('unavailable');
  });
});

describe('presets', () => {
  it('have unique ids and every non-custom preset has a base URL', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PRESETS) {
      if (p.id !== 'custom' && p.kind !== 'mock') expect(p.baseURL).toMatch(/^https?:\/\//);
    }
  });

  it('createProvider builds an adapter for every preset kind', () => {
    for (const p of PRESETS) {
      const provider = createProvider({
        ...config,
        presetId: p.id,
        kind: p.kind,
        baseURL: p.baseURL,
      });
      expect(provider.kind).toBe(p.kind);
    }
  });
});

describe('isLocalURL', () => {
  it('recognizes loopback and private-network hosts', async () => {
    const { isLocalURL } = await import('./presets.js');
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:8360/v1',
      'http://[::1]:8080',
      'http://192.168.1.5:1234',
      'http://box.local:8000',
    ]) {
      expect(isLocalURL(url), url).toBe(true);
    }
    for (const url of ['https://api.openai.com/v1', 'https://example.com', 'not a url']) {
      expect(isLocalURL(url), url).toBe(false);
    }
  });
});

describe('classifyHttpError', () => {
  it('reads a 400 about the API key as an auth error', () => {
    expect(
      classifyHttpError(400, 'Incorrect API key provided. You can obtain an API key from …'),
    ).toBe('auth');
    expect(classifyHttpError(400, 'API key not valid. Please pass a valid API key.')).toBe('auth');
    expect(classifyHttpError(400, 'max_tokens must be positive')).toBe('unknown');
  });
});
