import { describe, expect, it } from 'vitest';
import { CHASE_CAMERA_CONFIG } from '../config/cameraConfig';
import type { VehicleState } from '../core/types';
import { computeChaseGoals, createChaseCameraState, updateChaseCamera } from './chaseCamera';

function poseAt(yaw: number, x = 0, z = 0): VehicleState {
  return {
    position: { x, y: 0, z },
    yaw,
    speed: 0,
    steerAngle: 0,
    yawRate: 0,
  };
}

describe('computeChaseGoals', () => {
  it('sits behind the vehicle and looks ahead when facing +Z', () => {
    const goals = computeChaseGoals(poseAt(0, 0, 50), CHASE_CAMERA_CONFIG);
    expect(goals.position.x).toBeCloseTo(0, 9);
    expect(goals.position.z).toBeCloseTo(50 - CHASE_CAMERA_CONFIG.distanceBehindMeters, 9);
    expect(goals.position.y).toBeCloseTo(CHASE_CAMERA_CONFIG.heightMeters, 9);
    expect(goals.target.z).toBeCloseTo(50 + CHASE_CAMERA_CONFIG.lookAheadMeters, 9);
  });

  it('follows the heading when the vehicle turns toward +X', () => {
    const goals = computeChaseGoals(poseAt(Math.PI / 2), CHASE_CAMERA_CONFIG);
    expect(goals.position.x).toBeCloseTo(-CHASE_CAMERA_CONFIG.distanceBehindMeters, 9);
    expect(goals.target.x).toBeCloseTo(CHASE_CAMERA_CONFIG.lookAheadMeters, 9);
  });
});

describe('updateChaseCamera', () => {
  it('snaps to the goal on the first update', () => {
    const state = createChaseCameraState();
    const pose = poseAt(0, 10, 10);
    updateChaseCamera(state, pose, CHASE_CAMERA_CONFIG, 1 / 60);
    const goals = computeChaseGoals(pose, CHASE_CAMERA_CONFIG);
    expect(state.position).toEqual(goals.position);
    expect(state.initialized).toBe(true);
  });

  it('moves toward a new goal gradually rather than instantly', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CHASE_CAMERA_CONFIG, 1 / 60);
    const before = state.position.z;
    updateChaseCamera(state, poseAt(0, 0, 100), CHASE_CAMERA_CONFIG, 1 / 60);
    const goalZ = 100 - CHASE_CAMERA_CONFIG.distanceBehindMeters;
    expect(state.position.z).toBeGreaterThan(before);
    expect(state.position.z).toBeLessThan(goalZ);
  });

  it('converges to the goal after enough time', () => {
    const state = createChaseCameraState();
    updateChaseCamera(state, poseAt(0), CHASE_CAMERA_CONFIG, 1 / 60);
    const pose = poseAt(0, 0, 100);
    for (let i = 0; i < 600; i += 1) updateChaseCamera(state, pose, CHASE_CAMERA_CONFIG, 1 / 60);
    expect(state.position.z).toBeCloseTo(100 - CHASE_CAMERA_CONFIG.distanceBehindMeters, 3);
  });
});
