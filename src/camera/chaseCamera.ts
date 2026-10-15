import type { ChaseCameraConfig } from '../config/cameraConfig';
import { forwardFromYaw } from '../core/coordinates';
import { damp } from '../core/math';
import type { Vec3, VehicleState } from '../core/types';

/*
 * Chase camera math, in SIMULATION space. The render layer converts the result with
 * toRenderSpace() before applying it to the Three.js camera.
 * The camera sits behind the rear axle along the forward axis and looks ahead of it.
 * The camera never reads its own orientation to decide steering or motion. It only follows the vehicle.
 */

export interface ChaseCameraState {
  initialized: boolean;
  position: Vec3;
  target: Vec3;
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
  };
}

/** Camera distance behind the rear axle: a base distance plus a speed-based pull-back, capped. */
export function computeChaseDistance(speed: number, config: ChaseCameraConfig): number {
  const pullBack = Math.min(Math.abs(speed) * config.distancePerSpeedMeters, config.maxSpeedDistanceMeters);
  return config.distanceBehindMeters + pullBack;
}

/** Ideal camera position and look-at point for the given vehicle pose. No smoothing. */
export function computeChaseGoals(pose: VehicleState, config: ChaseCameraConfig): ChaseCameraGoals {
  const forward = forwardFromYaw(pose.yaw);
  const base = pose.position;
  const distance = computeChaseDistance(pose.speed, config);
  return {
    position: {
      x: base.x - forward.x * distance,
      y: base.y + config.heightMeters,
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
 * Moves the camera toward its goals using frame-rate-independent damping.
 * The first call, or any call after `state.initialized` is cleared (for example, on vehicle reset),
 * snaps to the goals so the camera does not sweep in from a stale position.
 * A zero dt leaves the camera where it is, which is how pause freezes it.
 */
export function updateChaseCamera(
  state: ChaseCameraState,
  pose: VehicleState,
  config: ChaseCameraConfig,
  dtSeconds: number,
): void {
  const goals = computeChaseGoals(pose, config);
  if (!state.initialized) {
    state.position = { ...goals.position };
    state.target = { ...goals.target };
    state.initialized = true;
    return;
  }
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
