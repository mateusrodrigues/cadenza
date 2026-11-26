import {
  OUTPUT_TIERS,
  type OutputTier,
  type Provider,
  ProviderError,
  type ThinkingMode,
  type Usage,
} from '@cadenza/providers';
import {
  type CheckSettings,
  outputJsonSchema,
  type Paragraph,
  type Suggestion,
} from '@cadenza/shared';
import { anchorSuggestions } from './anchor.js';
import { parseModelOutput, parseTruncatedOutput } from './parse.js';
import { buildPrompt, maxTokensFor, THINKING_TOKENS } from './prompt.js';

export interface CheckOptions {
  provider: Provider;
  model: string;
  paragraphs: Paragraph[];
  settings: CheckSettings;
  /** Best tier to try first; lower tiers are tried if the provider rejects it. */
  tier?: OutputTier;
  /** See CompletionRequest.thinking. Unless 'off', the output budget leaves room to think. */
  thinking?: ThinkingMode;
  signal?: AbortSignal;
}

export interface CheckOutcome {
  suggestions: Suggestion[];
  /** The tier that worked. Callers cache it per provider+model to skip failed tiers next time. */
  tier: OutputTier;
  usage: Usage | null;
  /** Items the model returned that could not be validated or anchored. */
  dropped: number;
  /** The model's items as returned, before validation and anchoring (for evals). */
  items: unknown[];
  /** The model thought before it answered, so it can be offered the thinking switch. */
  reasoned: boolean;
  /** Thinking ran out of tokens and the answer came from a retry with thinking off. */
  thinkingFellBack: boolean;
}

export async function checkParagraphs(opts: CheckOptions): Promise<CheckOutcome> {
  if (opts.paragraphs.length === 0) {
    return {
      suggestions: [],
      tier: opts.tier ?? 'json_schema',
      usage: null,
      dropped: 0,
      items: [],
      reasoned: false,
      thinkingFellBack: false,
    };
  }
  const startAt = OUTPUT_TIERS.indexOf(opts.tier ?? 'json_schema');
  let lastError: unknown;
  let thinking = opts.thinking;
  let thinkingFellBack = false;
  let reasoned = false;
  /** Tokens of a first try that ran out while thinking, added to the retry's usage. */
  let spent: Usage | null = null;

  for (let i = startAt; i < OUTPUT_TIERS.length; i++) {
    const tier = OUTPUT_TIERS[i] as OutputTier;
    const prompt = buildPrompt(opts.paragraphs, opts.settings, tier);
    try {
      const answerTokens = maxTokensFor(opts.paragraphs, opts.settings);
      const result = await opts.provider.complete({
        model: opts.model,
        system: prompt.system,
        user: prompt.user,
        tier,
        jsonSchema: outputJsonSchema(opts.settings),
        maxTokens: thinking === 'off' ? answerTokens : answerTokens + THINKING_TOKENS,
        ...(thinking ? { thinking } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      reasoned ||= result.reasoned;
      // Output cut off by the token limit still carries the suggestions completed before it.
      const items =
        parseModelOutput(result.text) ??
        (result.truncated ? parseTruncatedOutput(result.text) : null);
      // A thinking model can loop until the limit; ask once more without thinking.
      if (items === null && result.truncated && result.reasoned && thinking !== 'off') {
        spent = result.usage;
        thinking = 'off';
        thinkingFellBack = true;
        i--;
        continue;
      }
      if (items === null) {
        throw new ProviderError(
          'bad_output',
          result.truncated
            ? 'The model ran out of output tokens before finishing.'
            : 'The model did not return valid JSON.',
        );
      }
      const stats = { dropped: 0 };
      const suggestions = anchorSuggestions(items, opts.paragraphs, stats);
      return {
        suggestions,
        tier,
        usage: addUsage(spent, result.usage),
        dropped: stats.dropped,
        items,
        reasoned,
        thinkingFellBack,
      };
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

function addUsage(a: Usage | null, b: Usage | null): Usage | null {
  if (!a || !b) return b ?? a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
