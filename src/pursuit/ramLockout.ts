import type { InputState } from '../core/types';

/**
 * The ram lockout (Part 7). A pursuing unit that touches the player locks the player's driving input for a short time,
 * and the car brakes to a stop. Pure: the controller holds the timer and the simulation applies the input.
 */

/** The lockout after a ram: the longer of the time left and a fresh lockout. Seconds. */
export function startRamLockout(remainingSeconds: number, lockoutSeconds: number): number {
  return Math.max(remainingSeconds, lockoutSeconds);
}

/** The lockout time left after one fixed step, never below zero. */
export function tickRamLockout(remainingSeconds: number, dtSeconds: number): number {
  return Math.max(0, remainingSeconds - dtSeconds);
}

/** The input while locked: no throttle, no steering, full brake. The car slows to a stop. */
export function lockedDriveInput(): InputState {
  return { steer: 0, throttle: 0, brake: 1, handbrake: 0 };
}
