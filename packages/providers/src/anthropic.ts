import Anthropic from '@anthropic-ai/sdk';
import { classifyHttpError, ProviderError } from './errors.js';
import type {
  CompletionRequest,
  CompletionResult,
  ModelInfo,
  Provider,
  ProviderConfig,
} from './types.js';

/**
 * Anthropic Messages API adapter (official SDK in browser mode).
 *
 * - json_schema tier → `output_config.format` (structured outputs).
 * - json_object has no Anthropic equivalent, so it is sent like the prompted tier.
 * - Asks for low effort, since checks are short and latency matters; models that don't accept
 *   `effort` get one retry without it, remembered per model.
 */
export class AnthropicProvider implements Provider {
  readonly kind = 'anthropic' as const;
  private readonly client: Anthropic;
  private readonly noEffort = new Set<string>();

  constructor(config: ProviderConfig, fetchImpl?: typeof fetch) {
    this.client = new Anthropic({
      apiKey: config.apiKey ?? '',
      baseURL: config.baseURL || undefined,
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      ...(config.extraHeaders ? { defaultHeaders: config.extraHeaders } : {}),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    try {
      const models: ModelInfo[] = [];
      for await (const m of this.client.models.list({ limit: 100 }, { signal })) {
        models.push({ id: m.id, label: m.display_name || m.id });
      }
      return models;
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const withEffort = !this.noEffort.has(req.model);
    try {
      return await this.send(req, withEffort);
    } catch (err) {
      const e = toProviderError(err);
      if (withEffort && e.status === 400 && /effort/i.test(e.message)) {
        this.noEffort.add(req.model);
        return this.send(req, false).catch((err2) => {
          throw toProviderError(err2);
        });
      }
      throw e;
    }
  }

  private async send(req: CompletionRequest, withEffort: boolean): Promise<CompletionResult> {
    const outputConfig: Anthropic.OutputConfig = {
      ...(withEffort ? { effort: 'low' as const } : {}),
      ...(req.tier === 'json_schema'
        ? { format: { type: 'json_schema' as const, schema: req.jsonSchema } }
        : {}),
    };
    const res = await this.client.messages.create(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
      },
      { signal: req.signal },
    );
    if (res.stop_reason === 'refusal') {
      throw new ProviderError('refused', 'The model declined to check this text.');
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      truncated: res.stop_reason === 'max_tokens',
      reasoned: false,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) {
    return new ProviderError('cancelled', 'Request cancelled', { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('network', err.message || 'Could not reach the provider', {
      cause: err,
    });
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new ProviderError('auth', err.message, { status: err.status, cause: err });
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(err.headers?.get('retry-after'));
    return new ProviderError('rate_limited', err.message, {
      status: 429,
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : null,
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? null;
    return new ProviderError(classifyHttpError(status, err.message), err.message, {
      status,
      cause: err,
    });
  }
  return new ProviderError('unknown', err instanceof Error ? err.message : String(err), {
    cause: err,
  });
}
