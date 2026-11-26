import type { ModelInfo } from '@cadenza/providers';

/**
 * Below this many parameters a model flags correct text too often to be useful. Measured in
 * docs/evals.md ("Small local models"): 3B and 8B are far off the target, 14B is usable in
 * slow model mode. 9–13B hasn't been measured, so it gets no warning until it has.
 */
export const SMALL_MODEL_PARAMS = 9e9;

/** True only when the server reported a size and it is under the limit. */
export function isSmallModel(model: ModelInfo | undefined): boolean {
  const n = model?.parameterCount;
  return n !== undefined && n < SMALL_MODEL_PARAMS;
}

/** Show `el` (a `.warn` paragraph) when the chosen model is small. */
export function showSmallModelWarning(
  el: HTMLElement,
  models: readonly ModelInfo[],
  chosen: string,
): void {
  el.hidden = !isSmallModel(models.find((m) => m.id === chosen));
}
