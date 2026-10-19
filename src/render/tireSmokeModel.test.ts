/*
 * Automated tests for the tire-smoke rules and pool (Part 10): smoke only from real slip, handbrake, or wheelspin; no
 * smoke when stopped; bounded emission; and a ring pool that reuses slots and never grows.
 */
import { describe, expect, it } from 'vitest';
import { SMOKE_RULES, SmokePool, emitCountFor, smokeLevel, type SmokeInput } from './tireSmokeModel';

const still: SmokeInput = {
  speedMetersPerSecond: 0,
  lateralSpeedMetersPerSecond: 0,
  handbrake: false,
  throttle: 0,
  wheelSpinRadiansPerSecond: 0,
};

const cruising: SmokeInput = { ...still, speedMetersPerSecond: 20 };

describe('smokeLevel', () => {
  it('is zero for a car that is not moving, even with a handbrake or spin', () => {
    expect(smokeLevel({ ...still, handbrake: true })).toBe(0);
    expect(smokeLevel({ ...still, throttle: 1, wheelSpinRadiansPerSecond: 80 })).toBe(0);
  });

  it('is zero for steady grip driving', () => {
    expect(smokeLevel(cruising)).toBe(0);
  });

  it('rises with real lateral slip and reaches full at the configured slip', () => {
    const mid = smokeLevel({ ...cruising, lateralSpeedMetersPerSecond: (SMOKE_RULES.slipStartMetersPerSecond + SMOKE_RULES.slipFullMetersPerSecond) / 2 });
    expect(mid).toBeCloseTo(0.5, 9);
    expect(smokeLevel({ ...cruising, lateralSpeedMetersPerSecond: SMOKE_RULES.slipFullMetersPerSecond })).toBe(1);
  });

  it('smokes from the handbrake, at a fixed level', () => {
    expect(smokeLevel({ ...cruising, handbrake: true })).toBeCloseTo(0.6, 9);
  });

  it('smokes from wheelspin only under throttle', () => {
    const spinning = { ...cruising, wheelSpinRadiansPerSecond: SMOKE_RULES.spinFullRadiansPerSecond };
    expect(smokeLevel({ ...spinning, throttle: 0.9 })).toBe(1);
    expect(smokeLevel({ ...spinning, throttle: 0.2 })).toBe(0);
  });

  it('never exceeds 1 and maps bad numbers to zero', () => {
    expect(smokeLevel({ ...cruising, lateralSpeedMetersPerSecond: 500, throttle: 1, wheelSpinRadiansPerSecond: 900 })).toBe(1);
    expect(smokeLevel({ ...cruising, lateralSpeedMetersPerSecond: Number.NaN })).toBe(0);
  });
});

describe('emitCountFor', () => {
  it('emits at the configured rate for the frame time, and nothing at level zero', () => {
    expect(emitCountFor(1, 0.5)).toBeCloseTo(SMOKE_RULES.maxEmitPerSecond * 0.5, 9);
    expect(emitCountFor(0, 1)).toBe(0);
  });

  it('clamps the level and ignores a negative frame time', () => {
    expect(emitCountFor(5, 1)).toBe(emitCountFor(1, 1));
    expect(emitCountFor(1, -1)).toBe(0);
  });
});

describe('SmokePool', () => {
  it('returns no slot when empty, so a zero budget emits nothing', () => {
    const pool = new SmokePool(0);
    expect(pool.capacity).toBe(0);
    expect(pool.spawn(1)).toBe(-1);
  });

  it('reuses slots in a ring, so the count never grows past the capacity', () => {
    const pool = new SmokePool(3);
    expect([pool.spawn(10), pool.spawn(10), pool.spawn(10), pool.spawn(10)]).toEqual([0, 1, 2, 0]);
  });

  it('reports the live age fraction, and -1 once a particle has expired', () => {
    const pool = new SmokePool(2);
    const slot = pool.spawn(2);
    expect(pool.lifeFraction(slot)).toBe(0);
    pool.step(1);
    expect(pool.lifeFraction(slot)).toBeCloseTo(0.5, 6);
    pool.step(1.5);
    expect(pool.lifeFraction(slot)).toBe(-1);
  });

  it('frees every particle after its lifetime, with no leftover live slots', () => {
    const pool = new SmokePool(4);
    for (let i = 0; i < 4; i += 1) pool.spawn(SMOKE_RULES.lifetimeSeconds);
    pool.step(SMOKE_RULES.lifetimeSeconds + 0.01);
    for (let i = 0; i < 4; i += 1) expect(pool.lifeFraction(i)).toBe(-1);
  });
});
