import type { ModelInfo, ProviderConfig } from '@cadenza/providers';
import type { Paragraph, Suggestion } from '@cadenza/shared';
import type { IgnoreRule } from './ignored';

export interface WorkerError {
  kind: string;
  message: string;
  status?: number | null;
}

// ---- From content scripts --------------------------------------------------------------

export interface CheckMessage {
  type: 'cadenza/check';
  /** Identifies the field within its frame; a newer request replaces older ones. */
  fieldId: string;
  paragraphs: Paragraph[];
  /** Paragraph ids to check first (the one with the caret). */
  priority?: string[];
  /** Hostname of the top-level page (the tab's site, also for fields in frames). */
  site?: string;
}

export type CheckResponse =
  | {
      ok: true;
      suggestions: Suggestion[];
      /** Paragraphs not checked yet (slow mode checks one per request); ask again. */
      pending: number;
      /** The active provider is in slow mode: debounce longer. */
      slow: boolean;
      /** Cadenza is off here (globally, for this site, or not set up): show nothing. */
      off?: boolean;
    }
  | { ok: false; error: WorkerError; cancelled: boolean };

export interface ForgetMessage {
  type: 'cadenza/forget';
  fieldId: string;
}

/** "Don't suggest this again", sent after the user clicks it on a card. */
export interface IgnoreMessage {
  type: 'cadenza/ignore';
  rule: IgnoreRule;
}

/** "Add to dictionary", sent after the user clicks it on a card. */
export interface AddWordMessage {
  type: 'cadenza/add-word';
  word: string;
}

// ---- From the worker to content scripts ---------------------------------------------------

/** The keyboard shortcut was pressed: the focused field shows its suggestion at the cursor. */
export interface KeyboardMessage {
  type: 'cadenza/keyboard';
}

/** Settings changed (site toggle, dictionary, unlock…): check open fields again. */
export interface RefreshMessage {
  type: 'cadenza/refresh';
}

// ---- From extension pages only (popup, options) -------------------------------------------

export interface StatusMessage {
  type: 'cadenza/status';
}

export interface StatusResponse {
  enabled: boolean;
  provider: { name: string; model: string | null; slowMode: boolean } | null;
  /** API keys are locked with a passphrase that hasn't been entered this session. */
  locked: boolean;
}

export interface ListModelsMessage {
  type: 'cadenza/list-models';
  config: ProviderConfig;
}

export type ListModelsResponse =
  | { ok: true; models: ModelInfo[] }
  | { ok: false; error: WorkerError };

export interface TestMessage {
  type: 'cadenza/test';
  config: ProviderConfig;
  explanations: boolean;
}

export type TestResponse =
  | {
      ok: true;
      ms: number;
      tier: string;
      found: { original: string; replacement: string }[];
    }
  | { ok: false; error: WorkerError };

/**
 * Let Cadenza reach a local server that rejects browser-extension origins (e.g. Ollama without
 * OLLAMA_ORIGINS). The page must have obtained the host permission first.
 */
export interface AllowOriginMessage {
  type: 'cadenza/allow-origin';
  origin: string;
}

export type AllowOriginResponse = { ok: true } | { ok: false; error: WorkerError };

export type ContentMessage = CheckMessage | ForgetMessage | IgnoreMessage | AddWordMessage;
export type PageMessage = StatusMessage | ListModelsMessage | TestMessage | AllowOriginMessage;
