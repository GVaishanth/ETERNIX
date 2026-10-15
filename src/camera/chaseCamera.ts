import type { ChaseCameraConfig } from '../config/cameraConfig';
import { forwardFromYaw } from '../core/coordinates';
import { clamp, damp, lerp, shortestAngleDelta, wrapAngle } from '../core/math';
import type { Vec3, VehicleState } from '../core/types';

/*
 * Chase camera math, in SIMULATION space. The render layer converts results with toRenderSpace()
 * and applies the FOV to the Three.js camera.
 *
 * Contract:
 *   - The camera sits behind the rear axle along its own heading, and looks ahead along it. The heading
 *     lags the vehicle heading with a damped, shortest-arc follow, so the car stays in front of the camera.
 *   - The camera never reads steering input, and never reads its own orientation to decide motion.
 *   - It never rolls. Its only rotation is the look-at direction (yaw follows the lagged heading).
 *   - Every smoothing step is delta-time corrected. A zero dt (pause) freezes the camera exactly.
 *   - Shake and FOV respond to speed only. The acceleration lag moves the camera along its own axis, so it
 *     cannot push the camera sideways.
 */

export interface ChaseCameraState {
  initialized: boolean;
  position: Vec3;
  target: Vec3;
  /** Lagged camera heading, radians. Follows vehicle yaw along the shortest arc. */
  headingYaw: number;
  /** Smoothed longitudinal acceleration, m/s^2. Drives the acceleration distance lag. */
  accelLag: number;
  /** Smoothed field of view, degrees. */
  fovDegrees: number;
  /** Simulated camera time, seconds. Advances with dt only, so pause freezes it. Drives shake. */
  timeSeconds: number;
}

export interface ChaseCameraGoals {
  position: Vec3;
  target: Vec3;
}

export function createChaseCameraState(): ChaseCameraState {
  return {
    initialized: false,
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    headingYaw: 0,
    accelLag: 0,
    fovDegrees: 0,
    timeSeconds: 0,
  };
}

/** Speed fraction in 0..1 of the top speed. Used for FOV and shake. */
export function speedFraction(speed: number, maxSpeedMps: number): number {
  return clamp(Math.abs(speed) / maxSpeedMps, 0, 1);
}

/** Camera distance behind the rear axle: base distance, speed pull-back (capped), and acceleration lag (capped). */
export function computeChaseDistance(speed: number, accelLag: number, config: ChaseCameraConfig): number {
  const speedPullBack = Math.min(Math.abs(speed) * config.distancePerSpeedMeters, config.maxSpeedDistanceMeters);
  const accelPullBack = clamp(accelLag * config.distancePerAccelMeters, -config.maxAccelDistanceMeters, config.maxAccelDistanceMeters);
  return config.distanceBehindMeters + speedPullBack + accelPullBack;
}

/** Field of view for the given speed fraction (0 at standstill, 1 at top speed). Linear, no smoothing. */
export function computeChaseFov(speedRatio: number, config: ChaseCameraConfig): number {
  return lerp(config.fovBaseDegrees, config.fovMaxDegrees, clamp(speedRatio, 0, 1));
}

/**
 * Deterministic speed shake, vertical only. Zero below the start fraction, then grows to shakeMaxMeters at top
 * speed. The combined sines stay within [-shakeMaxMeters, shakeMaxMeters].
 */
export function computeShakeOffset(speedRatio: number, timeSeconds: number, config: ChaseCameraConfig): number {
  const amount = clamp((speedRatio - config.shakeStartFraction) / (1 - config.shakeStartFraction), 0, 1);
  if (amount === 0) return 0;
  const w = 2 * Math.PI * config.shakeFrequencyHz;
  const wave = (Math.sin(w * timeSeconds) + 0.6 * Math.sin(1.7 * w * timeSeconds + 1)) / 1.6;
  return amount * config.shakeMaxMeters * wave;
}

/**
 * Ideal camera position and look-at point for the given pose and smoothed camera state. No smoothing.
 * `cameraYaw` is the lagged heading. The look-at point sits ahead of the rear axle along that heading.
 */
export function computeChaseGoals(
  pose: VehicleState,
  cameraYaw: number,
  accelLag: number,
  shakeOffset: number,
  config: ChaseCameraConfig,
): ChaseCameraGoals {
  const forward = forwardFromYaw(cameraYaw);
  const base = pose.position;
  const distance = computeChaseDistance(pose.speed, accelLag, config);
  return {
    position: {
      x: base.x - forward.x * distance,
      y: base.y + config.heightMeters + shakeOffset,
      z: base.z - forward.z * distance,
    },
    target: {
      x: base.x + forward.x * config.lookAheadMeters,
      y: base.y + config.lookHeightMeters,
      z: base.z + forward.z * config.lookAheadMeters,
    },
  };
}

/**
 * Advances the camera. The first call, or any call after `state.initialized` is cleared (vehicle reset), snaps to
 * the goals so the camera never sweeps in from a stale pose. A zero dt leaves every value where it is.
 * `maxSpeedMps` is the vehicle's top speed, used to normalise speed for FOV and shake.
 */
export function updateChaseCamera(
  state: ChaseCameraState,
  pose: VehicleState,
  config: ChaseCameraConfig,
  maxSpeedMps: number,
  dtSeconds: number,
): void {
  const ratio = speedFraction(pose.speed, maxSpeedMps);
  const fovGoal = computeChaseFov(ratio, config);

  if (!state.initialized) {
    state.headingYaw = wrapAngle(pose.yaw);
    state.accelLag = pose.longitudinalAccel;
    state.fovDegrees = fovGoal;
    state.timeSeconds = 0;
    const goals = computeChaseGoals(pose, state.headingYaw, 0, 0, config);
    state.position = { ...goals.position };
    state.target = { ...goals.target };
    state.initialized = true;
    return;
  }

  if (!(dtSeconds > 0)) return;

  state.timeSeconds += dtSeconds;
  state.headingYaw = wrapAngle(state.headingYaw + shortestAngleDelta(state.headingYaw, pose.yaw) * (1 - Math.exp(-config.headingDampingPerSecond * dtSeconds)));
  state.accelLag = damp(state.accelLag, pose.longitudinalAccel, config.accelDampingPerSecond, dtSeconds);
  state.fovDegrees = damp(state.fovDegrees, fovGoal, config.fovDampingPerSecond, dtSeconds);

  const shake = computeShakeOffset(ratio, state.timeSeconds, config);
  const goals = computeChaseGoals(pose, state.headingYaw, state.accelLag, shake, config);
  state.position = dampVec3(state.position, goals.position, config.positionDampingPerSecond, dtSeconds);
  state.target = dampVec3(state.target, goals.target, config.lookDampingPerSecond, dtSeconds);
}

function dampVec3(current: Vec3, goal: Vec3, lambda: number, dtSeconds: number): Vec3 {
  return {
    x: damp(current.x, goal.x, lambda, dtSeconds),
    y: damp(current.y, goal.y, lambda, dtSeconds),
    z: damp(current.z, goal.z, lambda, dtSeconds),
  };
}
