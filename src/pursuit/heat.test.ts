import { describe, expect, it } from 'vitest';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { addHeat, decayHeat, heatLevelFor, validateHeatLevels } from './heat';

const LEVELS = PURSUIT_CONFIG.heatLevels;
const MAX = PURSUIT_CONFIG.heat.maxHeat;

describe('heat levels', () => {
  it('the configured table is valid, with five levels that rise', () => {
    expect(validateHeatLevels(LEVELS, MAX)).toEqual([]);
    expect(LEVELS.map((level) => level.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it('flags a table that is not monotonic, or that has the wrong size', () => {
    const swapped = [LEVELS[0]!, { ...LEVELS[2]!, level: 2 }, { ...LEVELS[1]!, level: 3 }, LEVELS[3]!, LEVELS[4]!];
    expect(validateHeatLevels(swapped, MAX).some((line) => line.includes('must rise'))).toBe(true);
    expect(validateHeatLevels(LEVELS.slice(0, 4), MAX).some((line) => line.includes('expected 5'))).toBe(true);
  });

  it('flags a table whose first level does not start at zero', () => {
    const shifted = [{ ...LEVELS[0]!, heatThreshold: 5 }, ...LEVELS.slice(1)];
    expect(validateHeatLevels(shifted, MAX).some((line) => line.includes('start at heat 0'))).toBe(true);
  });

  it('maps heat to the highest reached level, at the thresholds exactly', () => {
    expect(heatLevelFor(0, LEVELS).level).toBe(1);
    expect(heatLevelFor(19.9, LEVELS).level).toBe(1);
    expect(heatLevelFor(20, LEVELS).level).toBe(2);
    expect(heatLevelFor(40, LEVELS).level).toBe(3);
    expect(heatLevelFor(65, LEVELS).level).toBe(4);
    expect(heatLevelFor(85, LEVELS).level).toBe(5);
    expect(heatLevelFor(100, LEVELS).level).toBe(5);
  });

  it('never levels up on a single small step below a threshold', () => {
    let heat = 0;
    let level = 1;
    for (let i = 0; i < 19; i += 1) {
      heat = addHeat(heat, 1, MAX);
      level = heatLevelFor(heat, LEVELS).level;
    }
    expect(level).toBe(1);
  });
});

describe('heat gain and decay', () => {
  it('caps gain at the maximum', () => {
    expect(addHeat(95, 20, MAX)).toBe(MAX);
  });

  it('ignores non-positive gain, so gain cannot be a decay in disguise', () => {
    expect(addHeat(30, -10, MAX)).toBe(30);
    expect(addHeat(30, 0, MAX)).toBe(30);
  });

  it('decays at the given rate, and never below zero', () => {
    expect(decayHeat(30, 4, 1)).toBeCloseTo(26, 9);
    expect(decayHeat(3, 4, 1)).toBe(0);
    expect(decayHeat(30, 4, -1)).toBe(30);
  });
});
