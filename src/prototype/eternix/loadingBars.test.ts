/*
 * The loading bars: each run time is random inside the 0.3 s to 0.7 s range, and there is one per bar.
 */
import { describe, expect, it } from 'vitest';
import { pickBarDurations, pickBarMs } from './loadingBars';

const RANGE = { minMs: 300, maxMs: 700 };

describe('pickBarMs', () => {
  it('maps the random source onto the range, and keeps both ends', () => {
    expect(pickBarMs(RANGE, () => 0)).toBe(300);
    expect(pickBarMs(RANGE, () => 0.5)).toBe(500);
    expect(pickBarMs(RANGE, () => 1)).toBe(700);
  });

  it('clamps a random value outside 0 to 1', () => {
    expect(pickBarMs(RANGE, () => -3)).toBe(300);
    expect(pickBarMs(RANGE, () => 9)).toBe(700);
  });
});

describe('pickBarDurations', () => {
  it('gives one run time per bar, each inside 300 to 700 ms', () => {
    const values = [0.02, 0.97, 0.5, 0.33, 0.8, 0.11];
    let index = 0;
    const durations = pickBarDurations(6, RANGE, () => values[index++ % values.length]!);
    expect(durations).toHaveLength(6);
    for (const ms of durations) {
      expect(ms).toBeGreaterThanOrEqual(300);
      expect(ms).toBeLessThanOrEqual(700);
    }
  });

  it('gives no bars for a zero or negative count', () => {
    expect(pickBarDurations(0, RANGE, () => 0.5)).toEqual([]);
    expect(pickBarDurations(-2, RANGE, () => 0.5)).toEqual([]);
  });
});
