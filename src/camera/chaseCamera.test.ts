import { describe, expect, it } from 'vitest';
import { CHASE_CAMERA_CONFIG } from '../config/cameraConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { forwardFromYaw } from '../core/coordinates';
import type { VehicleState } from '../core/types';
import {
  computeChaseDistance,
  computeChaseFov,
  computeChaseGoals,
  computeShakeOffset,
  createChaseCameraState,
  speedFraction,
  updateChaseCamera,
} from './chaseCamera';

const DT = 1 / 60;
const TOP = VEHICLE_CONFIG.maxForwardSpeedMps;
const CFG = CHASE_CAMERA_CONFIG;

function poseAt(yaw: number, x = 0, z = 0, speed = 0, longitudinalAccel = 0): VehicleState {
  return {
    position: { x, y: 0, z },
    yaw,
    speed,
    lateralSpeed: 0,
    steerAngle: 0,
    yawRate: 0,
    throttlePedal: 0,
    brakePedal: 0,
    handbrakeLevel: 0,
    longitudinalAccel,
    lateralAccel: 0,
    wheelSpin: 0,
  };
}

describe('computeChaseGoals', () => {
  it('sits behind the vehicle and looks ahead when facing +Z', () => {
    const goals = computeChaseGoals(poseAt(0, 0, 50), 0, 0, 0, CFG);
    expect(goals.position.x).toBeCloseTo(0, 9);
    expect(goals.position.z).toBeCloseTo(50 - CFG.distanceBehindMeters, 9);
    expect(goals.position.y).toBeCloseTo(CFG.heightMeters, 9);
    expect(goals.target.z).toBeCloseTo(50 + CFG.lookAheadMeters, 9);
  });

  it('follows the camera heading when the vehicle turns toward +X', () => {
    const goals = computeChaseGoals(poseAt(Math.PI / 2), Math.PI / 2, 0, 0, CFG);
    expect(goals.position.x).toBeCloseTo(-CFG.distanceBehindMeters, 9);
    expect(goals.target.x).toBeCloseTo(CFG.lookAheadMeters, 9);
  });

  it('applies shake to height only, not to the look-at point', () => {
    const base = computeChaseGoals(poseAt(0), 0, 0, 0, CFG);
    const shaken = computeChaseGoals(poseAt(0), 0, 0, 0.02, CFG);
    expect(shaken.position.y - base.position.y).toBeCloseTo(0.02, 9);
    expect(shaken.target).toEqual(base.target);
  });
});

describe('updateChaseCamera', () => {
  it('snaps to the goal on the first update', () => {
    const state = createChaseCameraState();
    const pose = poseAt(0, 10, 10);
    updateChaseCamera(state, pose, CFG, TOP, DT);
    const goals = computeChaseGoals(pose, 0, 0, 0, CFG);
    expect(state.position).toEqual(goals.position);
    expect(state.initialized).toBe(true);
  });

  it('moves toward a new goal gradually rather than instantly', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CFG, TOP, DT);
    const before = state.position.z;
    updateChaseCamera(state, poseAt(0, 0, 100), CFG, TOP, DT);
    const goalZ = 100 - CFG.distanceBehindMeters;
    expect(state.position.z).toBeGreaterThan(before);
    expect(state.position.z).toBeLessThan(goalZ);
  });

  it('converges to the goal after enough time', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CFG, TOP, DT);
    const pose = poseAt(0, 0, 100);
    for (let i = 0; i < 600; i += 1) updateChaseCamera(state, pose, CFG, TOP, DT);
    expect(state.position.z).toBeCloseTo(100 - CFG.distanceBehindMeters, 3);
  });

  it('freezes exactly when dt is zero (pause)', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CFG, TOP, DT);
    const before = JSON.stringify(state);
    for (let i = 0; i < 60; i += 1) updateChaseCamera(state, poseAt(1.2, 40, 40, 30, 6), CFG, TOP, 0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('snaps again after a reset clears initialized', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CFG, TOP, DT);
    state.initialized = false;
    const resetPose = poseAt(0, 2, 0);
    updateChaseCamera(state, resetPose, CFG, TOP, DT);
    expect(state.position).toEqual(computeChaseGoals(resetPose, 0, 0, 0, CFG).position);
    expect(state.headingYaw).toBe(0);
  });
});

