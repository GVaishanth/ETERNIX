/*
 * Grade in the vehicle model. A slope adds g * grade to the speed change, along the road. On the flat (slope 0) the step
 * must be exactly the step it was before grade existed. The tests run the real stepVehicle with the real vehicle config.
 */
import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { TERRAIN_CONFIG } from '../config/terrainConfig';
import type { InputState, VehicleState } from '../core/types';
import { createVehicleState, stepVehicle } from './vehicle';

const DT = 1 / 60;
const GRADE_8 = 0.08;
const NONE: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const GAS: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };
const BRAKE: InputState = { steer: 0, throttle: 0, brake: 1, handbrake: 0 };

/** Slope term for a grade: gravity times grade, positive uphill. */
function slopeFor(grade: number): number {
  return TERRAIN_CONFIG.gravityMps2 * grade;
}

function runFor(state: VehicleState, input: InputState, seconds: number, slope: number): VehicleState {
  let current = state;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) current = stepVehicle(current, input, VEHICLE_CONFIG, DT, slope);
  return current;
}

function movingAt(speed: number): VehicleState {
  return { ...createVehicleState({ x: 0, y: 0, z: 0 }, 0), speed };
}

/**
 * Brakes a moving car until it stops. Returns the step count, or null if it does not stop within the time. Fails if the
 * speed goes negative before the car has stopped. After it stops, holding the brake reverses it, which is not checked here.
 */
function stopSteps(start: VehicleState, input: InputState, slope: number, maxSeconds: number): number | null {
  let state = start;
  const limit = Math.round(maxSeconds / DT);
  for (let i = 1; i <= limit; i += 1) {
    state = stepVehicle(state, input, VEHICLE_CONFIG, DT, slope);
    expect(state.speed).toBeGreaterThanOrEqual(0);
    if (state.speed === 0) return i;
  }
  return null;
}

describe('vehicle grade', () => {
  it('on the flat, a slope of zero gives exactly the step the model gave before grade existed', () => {
    const states = [movingAt(0), movingAt(12), movingAt(-3)];
    const inputs = [GAS, BRAKE, NONE];
    for (const state of states) {
      for (const input of inputs) {
        const withoutGrade = stepVehicle(state, input, VEHICLE_CONFIG, DT);
        const withZero = stepVehicle(state, input, VEHICLE_CONFIG, DT, 0);
        expect(withZero).toEqual(withoutGrade);
      }
    }
  });

  it('a climb slows a coasting car, and a descent speeds it up, by about g times the grade', () => {
    const flat = runFor(movingAt(15), NONE, 1, 0);
    const up = runFor(movingAt(15), NONE, 1, slopeFor(GRADE_8));
    const down = runFor(movingAt(15), NONE, 1, -slopeFor(GRADE_8));
    expect(up.speed).toBeLessThan(flat.speed);
    expect(down.speed).toBeGreaterThan(flat.speed);
    // Over one second the difference is about g * grade = 0.78 m/s each way (the other terms are the same in all three).
    const expected = slopeFor(GRADE_8);
    expect(flat.speed - up.speed).toBeGreaterThan(expected * 0.9);
    expect(flat.speed - up.speed).toBeLessThan(expected * 1.1);
    expect(down.speed - flat.speed).toBeGreaterThan(expected * 0.9);
    expect(down.speed - flat.speed).toBeLessThan(expected * 1.1);
  });

  it('a car with the throttle on climbs more slowly than on the flat', () => {
    const flat = runFor(movingAt(0), GAS, 4, 0);
    const up = runFor(movingAt(0), GAS, 4, slopeFor(GRADE_8));
    expect(up.speed).toBeLessThan(flat.speed);
    expect(up.speed).toBeGreaterThan(0);
  });

  it('braking up a climb stops the car at zero and never reverses it while stopping', () => {
    // Forward braking stops exactly at zero. The slope pull must not push the car through zero before it stops.
    const stopsWithin = stopSteps(movingAt(10), BRAKE, slopeFor(GRADE_8), 4);
    expect(stopsWithin).not.toBeNull();
  });

  it('braking down a descent also stops the car at zero, without overshoot', () => {
    const stopsWithin = stopSteps(movingAt(10), BRAKE, -slopeFor(GRADE_8), 4);
    expect(stopsWithin).not.toBeNull();
  });
});
