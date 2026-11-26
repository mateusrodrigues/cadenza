import { describe, expect, it } from 'vitest';
import { parseParameterSize } from './model-size.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ProviderConfig } from './types.js';

describe('parseParameterSize', () => {
  it('reads the sizes local servers report', () => {
    expect(parseParameterSize('3.2B')).toBeCloseTo(3.2e9);
    expect(parseParameterSize('15B')).toBe(15e9);
    expect(parseParameterSize('270M')).toBe(270e6);
    expect(parseParameterSize('567.72M')).toBeCloseTo(567.72e6);
    expect(parseParameterSize('30B-A3B')).toBe(30e9);
    expect(parseParameterSize('8x7B')).toBe(56e9);
    expect(parseParameterSize('1.5b')).toBe(1.5e9);
  });

  it('ignores text that is not a size', () => {
    for (const s of ['', 'unknown', 'B', '7', 'v1.5', 'Bert']) {
      expect(parseParameterSize(s)).toBeUndefined();
    }
  });
});

/** A fake server: each path answers with its JSON body, everything else with a 404. */
function server(routes: Record<string, unknown>, seen: string[] = []) {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    seen.push(url.pathname);
    const body = routes[url.pathname];
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const openAIList = (ids: string[], extra: Record<string, unknown> = {}) => ({
  object: 'list',
  data: ids.map((id) => ({ id, object: 'model', owned_by: 'x', ...extra })),
});

function provider(presetId: string, baseURL: string, fetchImpl: typeof fetch) {
  const config: ProviderConfig = {
    presetId,
    kind: 'openai-compatible',
    baseURL,
    apiKey: null,
    model: null,
  };
  return new OpenAICompatibleProvider(config, fetchImpl);
}

describe('model sizes from local servers', () => {
  it('reads Ollama sizes from /api/tags', async () => {
    const fetchImpl = server({
      '/v1/models': openAIList(['llama3.2:3b', 'big:latest', 'odd']),
      '/api/tags': {
        models: [
          { name: 'llama3.2:3b', model: 'llama3.2:3b', details: { parameter_size: '3.2B' } },
          { name: 'big:latest', model: 'big:latest', details: { parameter_size: '14.7B' } },
          { name: 'odd', details: { parameter_size: 'n/a' } },
        ],
      },
    });
    const models = await provider('ollama', 'http://localhost:11434/v1', fetchImpl).listModels();
    expect(models.map((m) => [m.id, m.parameterCount])).toEqual([
      ['big:latest', 14.7e9],
      ['llama3.2:3b', 3.2e9],
      ['odd', undefined],
    ]);
  });

  it('reads LM Studio sizes by key and by loaded instance id', async () => {
    const fetchImpl = server({
      '/v1/models': openAIList(['org/small', 'org/small:2', 'embed']),
      '/api/v1/models': {
        models: [
          {
            key: 'org/small',
            params_string: '4B',
            loaded_instances: [{ id: 'org/small' }, { id: 'org/small:2' }],
          },
          { key: 'embed', params_string: null, loaded_instances: [] },
        ],
      },
    });
    const models = await provider('lmstudio', 'http://localhost:1234/v1', fetchImpl).listModels();
    expect(models.map((m) => m.parameterCount)).toEqual([undefined, 4e9, 4e9]);
  });

  it('reads llama.cpp sizes from the model list itself', async () => {
    const seen: string[] = [];
    const fetchImpl = server(
      { '/v1/models': openAIList(['model.gguf'], { meta: { n_params: 3212749888 } }) },
      seen,
    );
    const models = await provider('llamacpp', 'http://localhost:8080/v1', fetchImpl).listModels();
    expect(models[0]?.parameterCount).toBe(3212749888);
    expect(seen).toEqual(['/v1/models']);
  });

  it('shows no size when the server reports none or fails', async () => {
    const fetchImpl = server({ '/v1/models': openAIList(['m']), '/api/tags': { error: 'x' } });
    const models = await provider('ollama', 'http://localhost:11434/v1', fetchImpl).listModels();
    expect(models).toEqual([{ id: 'm', label: 'm' }]);
  });

  it('probes a custom local endpoint, but never a hosted one', async () => {
    const local: string[] = [];
    await provider('custom', 'http://127.0.0.1:9000/v1', server(OLLAMA, local)).listModels();
    expect(local.sort()).toEqual(['/api/tags', '/api/v1/models', '/v1/models']);

    const hosted: string[] = [];
    await provider('custom', 'https://api.example.com/v1', server(OLLAMA, hosted)).listModels();
    await provider('openai', 'https://api.example.com/v1', server(OLLAMA, hosted)).listModels();
    expect(hosted).toEqual(['/v1/models', '/v1/models']);
  });
});

const OLLAMA = {
  '/v1/models': openAIList(['m']),
  '/api/tags': { models: [{ name: 'm', details: { parameter_size: '1B' } }] },
};