describe('camera heading lag', () => {
  it('lags behind a sudden heading change instead of snapping to it', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CFG, TOP, DT);
    updateChaseCamera(state, poseAt(0.5), CFG, TOP, DT);
    expect(state.headingYaw).toBeGreaterThan(0);
    expect(state.headingYaw).toBeLessThan(0.5);
  });

  it('converges on the vehicle heading', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CFG, TOP, DT);
    for (let i = 0; i < 60 * 3; i += 1) updateChaseCamera(state, poseAt(0.5), CFG, TOP, DT);
    expect(state.headingYaw).toBeCloseTo(0.5, 3);
  });

  it('follows across the ±PI seam by the short way round', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(Math.PI - 0.02), CFG, TOP, DT);
    updateChaseCamera(state, poseAt(-Math.PI + 0.02), CFG, TOP, DT);
    expect(Math.abs(Math.abs(state.headingYaw) - Math.PI)).toBeLessThan(0.05);
  });

  it('keeps the car in front of the camera through a sustained turn', () => {
    const state = createChaseCameraState();
    let pose = poseAt(0, 0, 0, 20);
    updateChaseCamera(state, pose, CFG, TOP, DT);
    for (let i = 0; i < 60 * 8; i += 1) {
      const yaw = Math.sin(i / 60) * 1.2;
      pose = { ...poseAt(yaw, 0, 0, 20), position: { x: pose.position.x + Math.sin(yaw) * 0.3, y: 0, z: pose.position.z + Math.cos(yaw) * 0.3 } };
      updateChaseCamera(state, pose, CFG, TOP, DT);
      const forward = forwardFromYaw(state.headingYaw);
      const ahead = (pose.position.x - state.position.x) * forward.x + (pose.position.z - state.position.z) * forward.z;
      expect(ahead).toBeGreaterThan(CFG.distanceBehindMeters - CFG.maxAccelDistanceMeters - 0.5);
    }
  });
});

describe('speed-dependent camera distance', () => {
  it('stays at the base distance when stopped', () => {
    expect(computeChaseDistance(0, 0, CFG)).toBe(CFG.distanceBehindMeters);
  });

  it('pulls back as speed rises, and caps the pull-back', () => {
    const slow = computeChaseDistance(10, 0, CFG);
    const fast = computeChaseDistance(30, 0, CFG);
    expect(fast).toBeGreaterThan(slow);
    const absurd = computeChaseDistance(1000, 0, CFG);
    expect(absurd).toBeCloseTo(CFG.distanceBehindMeters + CFG.maxSpeedDistanceMeters, 9);
  });

  it('keeps the same speed distance for reverse as for forward of equal magnitude', () => {
    expect(computeChaseDistance(-12, 0, CFG)).toBeCloseTo(computeChaseDistance(12, 0, CFG), 9);
  });
});

describe('acceleration lag', () => {
  it('pulls the camera back under acceleration and in closer under braking', () => {
    const base = computeChaseDistance(20, 0, CFG);
    expect(computeChaseDistance(20, 5, CFG)).toBeGreaterThan(base);
    expect(computeChaseDistance(20, -5, CFG)).toBeLessThan(base);
  });

  it('caps the acceleration lag in either direction', () => {
    const huge = computeChaseDistance(20, 1000, CFG);
    const base = computeChaseDistance(20, 0, CFG);
    expect(huge - base).toBeCloseTo(CFG.maxAccelDistanceMeters, 9);
  });
});

describe('field of view and shake', () => {
  it('widens from the base FOV at standstill to the max FOV at top speed', () => {
    expect(computeChaseFov(0, CFG)).toBeCloseTo(CFG.fovBaseDegrees, 9);
    expect(computeChaseFov(1, CFG)).toBeCloseTo(CFG.fovMaxDegrees, 9);
    expect(computeChaseFov(0.5, CFG)).toBeGreaterThan(CFG.fovBaseDegrees);
  });

  it('eases the FOV toward its target instead of jumping', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CFG, TOP, DT);
    updateChaseCamera(state, poseAt(0, 0, 0, TOP), CFG, TOP, DT);
    expect(state.fovDegrees).toBeGreaterThan(CFG.fovBaseDegrees);
    expect(state.fovDegrees).toBeLessThan(CFG.fovMaxDegrees);
  });

  it('shakes only above the start fraction, and stays within the configured amplitude', () => {
    expect(computeShakeOffset(0.3, 1.234, CFG)).toBe(0);
    for (let i = 0; i < 300; i += 1) {
      const offset = computeShakeOffset(1, i / 60, CFG);
      expect(Math.abs(offset)).toBeLessThanOrEqual(CFG.shakeMaxMeters + 1e-12);
    }
  });

  it('maps speed to a 0..1 fraction with the magnitude of speed', () => {
    expect(speedFraction(-31, 62)).toBeCloseTo(0.5, 9);
    expect(speedFraction(999, 62)).toBe(1);
  });
});
