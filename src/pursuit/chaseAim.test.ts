import { describe, expect, it } from 'vitest';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { chaseAimPoint } from './chaseAim';

/*
 * The chase aim (pure). The vehicle faces (sin yaw, cos yaw): yaw 0 faces +Z. "Behind" moves the aim point back along
 * that direction, so a chasing unit comes up on the tail and tags the player instead of driving into the car's centre.
 */

const BEHIND = 2;

describe('chase aim point', () => {
  it('is behind the player, along the heading, when the player faces +Z', () => {
    const aim = chaseAimPoint(10, 20, 0, BEHIND);
    expect(aim.x).toBeCloseTo(10, 9);
    expect(aim.z).toBeCloseTo(18, 9);
  });

  it('is behind the player when the player faces +X (yaw 90 degrees, a right turn from +Z)', () => {
    const aim = chaseAimPoint(10, 20, Math.PI / 2, BEHIND);
    expect(aim.x).toBeCloseTo(8, 9);
    expect(aim.z).toBeCloseTo(20, 9);
  });

  it('is exactly the configured distance from the player, whatever the heading', () => {
    for (const yaw of [0, 0.7, 2.1, Math.PI, -1.3]) {
      const aim = chaseAimPoint(-40, 75, yaw, BEHIND);
      expect(Math.hypot(aim.x + 40, aim.z - 75)).toBeCloseTo(BEHIND, 9);
    }
  });

  it('uses the configured routing distance, and it is a real offset behind the player', () => {
    expect(PURSUIT_CONFIG.routing.chaseBehindMeters).toBeGreaterThan(0);
    const aim = chaseAimPoint(0, 0, 0, PURSUIT_CONFIG.routing.chaseBehindMeters);
    expect(aim.z).toBeLessThan(0);
  });
});
