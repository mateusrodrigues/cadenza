import type { Suggestion } from '@cadenza/shared';

export interface Renderer {
  render(suggestions: Suggestion[]): void;
  /** Called after each edit, before a new check result arrives. */
  revalidate(): void;
  destroy(): void;
}
