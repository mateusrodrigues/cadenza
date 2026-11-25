import type { Suggestion } from '@cadenza/shared';
import type { TextMap } from './text-map';

export interface Renderer {
  /**
   * Draw exactly these suggestions (offsets into the field's current text). For
   * contenteditable fields the caller may pass the text map it already built.
   */
  render(suggestions: Suggestion[], map?: TextMap): void;
  /** The drawn suggestion whose underline is at this viewport point, if any. */
  hitTest(x: number, y: number): Suggestion | null;
  /** Where a drawn suggestion's text is on screen, one rect per line; only visible parts. */
  rectsOf(id: string): DOMRect[];
  /** Tint the suggestion whose card is open (null for none); kept across renders. */
  setActive(id: string | null): void;
  /** Scroll the field (and page) so a drawn suggestion is in view. */
  reveal(id: string): void;
  destroy(): void;
}
