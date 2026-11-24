import type { Category } from './categories.js';

/** A paragraph of field text. `pid` is stable for identical text, so results can be cached. */
export interface Paragraph {
  pid: string;
  text: string;
  /** Offset of the paragraph's first character within the whole field text. */
  start: number;
}

export type Dialect = 'en-US' | 'en-GB' | 'en-CA' | 'en-AU';

export interface CheckSettings {
  dialect: Dialect;
  categories: Category[];
  /** Ask the model for one-sentence explanations. Off for slow local models. */
  explanations: boolean;
}

export const DEFAULT_CHECK_SETTINGS: CheckSettings = {
  dialect: 'en-US',
  categories: ['correctness', 'clarity', 'style', 'tone'],
  explanations: true,
};

/** A suggestion anchored to exact offsets in the field text. Produced only by the engine. */
export interface Suggestion {
  id: string;
  pid: string;
  /** Absolute offsets into the field text, end exclusive. */
  start: number;
  end: number;
  original: string;
  replacement: string;
  category: Category;
  subtype: string | null;
  explanation: string | null;
}
