import { describe, expect, it } from 'vitest';
import { formatPlace, formatRaceTime } from './raceFormat';

describe('race time format', () => {
  it('shows m:ss.t and clamps bad input to zero', () => {
    expect(formatRaceTime(0)).toBe('0:00.0');
    expect(formatRaceTime(12.34)).toBe('0:12.3');
    expect(formatRaceTime(65.06)).toBe('1:05.0');
    expect(formatRaceTime(-3)).toBe('0:00.0');
    expect(formatRaceTime(Number.NaN)).toBe('0:00.0');
  });
});

describe('place format', () => {
  it('uses ordinal suffixes, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(formatPlace)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th',
    ]);
  });
});
