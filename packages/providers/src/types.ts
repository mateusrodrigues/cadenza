/**
 * How strictly the provider can be made to return JSON, best first.
 * - json_schema: decoding constrained to our schema
 * - json_object: provider guarantees some JSON object
 * - prompted: plain text; we ask for JSON and parse leniently
 */
export type OutputTier = 'json_schema' | 'json_object' | 'prompted';
export const OUTPUT_TIERS: readonly OutputTier[] = ['json_schema', 'json_object', 'prompted'];

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini' | 'mock';

export interface ProviderConfig {
  /** Preset id, or "custom". */
  presetId: string;
  kind: ProviderKind;
  baseURL: string;
  apiKey: string | null;
  model: string | null;
  extraHeaders?: Record<string, string>;
}

export interface ModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
}

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  tier: OutputTier;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  /**
   * For models that think before they answer: 'on' lets them think (local servers keep their
   * own sampling, since thinking models loop at temperature 0), 'off' asks them not to.
   * Absent: send nothing and let the model do what it does by default.
   */
  thinking?: ThinkingMode;
  signal?: AbortSignal;
}

export type ThinkingMode = 'on' | 'off';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: Usage | null;
  /** True if the model stopped because it hit maxTokens (output is likely truncated). */
  truncated: boolean;
  /** True if the model thought before it answered (it returned reasoning or reasoning tokens). */
  reasoned: boolean;
}

export interface Provider {
  readonly kind: ProviderKind;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
