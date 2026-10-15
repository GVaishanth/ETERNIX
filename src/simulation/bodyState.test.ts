import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { VehicleState } from '../core/types';
import { createBodyState, stepBody } from './bodyState';
import { createVehicleState } from './vehicle';

const DT = 1 / 60;

function withAccel(longitudinalAccel: number, lateralAccel = 0): VehicleState {
  return { ...createVehicleState({ x: 0, y: 0, z: 0 }, 0), longitudinalAccel, lateralAccel };
}

function settle(accel: number, lateral: number, seconds: number) {
  let body = createBodyState();
  const vehicle = withAccel(accel, lateral);
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    body = stepBody(body, vehicle, VEHICLE_CONFIG, DT);
  }
  return body;
}

describe('cosmetic body response', () => {
  it('starts level and stays level when the car is not accelerating', () => {
    const body = settle(0, 0, 3);
    expect(body.pitch).toBeCloseTo(0, 9);
    expect(body.roll).toBeCloseTo(0, 9);
    expect(body.heave).toBeCloseTo(0, 9);
  });

  it('dives the nose (positive pitch) under braking', () => {
    const body = settle(-8, 0, 2);
    expect(body.pitch).toBeGreaterThan(0);
  });

  it('lifts the nose (negative pitch) under acceleration', () => {
    const body = settle(6, 0, 2);
    expect(body.pitch).toBeLessThan(0);
  });

  it('rolls the right side up (positive roll) under a right turn', () => {
    const body = settle(0, 8, 2);
    expect(body.roll).toBeGreaterThan(0);
  });

  it('settles back to level after the forces stop', () => {
    let body = settle(-10, 10, 2);
    const vehicle = withAccel(0, 0);
    for (let i = 0; i < 60 * 4; i += 1) {
      body = stepBody(body, vehicle, VEHICLE_CONFIG, DT);
    }
    expect(Math.abs(body.pitch)).toBeLessThan(1e-4);
    expect(Math.abs(body.roll)).toBeLessThan(1e-4);
    expect(Math.abs(body.heave)).toBeLessThan(1e-4);
  });

  it('never exceeds the configured limits, even with extreme accelerations', () => {
    const body = settle(-200, 200, 2);
    expect(Math.abs(body.pitch)).toBeLessThanOrEqual(VEHICLE_CONFIG.maxBodyPitchRadians + 1e-12);
    expect(Math.abs(body.roll)).toBeLessThanOrEqual(VEHICLE_CONFIG.maxBodyRollRadians + 1e-12);
    expect(Math.abs(body.heave)).toBeLessThanOrEqual(VEHICLE_CONFIG.maxBodyHeaveMeters + 1e-12);
  });

  it('is deterministic for identical inputs', () => {
    expect(settle(-5, 4, 1)).toEqual(settle(-5, 4, 1));
  });

  it('does not change with a zero timestep', () => {
    const start = { ...createBodyState(), pitch: 0.01 };
    expect(stepBody(start, withAccel(-5), VEHICLE_CONFIG, 0)).toBe(start);
  });
});
