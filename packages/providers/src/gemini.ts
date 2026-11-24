import { ApiError, GoogleGenAI } from '@google/genai';
import { classifyHttpError, ProviderError } from './errors.js';
import type {
  CompletionRequest,
  CompletionResult,
  ModelInfo,
  Provider,
  ProviderConfig,
} from './types.js';

/**
 * Google Gemini adapter (official GenAI SDK, API-key auth).
 *
 * - json_schema tier → `responseMimeType: application/json` + `responseJsonSchema`.
 * - json_object tier → `responseMimeType: application/json` only.
 */
export class GeminiProvider implements Provider {
  readonly kind = 'gemini' as const;
  private readonly client: GoogleGenAI;

  constructor(config: ProviderConfig) {
    this.client = new GoogleGenAI({
      apiKey: config.apiKey ?? '',
      httpOptions: {
        ...(config.baseURL ? { baseUrl: config.baseURL } : {}),
        ...(config.extraHeaders ? { headers: config.extraHeaders } : {}),
      },
    });
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    try {
      const models: ModelInfo[] = [];
      const pager = await this.client.models.list({
        config: { pageSize: 100, ...(signal ? { abortSignal: signal } : {}) },
      });
      for await (const m of pager) {
        if (!m.name || !(m.supportedActions ?? ['generateContent']).includes('generateContent')) {
          continue;
        }
        const id = m.name.replace(/^models\//, '');
        models.push({
          id,
          label: m.displayName || id,
          ...(m.inputTokenLimit ? { contextWindow: m.inputTokenLimit } : {}),
        });
      }
      return models;
    } catch (err) {
      throw toProviderError(err, signal);
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    try {
      const res = await this.client.models.generateContent({
        model: req.model,
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxTokens,
          ...(req.tier !== 'prompted' ? { responseMimeType: 'application/json' } : {}),
          ...(req.tier === 'json_schema' ? { responseJsonSchema: req.jsonSchema } : {}),
          ...(req.signal ? { abortSignal: req.signal } : {}),
        },
      });
      const candidate = res.candidates?.[0];
      if (!candidate && res.promptFeedback?.blockReason) {
        throw new ProviderError('refused', 'The provider blocked this text.');
      }
      const finish = candidate?.finishReason;
      if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') {
        throw new ProviderError('refused', 'The provider blocked this text.');
      }
      return {
        text: res.text ?? '',
        truncated: finish === 'MAX_TOKENS',
        usage: res.usageMetadata
          ? {
              inputTokens: res.usageMetadata.promptTokenCount ?? 0,
              outputTokens: res.usageMetadata.candidatesTokenCount ?? 0,
            }
          : null,
      };
    } catch (err) {
      throw toProviderError(err, req.signal);
    }
  }
}

function toProviderError(err: unknown, signal?: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
    return new ProviderError('cancelled', 'Request cancelled', { cause: err });
  }
  if (err instanceof ApiError) {
    // Gemini answers an invalid key with 400 INVALID_ARGUMENT rather than 401.
    if (/api key not valid|api_key_invalid/i.test(err.message)) {
      return new ProviderError('auth', 'The API key was rejected.', {
        status: err.status,
        cause: err,
      });
    }
    return new ProviderError(classifyHttpError(err.status, err.message), err.message, {
      status: err.status,
      cause: err,
    });
  }
  if (err instanceof TypeError) {
    // fetch() rejects with TypeError on network/CORS failures.
    return new ProviderError('network', err.message, { cause: err });
  }
  return new ProviderError('unknown', err instanceof Error ? err.message : String(err), {
    cause: err,
  });
}
