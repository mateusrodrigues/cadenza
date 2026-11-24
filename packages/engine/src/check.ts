import {
  OUTPUT_TIERS,
  type OutputTier,
  type Provider,
  ProviderError,
  type Usage,
} from '@cadenza/providers';
import {
  type CheckSettings,
  outputJsonSchema,
  type Paragraph,
  type Suggestion,
} from '@cadenza/shared';
import { anchorSuggestions } from './anchor.js';
import { parseModelOutput } from './parse.js';
import { buildPrompt, maxTokensFor } from './prompt.js';

export interface CheckOptions {
  provider: Provider;
  model: string;
  paragraphs: Paragraph[];
  settings: CheckSettings;
  /** Best tier to try first; lower tiers are tried if the provider rejects it. */
  tier?: OutputTier;
  signal?: AbortSignal;
}

export interface CheckOutcome {
  suggestions: Suggestion[];
  /** The tier that worked. Callers cache it per provider+model to skip failed tiers next time. */
  tier: OutputTier;
  usage: Usage | null;
  /** Items the model returned that could not be validated or anchored. */
  dropped: number;
}

export async function checkParagraphs(opts: CheckOptions): Promise<CheckOutcome> {
  if (opts.paragraphs.length === 0) {
    return { suggestions: [], tier: opts.tier ?? 'json_schema', usage: null, dropped: 0 };
  }
  const startAt = OUTPUT_TIERS.indexOf(opts.tier ?? 'json_schema');
  let lastError: unknown;

  for (const tier of OUTPUT_TIERS.slice(startAt)) {
    const prompt = buildPrompt(opts.paragraphs, opts.settings, tier);
    try {
      const result = await opts.provider.complete({
        model: opts.model,
        system: prompt.system,
        user: prompt.user,
        tier,
        jsonSchema: outputJsonSchema(opts.settings),
        maxTokens: maxTokensFor(opts.paragraphs, opts.settings),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const items = parseModelOutput(result.text);
      if (items === null) {
        throw new ProviderError(
          'bad_output',
          result.truncated
            ? 'The model ran out of output tokens before finishing.'
            : 'The model did not return valid JSON.',
        );
      }
      const suggestions = anchorSuggestions(items, opts.paragraphs);
      return { suggestions, tier, usage: result.usage, dropped: items.length - suggestions.length };
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'unsupported_output') {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
