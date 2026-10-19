/*
 * Automated tests for the pursuing unit's speed cap: each heat level's cap times the pursuit multiplier (2.5), never
 * below the unit minimum before the multiplier. The cap is a pure function, so no session is needed.
 */
import { describe, expect, it } from 'vitest';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { pursuingSpeedCapMps } from './pursuitController';

describe('pursuing speed cap', () => {
  it('uses the 2.5 times multiplier from the config', () => {
    expect(PURSUIT_CONFIG.unit.pursuitSpeedMultiplier).toBe(2.5);
  });

  it('multiplies each heat level cap by 2.5', () => {
    expect(pursuingSpeedCapMps(26)).toBeCloseTo(65, 9);
    expect(pursuingSpeedCapMps(40)).toBeCloseTo(100, 9);
  });

  it('never goes below the unit minimum, before the multiplier', () => {
    expect(pursuingSpeedCapMps(0)).toBeCloseTo(PURSUIT_CONFIG.unit.minCapMps * 2.5, 9);
  });

  it('rises with the heat level', () => {
    const caps = [26, 29, 32, 36, 40].map((cap) => pursuingSpeedCapMps(cap));
    for (let i = 1; i < caps.length; i += 1) expect(caps[i]!).toBeGreaterThan(caps[i - 1]!);
  });
});
