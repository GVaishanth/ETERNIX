import { describe, expect, it } from 'vitest';
import { metersPerSecondToKph, metersPerSecondToMph } from './units';

describe('speed unit conversions', () => {
  it('converts 10 m/s to 36 km/h', () => {
    expect(metersPerSecondToKph(10)).toBeCloseTo(36, 9);
  });

  it('converts 10 m/s to about 22.37 mph', () => {
    expect(metersPerSecondToMph(10)).toBeCloseTo(22.369, 3);
  });

  it('preserves the sign of reverse speed', () => {
    expect(metersPerSecondToKph(-5)).toBeCloseTo(-18, 9);
  });
});
