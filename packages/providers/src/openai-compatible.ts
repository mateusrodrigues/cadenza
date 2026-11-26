import OpenAI from 'openai';
import { classifyHttpError, ProviderError } from './errors.js';
import { addParameterCounts, type SizeSource } from './model-size.js';
import { isLocalURL } from './presets.js';
import type {
  CompletionRequest,
  CompletionResult,
  ModelInfo,
  Provider,
  ProviderConfig,
} from './types.js';

/**
 * Adapter for every server that speaks the OpenAI Chat Completions API: OpenAI itself,
 * OpenRouter, Mistral, Groq, … and local servers (Ollama, LM Studio, llama.cpp, vLLM).
 */
export class OpenAICompatibleProvider implements Provider {
  readonly kind = 'openai-compatible' as const;
  private readonly client: OpenAI;
  /**
   * Local servers default to sampling (llama.cpp: temperature 0.8), which makes checks vary
   * between runs. Hosted reasoning models reject a temperature, so only local ones get 0.
   */
  private readonly temperature: { temperature: number } | Record<string, never>;
  private readonly config: ProviderConfig;
  private readonly fetch: typeof fetch;

  constructor(config: ProviderConfig, fetchImpl?: typeof fetch) {
    this.config = config;
    this.fetch = fetchImpl ?? ((input, init) => fetch(input, init));
    this.temperature = isLocalURL(config.baseURL) ? { temperature: 0 } : {};
    this.client = new OpenAI({
      // Local servers usually need no key, but the SDK requires a non-empty string.
      apiKey: config.apiKey || 'no-key',
      baseURL: config.baseURL,
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      // Local CPU inference can take minutes; the engine cancels stale requests itself.
      timeout: 10 * 60 * 1000,
      ...(config.extraHeaders ? { defaultHeaders: config.extraHeaders } : {}),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    try {
      const models: ModelInfo[] = [];
      for await (const m of this.client.models.list({ signal })) {
        // llama.cpp's server adds the size to each entry: `meta: { n_params: 3212749888 }`.
        const meta = (m as { meta?: { n_params?: unknown } }).meta;
        const n = meta?.n_params;
        models.push({
          id: m.id,
          label: m.id,
          ...(typeof n === 'number' && n > 0 ? { parameterCount: n } : {}),
        });
      }
      await this.addSizes(models, signal);
      return models.sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw toProviderError(err);
    }
  }

  /** Ollama and LM Studio report model sizes only in their native API, beside /v1. */
  private async addSizes(models: ModelInfo[], signal?: AbortSignal): Promise<void> {
    const { presetId, baseURL, apiKey, extraHeaders } = this.config;
    const sources: SizeSource[] =
      presetId === 'ollama' || presetId === 'lmstudio'
        ? [presetId]
        : presetId === 'custom' && isLocalURL(baseURL)
          ? ['ollama', 'lmstudio']
          : [];
    const root = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
    const headers = { ...extraHeaders, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
    await addParameterCounts(models, sources, root, this.fetch, headers, signal);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const responseFormat =
      req.tier === 'json_schema'
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: { name: 'cadenza_suggestions', strict: true, schema: req.jsonSchema },
            },
          }
        : req.tier === 'json_object'
          ? { response_format: { type: 'json_object' as const } }
          : {};
    try {
      const res = await this.client.chat.completions.create(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          ...responseFormat,
          ...this.temperature,
        },
        { signal: req.signal },
      );
      const choice = res.choices[0];
      return {
        text: choice?.message.content ?? '',
        truncated: choice?.finish_reason === 'length',
        usage: res.usage
          ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
          : null,
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIUserAbortError) {
    return new ProviderError('cancelled', 'Request cancelled', { cause: err });
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new ProviderError('network', err.message || 'Could not reach the provider', {
      cause: err,
    });
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? null;
    const retryAfter = Number(err.headers?.get?.('retry-after'));
    return new ProviderError(classifyHttpError(status, err.message), err.message, {
      status,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : null,
      cause: err,
    });
  }
  return new ProviderError('unknown', err instanceof Error ? err.message : String(err), {
    cause: err,
  });
}
