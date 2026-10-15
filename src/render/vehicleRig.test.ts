import { Group, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { BodyState, VehicleState } from '../core/types';
import { createVehicleState } from '../simulation/vehicle';
import { applyVehicleRig, resolveVehicleRig } from './vehicleRig';

/** Wheel suffixes, matching the names produced by the visual layer. */
const VEHICLE_RIG_FIXTURE_NAMES = ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'] as const;

const REST_BODY: BodyState = { pitch: 0, pitchRate: 0, roll: 0, rollRate: 0, heave: 0, heaveRate: 0 };

function poseWith(partial: Partial<VehicleState>): VehicleState {
  return { ...createVehicleState({ x: 0, y: 0, z: 0 }, 0), ...partial };
}

function buildRig() {
  const root = new Group();
  root.name = 'PlayerVehicle';
  const pivot = new Object3D();
  pivot.name = 'BodyPivot';
  pivot.position.set(0, VEHICLE_CONFIG.wheelRadiusMeters, VEHICLE_CONFIG.wheelbaseMeters / 2);
  root.add(pivot);
  for (const name of VEHICLE_RIG_FIXTURE_NAMES) {
    const steer = new Group();
    steer.name = `WheelSteer${name}`;
    steer.userData = { steered: name.startsWith('Front') };
    const spin = new Group();
    spin.name = `WheelSpin${name}`;
    steer.add(spin);
    root.add(steer);
  }
  return root;
}

const frontRight = (root: Group): Object3D => root.getObjectByName('WheelSteerFrontRight') as Object3D;
const rearRight = (root: Group): Object3D => root.getObjectByName('WheelSteerRearRight') as Object3D;
const spinOf = (root: Group, suffix: string): Object3D => root.getObjectByName(`WheelSpin${suffix}`) as Object3D;

describe('vehicle rig resolution', () => {
  it('resolves the body pivot and every wheel once, with the steered flag read from userData', () => {
    const rig = resolveVehicleRig(buildRig());
    expect(rig).not.toBeNull();
    expect(rig?.wheels).toHaveLength(4);
    expect(rig?.wheels.filter((w) => w.steered)).toHaveLength(2);
  });

  it('returns null when the pivot is missing', () => {
    expect(resolveVehicleRig(new Group())).toBeNull();
  });
});

describe('vehicle rig application', () => {
  it('steers only the front wheels, using the actual steer angle', () => {
    const root = buildRig();
    const rig = resolveVehicleRig(root);
    if (!rig) throw new Error('rig');
    applyVehicleRig(rig, poseWith({ steerAngle: 0.3 }), REST_BODY);
    expect(frontRight(root).rotation.y).toBeCloseTo(0.3, 9);
    expect(rearRight(root).rotation.y).toBe(0);
  });

  it('rolls the wheels forward for positive spin: the tread top moves toward the nose', () => {
    const root = buildRig();
    const rig = resolveVehicleRig(root);
    if (!rig) throw new Error('rig');
    applyVehicleRig(rig, poseWith({ wheelSpin: 0.4 }), REST_BODY);
    const top = new Vector3(0, 1, 0).applyAxisAngle(new Vector3(1, 0, 0), spinOf(root, 'FrontRight').rotation.x);
    expect(top.z).toBeGreaterThan(0);
  });

  it('steers a front wheel right for a positive steer angle', () => {
    const root = buildRig();
    const rig = resolveVehicleRig(root);
    if (!rig) throw new Error('rig');
    applyVehicleRig(rig, poseWith({ steerAngle: 0.25 }), REST_BODY);
    const nose = new Vector3(0, 0, 1).applyAxisAngle(new Vector3(0, 1, 0), frontRight(root).rotation.y);
    expect(nose.x).toBeGreaterThan(0);
  });

  it('pitches the nose down (positive pitch) and lifts the right side (positive roll)', () => {
    const root = buildRig();
    const rig = resolveVehicleRig(root);
    if (!rig) throw new Error('rig');
    applyVehicleRig(rig, poseWith({}), { ...REST_BODY, pitch: 0.02, roll: 0.02 });
    const nose = new Vector3(0, 0, 1).applyAxisAngle(new Vector3(1, 0, 0), rig.bodyPivot.rotation.x);
    expect(nose.y).toBeLessThan(0);
    const rightSide = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 0, 1), rig.bodyPivot.rotation.z);
    expect(rightSide.y).toBeGreaterThan(0);
  });

  it('keeps body and suspension effects off the root transform', () => {
    const root = buildRig();
    const rig = resolveVehicleRig(root);
    if (!rig) throw new Error('rig');
    applyVehicleRig(rig, poseWith({ position: { x: 3, y: 0, z: 9 }, yaw: 0.7 }), { ...REST_BODY, pitch: 0.03, roll: 0.03, heave: 0.01 });
    expect(root.rotation.x).toBe(0);
    expect(root.rotation.z).toBe(0);
    expect(root.rotation.y).toBeCloseTo(0.7, 9);
    expect(root.position.z).toBeCloseTo(9, 9);
    expect(rig.bodyPivot.position.y).toBeCloseTo(rig.pivotRestY + 0.01, 9);
  });

  it('writes absolute values, so repeated frames do not accumulate rotation error', () => {
    const root = buildRig();
    const rig = resolveVehicleRig(root);
    if (!rig) throw new Error('rig');
    const pose = poseWith({ steerAngle: 0.2, wheelSpin: 1.1, yaw: 0.4 });
    const body = { ...REST_BODY, pitch: 0.01, roll: -0.02, heave: 0.005 };
    applyVehicleRig(rig, pose, body);
    const first = [root.rotation.y, rig.bodyPivot.rotation.x, frontRight(root).rotation.y, spinOf(root, 'FrontRight').rotation.x];
    for (let i = 0; i < 1000; i += 1) applyVehicleRig(rig, pose, body);
    const after = [root.rotation.y, rig.bodyPivot.rotation.x, frontRight(root).rotation.y, spinOf(root, 'FrontRight').rotation.x];
    expect(after).toEqual(first);
  });
});
