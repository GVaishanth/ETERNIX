import { Group, Object3D, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { computeChaseGoals } from '../camera/chaseCamera';
import { CHASE_CAMERA_CONFIG } from '../config/cameraConfig';
import { forwardFromYaw, rightFromYaw, toRenderSpace } from '../core/coordinates';
import type { VehicleState } from '../core/types';
import { renderBoundsFromSim, setRenderVector } from './renderSpace';

/*
 * These tests run the REAL Three.js math to prove the mirror convention. If any of them fail,
 * steering and on-screen directions disagree, which is the bug the convention exists to prevent.
 */

const yaws = [0, 0.5, Math.PI / 2, 2.4, -1.1];

const poseAt = (yaw: number): VehicleState => ({
  position: { x: 10, y: 0, z: -20 },
  yaw,
  speed: 20,
  steerAngle: 0,
  yawRate: 0,
  lateralSpeed: 0,
  throttlePedal: 0,
  brakePedal: 0,
  handbrakeLevel: 0,
  longitudinalAccel: 0,
  lateralAccel: 0,
  wheelSpin: 0,
});

function buildChaseCamera(pose: VehicleState): PerspectiveCamera {
  const goals = computeChaseGoals(pose, pose.yaw, 0, 0, CHASE_CAMERA_CONFIG);
  const camera = new PerspectiveCamera(CHASE_CAMERA_CONFIG.fovBaseDegrees, 1, 0.1, 3000);
  setRenderVector(camera.position, goals.position);
  camera.lookAt(setRenderVector(new Vector3(), goals.target));
  camera.updateMatrixWorld();
  return camera;
}

describe('render-space mirror', () => {
  it.each(yaws)('a simulation-right direction appears to the right of the chase camera (yaw %s)', (yaw) => {
    const camera = buildChaseCamera(poseAt(yaw));
    const screenRight = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const expected = setRenderVector(new Vector3(), rightFromYaw(yaw));
    expect(screenRight.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it.each(yaws)('a point to the vehicle right projects to positive screen X (yaw %s)', (yaw) => {
    const pose = poseAt(yaw);
    const camera = buildChaseCamera(pose);
    const right = rightFromYaw(yaw);
    const rightPoint = {
      x: pose.position.x + right.x * 3,
      y: 0.5,
      z: pose.position.z + right.z * 3,
    };
    const ndc = setRenderVector(new Vector3(), rightPoint).project(camera);
    expect(ndc.x).toBeGreaterThan(0);
  });

  it('a point ahead of the vehicle projects toward the screen center', () => {
    const pose = poseAt(0.8);
    const camera = buildChaseCamera(pose);
    const forward = forwardFromYaw(pose.yaw);
    const ahead = { x: pose.position.x + forward.x * 40, y: 0.5, z: pose.position.z + forward.z * 40 };
    const ndc = setRenderVector(new Vector3(), ahead).project(camera);
    expect(Math.abs(ndc.x)).toBeLessThan(0.2);
    expect(ndc.z).toBeLessThan(1);
  });
});

describe('SimRoot mirror group', () => {
  // Mirrors the scene graph in RenderLayer: a Group with scale (1, 1, -1) containing a vehicle
  // whose rotation.y is the simulation yaw.
  function buildSimRoot(yaw: number, origin: { x: number; y: number; z: number }) {
    const root = new Group();
    root.scale.set(1, 1, -1);
    const vehicle = new Object3D();
    vehicle.position.set(origin.x, origin.y, origin.z);
    vehicle.rotation.set(0, yaw, 0);
    root.add(vehicle);
    root.updateMatrixWorld(true);
    return { root, vehicle };
  }

  it.each(yaws)('the vehicle nose lands where the simulation forward maps to (yaw %s)', (yaw) => {
    const { vehicle } = buildSimRoot(yaw, { x: 3, y: 0, z: 7 });
    const nose = new Vector3(0, 0, 1).applyMatrix4(vehicle.matrixWorld);
    const expected = setRenderVector(new Vector3(), { x: 3, y: 0, z: 7 });
    const forward = forwardFromYaw(yaw);
    const expectedNose = expected.add(setRenderVector(new Vector3(), forward));
    expect(nose.distanceTo(expectedNose)).toBeLessThan(1e-6);
  });

  it('the vehicle right side lands where the simulation right maps to', () => {
    const yaw = 1.2;
    const { vehicle } = buildSimRoot(yaw, { x: 0, y: 0, z: 0 });
    const rightSide = new Vector3(1, 0, 0).applyMatrix4(vehicle.matrixWorld);
    expect(rightSide.distanceTo(setRenderVector(new Vector3(), rightFromYaw(yaw)))).toBeLessThan(1e-6);
  });
});

describe('render bounds conversion', () => {
  it('flips Z so min and max stay ordered', () => {
    const box = renderBoundsFromSim({ min: { x: -5, y: 0, z: -100 }, max: { x: 5, y: 0, z: 400 } });
    expect(box.min.z).toBe(-400);
    expect(box.max.z).toBe(100);
    expect(box.min.x).toBe(-5);
    expect(box.max.x).toBe(5);
  });

  it('keeps single points consistent with toRenderSpace', () => {
    const point = { x: 1, y: 2, z: 3 };
    const converted = toRenderSpace(point);
    const box = renderBoundsFromSim({ min: point, max: point });
    expect(box.min.z).toBe(converted.z);
    expect(box.max.z).toBe(converted.z);
  });
});
