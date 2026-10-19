import { describe, expect, it } from 'vitest';
import { canSee, offAxisAngle } from './sight';

const SIGHT = { radiusMeters: 70, halfAngleDegrees: 65 };
// A unit at the origin heading +Z (yaw 0). Forward is (sin 0, cos 0) = (0, 1).
const UNIT = { x: 0, z: 0, yaw: 0 };

describe('sight', () => {
  it('sees a target straight ahead, inside the radius', () => {
    expect(canSee(UNIT, { x: 0, z: 40 }, SIGHT)).toBe(true);
  });

  it('does not see a target beyond the radius', () => {
    expect(canSee(UNIT, { x: 0, z: 80 }, SIGHT)).toBe(false);
  });

  it('does not see a target behind the unit', () => {
    expect(canSee(UNIT, { x: 0, z: -20 }, SIGHT)).toBe(false);
  });

  it('uses the cone: inside the half angle is seen, outside is not', () => {
    // 60 degrees off the nose is inside 65 degrees; 80 degrees is outside.
    const inside = { x: 20 * Math.sin((60 * Math.PI) / 180), z: 20 * Math.cos((60 * Math.PI) / 180) };
    const outside = { x: 20 * Math.sin((80 * Math.PI) / 180), z: 20 * Math.cos((80 * Math.PI) / 180) };
    expect(canSee(UNIT, inside, SIGHT)).toBe(true);
    expect(canSee(UNIT, outside, SIGHT)).toBe(false);
  });

  it('follows the unit heading across the angle wrap', () => {
    // Heading just under -PI (facing -Z, rotated). A target behind the new heading must not be seen, and one in
    // front of it must be, with no wrap error.
    const turned = { x: 0, z: 0, yaw: Math.PI - 0.1 };
    expect(canSee(turned, { x: 0, z: -20 }, SIGHT)).toBe(true);
    expect(canSee(turned, { x: 0, z: 20 }, SIGHT)).toBe(false);
  });

  it('reports the off-axis angle in 0..pi', () => {
    expect(offAxisAngle(UNIT, { x: 0, z: 10 })).toBeCloseTo(0, 9);
    expect(offAxisAngle(UNIT, { x: 0, z: -10 })).toBeCloseTo(Math.PI, 9);
  });
});
