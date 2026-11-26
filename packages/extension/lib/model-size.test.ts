import { describe, expect, it } from 'vitest';
import { isSmallModel, SMALL_MODEL_PARAMS } from './model-size';

describe('isSmallModel', () => {
  it('warns only below the limit, and only when the server reported a size', () => {
    expect(isSmallModel({ id: 'a', label: 'a', parameterCount: 3.2e9 })).toBe(true);
    expect(isSmallModel({ id: 'e', label: 'e', parameterCount: 8.03e9 })).toBe(true);
    expect(isSmallModel({ id: 'b', label: 'b', parameterCount: SMALL_MODEL_PARAMS })).toBe(false);
    expect(isSmallModel({ id: 'c', label: 'c', parameterCount: 14.7e9 })).toBe(false);
    expect(isSmallModel({ id: 'd', label: 'd' })).toBe(false);
    expect(isSmallModel(undefined)).toBe(false);
  });
});
