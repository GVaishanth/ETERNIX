import { describe, expect, it } from 'vitest';
import { createChaseCameraState, updateChaseCamera, type ChaseCameraState } from '../camera/chaseCamera';
import { CHASE_CAMERA_CONFIG } from '../config/cameraConfig';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { forwardFromYaw } from '../core/coordinates';
import type { Vec3, VehicleState } from '../core/types';
import { signedDistance } from '../simulation/roadBoundary';
import { circuitBoundary, driveLap } from '../world/circuitDriver';

/*
 * Chase camera over one full lap of the test circuit. The camera is driven by the same update function the render
 * loop uses, once per fixed step. These checks cover the camera's behaviour, not the road's shape: the camera
 * must follow heading, never snap, never face backward, and keep the road ahead in view.
 */

interface CameraSample {
  car: VehicleState;
  cameraPosition: Vec3;
  target: Vec3;
  cameraYaw: number;
  fovDegrees: number;
}

const samples: CameraSample[] = [];
const chase: ChaseCameraState = createChaseCameraState();

const lap = driveLap({
  onStep: ({ state }) => {
    updateChaseCamera(chase, state, CHASE_CAMERA_CONFIG, VEHICLE_CONFIG.maxForwardSpeedMps, FIXED_STEP_SECONDS);
    samples.push({
      car: state,
      cameraPosition: { ...chase.position },
      target: { ...chase.target },
      cameraYaw: chase.headingYaw,
      fovDegrees: chase.fovDegrees,
    });
  },
});

function shortestDegrees(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * (180 / Math.PI);
}

describe('chase camera over a full circuit lap', () => {
  it('completes the lap with samples for every step', () => {
    expect(lap.finished).toBe(true);
    expect(samples.length).toBeGreaterThan(1000);
  });

  it('keeps the car in front of the camera on every step (camera stays behind)', () => {
    let worst = Infinity;
    for (const s of samples.slice(1)) {
      const f = forwardFromYaw(s.cameraYaw);
      const ahead = (s.car.position.x - s.cameraPosition.x) * f.x + (s.car.position.z - s.cameraPosition.z) * f.z;
      worst = Math.min(worst, ahead);
    }
    expect(worst).toBeGreaterThan(3);
  });

  it('keeps the camera distance from the car within the configured bounds', () => {
    const maxDistance = CHASE_CAMERA_CONFIG.distanceBehindMeters + CHASE_CAMERA_CONFIG.maxSpeedDistanceMeters + CHASE_CAMERA_CONFIG.maxAccelDistanceMeters + 1;
    for (const s of samples.slice(1)) {
      const d = Math.hypot(s.car.position.x - s.cameraPosition.x, s.car.position.z - s.cameraPosition.z);
      expect(d).toBeGreaterThan(5);
      expect(d).toBeLessThan(maxDistance);
    }
  });

  it('never drops the camera to the ground (height stays well above zero)', () => {
    const lowest = Math.min(...samples.map((s) => s.cameraPosition.y));
    expect(lowest).toBeGreaterThan(1.5);
  });

  it('never snaps: the camera moves less than 0.5 m per fixed step', () => {
    let worst = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1]?.cameraPosition;
      const b = samples[i]?.cameraPosition;
      if (!a || !b) continue;
      worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('follows the heading: the lagged camera yaw stays within 10 degrees of the car yaw', () => {
    let worst = 0;
    for (const s of samples.slice(1)) worst = Math.max(worst, shortestDegrees(s.car.yaw, s.cameraYaw));
    expect(worst).toBeLessThan(10);
  });

  it('never faces backward: the look-at point is ahead of the car on every step', () => {
    for (const s of samples.slice(1)) {
      const f = forwardFromYaw(s.car.yaw);
      const ahead = (s.target.x - s.car.position.x) * f.x + (s.target.z - s.car.position.z) * f.z;
      expect(ahead).toBeGreaterThan(0);
    }
  });

  it('keeps the road ahead in view: the look-at point is on the drivable road for most of the lap', () => {
    let onRoad = 0;
    for (const s of samples.slice(1)) {
      if (signedDistance(circuitBoundary, s.target.x, s.target.z).distance <= 0) onRoad += 1;
    }
    expect(onRoad / (samples.length - 1)).toBeGreaterThan(0.95);
  });

  it('changes the field of view smoothly and stays within its configured range', () => {
    let worstStep = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1]?.fovDegrees ?? 0;
      const b = samples[i]?.fovDegrees ?? 0;
      worstStep = Math.max(worstStep, Math.abs(b - a));
      expect(b).toBeGreaterThanOrEqual(CHASE_CAMERA_CONFIG.fovBaseDegrees - 0.01);
      expect(b).toBeLessThanOrEqual(CHASE_CAMERA_CONFIG.fovMaxDegrees + 0.01);
    }
    expect(worstStep).toBeLessThan(0.5);
  });
});
