import type { Category } from './categories.js';

/** A paragraph of field text. `pid` is stable for identical text, so results can be cached. */
export interface Paragraph {
  pid: string;
  text: string;
  /** Offset of the paragraph's first character within the whole field text. */
  start: number;
}

export type Dialect = 'en-US' | 'en-GB' | 'en-CA' | 'en-AU';

/** What the writer is aiming for. 'any' leaves it to the model's reading of the text. */
export interface Goals {
  formality: 'any' | 'informal' | 'neutral' | 'formal';
  audience: 'any' | 'general' | 'expert';
}

export const DEFAULT_GOALS: Goals = { formality: 'any', audience: 'any' };

export interface CheckSettings {
  dialect: Dialect;
  categories: Category[];
  /** Ask the model for one-sentence explanations. Off for slow local models. */
  explanations: boolean;
  /** Absent means DEFAULT_GOALS. */
  goals?: Goals;
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
