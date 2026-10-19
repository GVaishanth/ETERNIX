import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState, VehicleState } from '../core/types';
import { RAD_TO_DEG } from '../core/units';
import {
  computeGripReduction,
  computeMaxSteerAngle,
  computePowerOversteer,
  computeYawRate,
  createVehicleState,
  getDriveDirection,
  interpolateVehicleState,
  isDrifting,
  pedalTargets,
  slipAngleRadians,
  stepVehicle,
} from './vehicle';

const DT = 1 / 60;
const TOP = VEHICLE_CONFIG.maxForwardSpeedMps;

/** Builds a complete input snapshot, with every unspecified control released. */
function input(partial: Partial<InputState> = {}): InputState {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0, ...partial };
}

const NEUTRAL = input();
const THROTTLE = input({ throttle: 1 });
const BRAKE = input({ brake: 1 });
const HANDBRAKE = input({ handbrake: 1 });
const STEER_RIGHT = input({ steer: 1 });
const STEER_LEFT = input({ steer: -1 });

function run(start: VehicleState, inputState: InputState, seconds: number): VehicleState {
  let state = start;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    state = stepVehicle(state, inputState, VEHICLE_CONFIG, DT);
  }
  return state;
}

const ORIGIN = { x: 0, y: 0, z: 0 };

/** A car already moving at `speed`, with no lateral velocity or pedal state. */
function movingAt(speed: number, yaw = 0): VehicleState {
  return { ...createVehicleState(ORIGIN, yaw), speed };
}

