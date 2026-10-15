export const TWO_PI = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Moves `current` toward `target` by at most `maxDelta`, never overshooting. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** Wraps an angle into the range [-PI, PI). */
export function wrapAngle(angle: number): number {
  return ((((angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
}

/** Signed difference `to - from`, wrapped to [-PI, PI). */
export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/**
 * Frame-rate independent exponential smoothing.
 * `lambdaPerSecond` is the convergence rate: larger values track the target more tightly.
 */
export function damp(current: number, target: number, lambdaPerSecond: number, dtSeconds: number): number {
  return lerp(current, target, 1 - Math.exp(-lambdaPerSecond * dtSeconds));
}
