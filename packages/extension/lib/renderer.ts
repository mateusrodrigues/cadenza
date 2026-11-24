import type { Suggestion } from '@cadenza/shared';
import type { TextMap } from './text-map';

export interface Renderer {
  /**
   * Draw exactly these suggestions (offsets into the field's current text). For
   * contenteditable fields the caller may pass the text map it already built.
   */
  render(suggestions: Suggestion[], map?: TextMap): void;
  destroy(): void;
}