describe('vehicle longitudinal model', () => {
  it('stays put with no input from rest', () => {
    const state = run(createVehicleState(ORIGIN, 0), NEUTRAL, 2);
    expect(state.speed).toBe(0);
    expect(state.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('accelerates along +Z when throttle is held at yaw 0', () => {
    const state = run(createVehicleState(ORIGIN, 0), THROTTLE, 2);
    expect(state.speed).toBeGreaterThan(10);
    expect(state.position.z).toBeGreaterThan(0);
    expect(state.position.x).toBeCloseTo(0, 6);
  });

  it('ramps the throttle pedal instead of applying full throttle at once', () => {
    const first = stepVehicle(createVehicleState(ORIGIN, 0), THROTTLE, VEHICLE_CONFIG, DT);
    expect(first.throttlePedal).toBeCloseTo(VEHICLE_CONFIG.throttleRisePerSecond * DT, 9);
    const afterThird = run(createVehicleState(ORIGIN, 0), THROTTLE, 1 / 3);
    expect(afterThird.throttlePedal).toBeCloseTo(1, 1);
  });

  it('accelerates progressively: acceleration falls as speed rises', () => {
    const early = stepVehicle(movingAt(5), THROTTLE, VEHICLE_CONFIG, DT);
    const late = stepVehicle(movingAt(50), THROTTLE, VEHICLE_CONFIG, DT);
    expect(early.longitudinalAccel).toBeGreaterThan(late.longitudinalAccel);
  });

  it('levels off near the configured top speed and never exceeds the hard cap', () => {
    let state = createVehicleState(ORIGIN, 0);
    let peak = 0;
    for (let i = 0; i < 60 * 120; i += 1) {
      state = stepVehicle(state, THROTTLE, VEHICLE_CONFIG, DT);
      peak = Math.max(peak, state.speed);
    }
    expect(peak).toBeLessThanOrEqual(TOP + 1e-9);
    expect(state.speed).toBeGreaterThan(TOP - 1);
  });

  it('never exceeds the forward speed limit', () => {
    const state = run(createVehicleState(ORIGIN, 0), THROTTLE, 60);
    expect(state.speed).toBeLessThanOrEqual(TOP + 1e-9);
  });

  it('brakes to a stop without overshooting into reverse', () => {
    let state = movingAt(3);
    for (let i = 0; i < 60 * 3 && state.speed > 0; i += 1) {
      state = stepVehicle(state, BRAKE, VEHICLE_CONFIG, DT);
      expect(state.speed).toBeGreaterThanOrEqual(0);
    }
    expect(state.speed).toBe(0);
  });

  it('reverses only after the brake is held at standstill, with the pedal ramp allowing it to start', () => {
    const held = run(movingAt(0), BRAKE, 0.5);
    expect(held.speed).toBeLessThan(0);
    const released = run(movingAt(0), NEUTRAL, 2);
    expect(released.speed).toBe(0);
  });

  it('reverses when brake is held at standstill, and respects the reverse limit', () => {
    const state = run(createVehicleState(ORIGIN, 0), BRAKE, 30);
    expect(state.speed).toBeLessThan(0);
    expect(state.speed).toBeGreaterThanOrEqual(-VEHICLE_CONFIG.maxReverseSpeedMps - 1e-9);
    expect(state.speed).toBeCloseTo(-VEHICLE_CONFIG.maxReverseSpeedMps, 1);
    expect(state.position.z).toBeLessThan(0);
  });

  it('throttle while reversing brakes the car back to a stop before going forward', () => {
    let state = movingAt(-5);
    for (let i = 0; i < 60 * 5 && state.speed < 0; i += 1) {
      state = stepVehicle(state, THROTTLE, VEHICLE_CONFIG, DT);
    }
    expect(state.speed).toBeGreaterThanOrEqual(0);
    expect(state.speed).toBeLessThan(VEHICLE_CONFIG.engineAccelerationMps2 * 1.5);
  });

  it('gives brake priority over throttle when both are held', () => {
    const both = run(movingAt(10), input({ throttle: 1, brake: 1 }), 0.5);
    const brakeOnly = run(movingAt(10), BRAKE, 0.5);
    expect(both.speed).toBeCloseTo(brakeOnly.speed, 9);
    expect(pedalTargets(input({ throttle: 1, brake: 1 })).throttle).toBe(0);
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

describe('handbrake and grip', () => {
  it('decelerates at the configured handbrake rate', () => {
    const state = run(movingAt(20), HANDBRAKE, 0.5);
    const expected = 20 - VEHICLE_CONFIG.handbrakeDecelerationMps2 * 0.5;
    expect(state.speed).toBeCloseTo(expected, 3);
  });

  it('brings the car to exactly zero and holds it there', () => {
    const state = run(movingAt(15), HANDBRAKE, 5);
    expect(state.speed).toBe(0);
  });

  it('lets throttle work against the handbrake: the car slows less than with the handbrake alone', () => {
    const throttleHeld = run(movingAt(10), input({ throttle: 1, handbrake: 1 }), 0.5);
    const handbrakeOnly = run(movingAt(10), HANDBRAKE, 0.5);
    expect(throttleHeld.speed).toBeGreaterThan(handbrakeOnly.speed);
  });

  it('never reverses the car while the handbrake and throttle are both held', () => {
    let state = movingAt(0);
    for (let i = 0; i < 60 * 3; i += 1) {
      state = stepVehicle(state, input({ throttle: 1, handbrake: 1 }), VEHICLE_CONFIG, DT);
      expect(state.speed).toBeGreaterThanOrEqual(0);
    }
  });

  it('still brings the car to rest when the handbrake is held and the throttle is released', () => {
    const state = run(movingAt(15), HANDBRAKE, 5);
    expect(state.speed).toBe(0);
  });

  it('blocks reverse creep and reverse acceleration while held', () => {
    const state = run(movingAt(0), input({ brake: 1, handbrake: 1 }), 2);
    expect(state.speed).toBe(0);
    expect(state.position.z).toBe(0);
  });

  it('adds no grip loss below the drift speed gate, even with the handbrake fully held', () => {
    // Below the gate the handbrake only slows the car. The grip reduction stays zero until the speed gate is passed.
    expect(computeGripReduction(1, 5, VEHICLE_CONFIG)).toBe(0);
    expect(computeGripReduction(1, VEHICLE_CONFIG.driftMinSpeedMps, VEHICLE_CONFIG)).toBe(0);
    expect(computeGripReduction(1, VEHICLE_CONFIG.driftMinSpeedMps + VEHICLE_CONFIG.driftSpeedRampMps, VEHICLE_CONFIG)).toBe(1);
    const slowHeld = run(movingAt(5), input({ steer: 1, handbrake: 1 }), 0.5);
    expect(isDrifting(slowHeld, VEHICLE_CONFIG)).toBe(false);
  });

  it('never reports a drift when coasting at full lock with no handbrake and no throttle', () => {
    let state = movingAt(12);
    for (let i = 0; i < 60 * 3; i += 1) {
      state = stepVehicle(state, input({ steer: 1 }), VEHICLE_CONFIG, DT);
      expect(isDrifting(state, VEHICLE_CONFIG)).toBe(false);
    }
  });

  it('adds no power oversteer without throttle, at low speed, or without steering', () => {
    expect(computePowerOversteer(0, 0.2, 30, VEHICLE_CONFIG)).toBe(0);
    expect(computePowerOversteer(1, 0.2, VEHICLE_CONFIG.driftMinSpeedMps, VEHICLE_CONFIG)).toBe(0);
    expect(computePowerOversteer(1, 0, 30, VEHICLE_CONFIG)).toBe(0);
  });

  it('scales power oversteer with throttle and steering, capped at the configured grip loss', () => {
    const full = computePowerOversteer(1, VEHICLE_CONFIG.steerAngleHighSpeedRadians, 30, VEHICLE_CONFIG);
    const half = computePowerOversteer(0.5, VEHICLE_CONFIG.steerAngleHighSpeedRadians, 30, VEHICLE_CONFIG);
    expect(full).toBeCloseTo(VEHICLE_CONFIG.powerOversteerGripLoss, 9);
    expect(half).toBeCloseTo(full / 2, 9);
    expect(computePowerOversteer(1, 10, 30, VEHICLE_CONFIG)).toBeLessThanOrEqual(VEHICLE_CONFIG.powerOversteerGripLoss);
  });

  it('lets throttle and steering start a slide without the handbrake, and turns it off at zero', () => {
    const slipAfter = (grip: number): number => {
      const cfg = { ...VEHICLE_CONFIG, powerOversteerGripLoss: grip };
      let state = movingAt(20);
      for (let i = 0; i < 90; i += 1) {
        state = stepVehicle(state, input({ steer: 1, throttle: 1 }), cfg, DT);
      }
      return Math.abs(slipAngleRadians(state)) * RAD_TO_DEG;
    };
    expect(slipAfter(VEHICLE_CONFIG.powerOversteerGripLoss)).toBeGreaterThan(slipAfter(0));
    expect(slipAfter(0)).toBeLessThan(VEHICLE_CONFIG.driftSlipThresholdDegrees);
  });

  it('does not spin the car when the handbrake is held on a straight road', () => {
    const state = run(movingAt(20), HANDBRAKE, 1);
    expect(state.yaw).toBe(0);
    expect(state.lateralSpeed).toBe(0);
  });
});

describe('drift', () => {
  // A drift is started by handbrake plus steer at speed. Steering still sets the heading; only grip is lower.
  function driftStart(): VehicleState {
    let state = movingAt(20);
    for (let i = 0; i < 60; i += 1) {
      state = stepVehicle(state, input({ steer: 1, throttle: 1, handbrake: 1 }), VEHICLE_CONFIG, DT);
    }
    return state;
  }

  it('starts a drift when the handbrake and steering are used at speed', () => {
    let state = movingAt(20);
    let drifted = false;
    for (let i = 0; i < 90; i += 1) {
      state = stepVehicle(state, input({ steer: 1, handbrake: 1 }), VEHICLE_CONFIG, DT);
      if (isDrifting(state, VEHICLE_CONFIG)) drifted = true;
    }
    expect(drifted).toBe(true);
    expect(Math.abs(slipAngleRadians(state)) * RAD_TO_DEG).toBeGreaterThan(VEHICLE_CONFIG.driftSlipThresholdDegrees);
  });

  it('keeps steering authority during the drift: the heading still turns right with steer right', () => {
    const drifting = driftStart();
    expect(drifting.yaw).toBeGreaterThan(0);
    expect(drifting.yawRate).toBeGreaterThan(0);
  });

  it('recovers grip smoothly after the handbrake is released', () => {
    let state = driftStart();
    // Release the handbrake and the steering, keep rolling.
    for (let i = 0; i < 60 * 4; i += 1) {
      state = stepVehicle(state, input({ throttle: 1 }), VEHICLE_CONFIG, DT);
    }
    expect(Math.abs(slipAngleRadians(state)) * RAD_TO_DEG).toBeLessThan(1);
    expect(isDrifting(state, VEHICLE_CONFIG)).toBe(false);
  });

  it('never lets lateral speed exceed the configured slip limit', () => {
    let state = movingAt(30);
    const limit = Math.tan((VEHICLE_CONFIG.maxSlipAngleDegrees * Math.PI) / 180);
    for (let i = 0; i < 60 * 6; i += 1) {
      state = stepVehicle(state, input({ steer: 1, handbrake: 1 }), VEHICLE_CONFIG, DT);
      expect(Math.abs(state.lateralSpeed)).toBeLessThanOrEqual(Math.abs(state.speed) * limit + 1e-9);
    }
  });

  it('ramps the handbrake level instead of switching it on at once', () => {
    const first = stepVehicle(movingAt(20), input({ handbrake: 1 }), VEHICLE_CONFIG, DT);
    expect(first.handbrakeLevel).toBeCloseTo(DT / VEHICLE_CONFIG.handbrakeEngageSeconds, 9);
  });
});

describe('vehicle steering convention', () => {
  // Mandatory steering-sign test. Steering is speed-sensitive, so these runs are rolling with W held.
  it('rolling W+A decreases heading and moves the car toward -X', () => {
    const rolling = run(createVehicleState(ORIGIN, 0), THROTTLE, 1);
    const turned = run(rolling, input({ throttle: 1, steer: -1 }), 1);
    expect(turned.yaw).toBeLessThan(0);
    expect(turned.yawRate).toBeLessThan(0);
    expect(turned.position.x).toBeLessThan(0);
  });

  it('rolling W+D increases heading and moves the car toward +X', () => {
    const rolling = run(createVehicleState(ORIGIN, 0), THROTTLE, 1);
    const turned = run(rolling, input({ throttle: 1, steer: 1 }), 1);
    expect(turned.yaw).toBeGreaterThan(0);
    expect(turned.yawRate).toBeGreaterThan(0);
    expect(turned.position.x).toBeGreaterThan(0);
  });

  it('steering right increases yaw and moves the vehicle toward +X', () => {
    const state = run(movingAt(15), STEER_RIGHT, 1);
    expect(state.yaw).toBeGreaterThan(0);
    expect(state.position.x).toBeGreaterThan(0);
  });

  it('steering left decreases yaw and moves the vehicle toward -X', () => {
    const state = run(movingAt(15), STEER_LEFT, 1);
    expect(state.yaw).toBeLessThan(0);
    expect(state.position.x).toBeLessThan(0);
  });

  it('does not rotate the car from a standstill (speed-sensitive steering)', () => {
    const state = run(createVehicleState(ORIGIN, 0), STEER_RIGHT, 1);
    expect(state.yaw).toBeCloseTo(0, 9);
    expect(state.position.x).toBeCloseTo(0, 9);
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

  it('reduces steering authority with speed, from low-speed lock to high-speed lock', () => {
    const atRest = computeMaxSteerAngle(0, VEHICLE_CONFIG);
    const atTop = computeMaxSteerAngle(TOP, VEHICLE_CONFIG);
    expect(atRest).toBeCloseTo(VEHICLE_CONFIG.steerAngleLowSpeedRadians, 9);
    expect(atTop).toBeCloseTo(VEHICLE_CONFIG.steerAngleHighSpeedRadians, 9);
    expect(computeMaxSteerAngle(30, VEHICLE_CONFIG)).toBeLessThan(atRest);
    expect(computeMaxSteerAngle(30, VEHICLE_CONFIG)).toBeGreaterThan(atTop);
  });

  it('caps yaw rate so lateral acceleration stays within the configured limit', () => {
    const speed = 40;
    const yawRate = computeYawRate(speed, VEHICLE_CONFIG.steerAngleLowSpeedRadians, VEHICLE_CONFIG);
    const lateralAcceleration = Math.abs(speed * yawRate);
    expect(lateralAcceleration).toBeLessThanOrEqual(VEHICLE_CONFIG.maxLateralAccelerationMps2 + 1e-9);
  });

  it('keeps the steering yaw rate capped while the car is held at full lock and speed', () => {
    const state = run(movingAt(40), STEER_RIGHT, 2);
    expect(Math.abs(state.lateralAccel)).toBeLessThanOrEqual(VEHICLE_CONFIG.maxLateralAccelerationMps2 + 1e-6);
  });
});

describe('wheel spin', () => {
  it('spins the wheels by distance traveled divided by radius', () => {
    let state = movingAt(10);
    let accumulated = 0;
    const seconds = 2;
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      const before = state.wheelSpin;
      state = stepVehicle(state, NEUTRAL, VEHICLE_CONFIG, DT);
      // Shortest-arc step, so the wrap at ±PI does not count as a full turn.
      accumulated += Math.atan2(Math.sin(state.wheelSpin - before), Math.cos(state.wheelSpin - before));
    }
    const distance = state.position.z;
    expect(accumulated).toBeCloseTo(distance / VEHICLE_CONFIG.wheelRadiusMeters, 2);
  });

  it('spins backward when reversing', () => {
    const state = run(movingAt(-5), NEUTRAL, 0.5);
    expect(state.wheelSpin).toBeGreaterThan(-Math.PI - 1e-9);
    expect(state.wheelSpin).toBeLessThan(Math.PI);
    const forward = run(movingAt(5), NEUTRAL, 0.5);
    expect(forward.wheelSpin).toBeGreaterThan(0);
  });

  it('does not spin while the car is stopped', () => {
    const state = run(createVehicleState(ORIGIN, 0), NEUTRAL, 1);
    expect(state.wheelSpin).toBe(0);
  });
});

describe('vehicle determinism and state handling', () => {
  it('produces identical results for identical input sequences', () => {
    const script: InputState[] = [THROTTLE, input({ throttle: 1, steer: 1 }), input({ throttle: 1, steer: 1 }), NEUTRAL, input({ steer: -1 }), BRAKE];
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

  it('does nothing for a zero or negative timestep', () => {
    const start = movingAt(10);
    expect(stepVehicle(start, THROTTLE, VEHICLE_CONFIG, 0)).toBe(start);
  });

  it('interpolates across the ±PI heading seam by the short way', () => {
    const a = { ...movingAt(0), yaw: Math.PI - 0.05 };
    const b = { ...movingAt(0), yaw: -Math.PI + 0.05 };
    const mid = interpolateVehicleState(a, b, 0.5);
    expect(Math.abs(Math.abs(mid.yaw) - Math.PI)).toBeLessThan(1e-9);
  });
});

describe('drive direction readout', () => {
  it('reports drive, reverse, and neutral from the signed speed', () => {
    expect(getDriveDirection(10)).toBe('drive');
    expect(getDriveDirection(-3)).toBe('reverse');
    expect(getDriveDirection(0)).toBe('neutral');
    expect(getDriveDirection(0.05)).toBe('neutral');
  });
});
