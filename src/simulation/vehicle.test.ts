import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState, VehicleState } from '../core/types';
import { computeMaxSteerAngle, computeYawRate, createVehicleState, stepVehicle } from './vehicle';

const DT = 1 / 60;
const NEUTRAL: InputState = { steer: 0, throttle: 0, brake: 0 };
const THROTTLE: InputState = { steer: 0, throttle: 1, brake: 0 };
const BRAKE: InputState = { steer: 0, throttle: 0, brake: 1 };
const STEER_RIGHT: InputState = { steer: 1, throttle: 0, brake: 0 };
const STEER_LEFT: InputState = { steer: -1, throttle: 0, brake: 0 };

function run(start: VehicleState, input: InputState, seconds: number): VehicleState {
  let state = start;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    state = stepVehicle(state, input, VEHICLE_CONFIG, DT);
  }
  return state;
}

function movingAt(speed: number, yaw = 0): VehicleState {
  return { ...createVehicleState({ x: 0, y: 0, z: 0 }, yaw), speed };
}

describe('vehicle longitudinal model', () => {
  it('stays put with no input from rest', () => {
    const state = run(createVehicleState({ x: 0, y: 0, z: 0 }, 0), NEUTRAL, 2);
    expect(state.speed).toBe(0);
    expect(state.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('accelerates along +Z when throttle is held at yaw 0', () => {
    const state = run(createVehicleState({ x: 0, y: 0, z: 0 }, 0), THROTTLE, 2);
    expect(state.speed).toBeGreaterThan(10);
    expect(state.position.z).toBeGreaterThan(0);
    expect(state.position.x).toBeCloseTo(0, 6);
  });

  it('never exceeds the forward speed limit', () => {
    const state = run(createVehicleState({ x: 0, y: 0, z: 0 }, 0), THROTTLE, 60);
    expect(state.speed).toBeLessThanOrEqual(VEHICLE_CONFIG.maxForwardSpeedMps + 1e-9);
    expect(state.speed).toBeGreaterThan(VEHICLE_CONFIG.maxForwardSpeedMps * 0.99);
  });

  it('brakes to a stop without overshooting into reverse', () => {
    let state = movingAt(3);
    for (let i = 0; i < 60 * 3 && state.speed > 0; i += 1) {
      state = stepVehicle(state, BRAKE, VEHICLE_CONFIG, DT);
      expect(state.speed).toBeGreaterThanOrEqual(0);
    }
    expect(state.speed).toBe(0);
  });

  it('reverses only after the brake is held again at standstill', () => {
    const stopped = movingAt(0);
    const held = stepVehicle(stopped, BRAKE, VEHICLE_CONFIG, DT);
    expect(held.speed).toBeLessThan(0);
  });

  it('reverses when brake is held at standstill, and respects the reverse limit', () => {
    const state = run(createVehicleState({ x: 0, y: 0, z: 0 }, 0), BRAKE, 30);
    expect(state.speed).toBeLessThan(0);
    expect(state.speed).toBeGreaterThanOrEqual(-VEHICLE_CONFIG.maxReverseSpeedMps - 1e-9);
    expect(state.position.z).toBeLessThan(0);
  });

  it('coasts toward zero without overshooting when no input is held', () => {
    let state = movingAt(20);
    let previous = state.speed;
    for (let i = 0; i < 60 * 30; i += 1) {
      state = stepVehicle(state, NEUTRAL, VEHICLE_CONFIG, DT);
      expect(state.speed).toBeLessThanOrEqual(previous);
      expect(state.speed).toBeGreaterThanOrEqual(0);
      previous = state.speed;
    }
    expect(state.speed).toBe(0);
  });
});

describe('vehicle steering convention', () => {
  it('steering right increases yaw and moves the vehicle toward +X', () => {
    const state = run(movingAt(15), STEER_RIGHT, 1);
    expect(state.yaw).toBeGreaterThan(0);
    expect(state.yawRate).toBeGreaterThan(0);
    expect(state.position.x).toBeGreaterThan(0);
  });

  it('steering left decreases yaw and moves the vehicle toward -X', () => {
    const state = run(movingAt(15), STEER_LEFT, 1);
    expect(state.yaw).toBeLessThan(0);
    expect(state.yawRate).toBeLessThan(0);
    expect(state.position.x).toBeLessThan(0);
  });

  it('reverses the turn direction when reversing with the same steer input', () => {
    const state = run(movingAt(-6), STEER_RIGHT, 0.5);
    expect(state.yawRate).toBeLessThan(0);
  });

  it('ramps the wheel angle at the configured rate instead of snapping', () => {
    const first = stepVehicle(movingAt(10), STEER_RIGHT, VEHICLE_CONFIG, DT);
    expect(first.steerAngle).toBeGreaterThan(0);
    expect(first.steerAngle).toBeLessThanOrEqual(VEHICLE_CONFIG.steerRateRadiansPerSecond * DT + 1e-12);
  });

  it('reduces steering authority at top speed', () => {
    const atRest = computeMaxSteerAngle(0, VEHICLE_CONFIG);
    const atTop = computeMaxSteerAngle(VEHICLE_CONFIG.maxForwardSpeedMps, VEHICLE_CONFIG);
    expect(atRest).toBeCloseTo(VEHICLE_CONFIG.maxSteerAngleRadians, 9);
    expect(atTop).toBeLessThan(atRest);
  });

  it('caps yaw rate so lateral acceleration stays within the configured limit', () => {
    const speed = 40;
    const yawRate = computeYawRate(speed, VEHICLE_CONFIG.maxSteerAngleRadians, VEHICLE_CONFIG);
    const lateralAcceleration = Math.abs(speed * yawRate);
    expect(lateralAcceleration).toBeLessThanOrEqual(VEHICLE_CONFIG.maxLateralAccelerationMps2 + 1e-9);
  });
});

describe('vehicle determinism and state handling', () => {
  it('produces identical results for identical input sequences', () => {
    const script: InputState[] = [THROTTLE, STEER_RIGHT, STEER_RIGHT, NEUTRAL, STEER_LEFT, BRAKE];
    const runScript = () => {
      let state = createVehicleState({ x: 1, y: 0, z: 2 }, 0.3);
      for (let i = 0; i < 600; i += 1) {
        state = stepVehicle(state, script[i % script.length] ?? NEUTRAL, VEHICLE_CONFIG, DT);
      }
      return state;
    };
    expect(runScript()).toEqual(runScript());
  });

  it('does not mutate the previous state object', () => {
    const before = movingAt(12);
    const snapshot = JSON.parse(JSON.stringify(before)) as VehicleState;
    stepVehicle(before, THROTTLE, VEHICLE_CONFIG, DT);
    expect(before).toEqual(snapshot);
  });

  it('keeps yaw wrapped into [-PI, PI) after many turns', () => {
    const state = run(movingAt(8), STEER_RIGHT, 40);
    expect(state.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(state.yaw).toBeLessThan(Math.PI);
  });
});
