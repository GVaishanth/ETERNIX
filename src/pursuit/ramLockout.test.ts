import { describe, expect, it } from 'vitest';
import { lockedDriveInput, startRamLockout, tickRamLockout } from './ramLockout';

describe('ram lockout', () => {
  it('starts at the configured time when there is no lockout running', () => {
    expect(startRamLockout(0, 1.5)).toBe(1.5);
  });

  it('keeps the longer of the time left and a fresh lockout, so a ram never shortens a lockout', () => {
    expect(startRamLockout(1.0, 1.5)).toBe(1.5);
    expect(startRamLockout(1.8, 1.5)).toBe(1.8);
  });

  it('counts down by the step and stops at zero', () => {
    expect(tickRamLockout(1.5, 0.1)).toBeCloseTo(1.4, 9);
    expect(tickRamLockout(0.05, 0.1)).toBe(0);
    expect(tickRamLockout(0, 0.1)).toBe(0);
  });

  it('locks the input to a full brake with no throttle and no steering', () => {
    expect(lockedDriveInput()).toEqual({ steer: 0, throttle: 0, brake: 1, handbrake: 0 });
  });

  it('expires after its time: the number of steps equals the lockout at the fixed step', () => {
    const step = 1 / 120;
    let remaining = startRamLockout(0, 1.5);
    let steps = 0;
    while (remaining > 0 && steps < 10000) {
      remaining = tickRamLockout(remaining, step);
      steps += 1;
    }
    expect(steps * step).toBeGreaterThanOrEqual(1.5 - step);
    expect(steps * step).toBeLessThanOrEqual(1.5 + step);
  });
});
