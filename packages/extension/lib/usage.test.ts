import { describe, expect, it } from 'vitest';
import { addUsage, checksToday, today, type UsageLog } from './usage';

const p = { id: 'a', name: 'Provider A' };

describe('usage', () => {
  it('adds requests and tokens per day and provider', () => {
    let log: UsageLog = {};
    log = addUsage(log, '2026-11-24', p, { inputTokens: 100, outputTokens: 20 });
    log = addUsage(log, '2026-11-24', p, null);
    log = addUsage(log, '2026-11-24', { id: 'b', name: 'B' }, { inputTokens: 5, outputTokens: 5 });
    expect(log['2026-11-24']?.a).toEqual({
      name: 'Provider A',
      checks: 2,
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(checksToday(log, new Set(['a']), '2026-11-24')).toBe(2);
    expect(checksToday(log, new Set(['a', 'b']), '2026-11-24')).toBe(3);
    expect(checksToday(log, new Set(['a']), '2026-11-25')).toBe(0);
  });

  it('keeps the last 31 days', () => {
    let log: UsageLog = {};
    for (let d = 1; d <= 40; d++) {
      log = addUsage(log, `2026-10-${String(d).padStart(2, '0')}`, p, null);
    }
    const days = Object.keys(log).sort();
    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-10-10');
  });

  it('names days by local date', () => {
    expect(today(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
