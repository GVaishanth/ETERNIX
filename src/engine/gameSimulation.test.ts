import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS, VEHICLE_SPAWN } from '../config/simulationConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState } from '../core/types';
import { createBodyState, stepBody } from '../simulation/bodyState';
import { createVehicleState, stepVehicle } from '../simulation/vehicle';
import { GameSimulation } from './gameSimulation';

const THROTTLE: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };
const NEUTRAL: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

describe('GameSimulation', () => {
  it('advances in fixed steps regardless of frame rate', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    sim.update(FIXED_STEP_SECONDS, THROTTLE);
    expect(sim.stepCount).toBe(1);
  });

  it('does not advance when no time has elapsed', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    const before = sim.state;
    sim.update(0, THROTTLE);
    expect(sim.stepCount).toBe(0);
    expect(sim.state).toBe(before);
  });

  it('produces the same final state for a 120 Hz frame stream and a 30 Hz frame stream', () => {
    const fine = new GameSimulation(VEHICLE_CONFIG);
    const coarse = new GameSimulation(VEHICLE_CONFIG);
    for (let i = 0; i < 120; i += 1) fine.update(1 / 120, THROTTLE);
    for (let i = 0; i < 30; i += 1) coarse.update(1 / 30, THROTTLE);
    expect(fine.stepCount).toBe(coarse.stepCount);
    expect(fine.state.speed).toBeCloseTo(coarse.state.speed, 9);
    expect(fine.state.position.z).toBeCloseTo(coarse.state.position.z, 9);
  });

  it('interpolates the render state between the last two simulated steps', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    sim.update(FIXED_STEP_SECONDS * 3, THROTTLE);
    sim.update(FIXED_STEP_SECONDS * 0.5, THROTTLE);
    const render = sim.getRenderState();
    const current = sim.state;
    expect(sim.interpolationAlpha).toBeGreaterThan(0);
    expect(render.position.z).toBeLessThan(current.position.z);
    expect(render.position.z).toBeGreaterThan(0);
  });

  it('keeps the vehicle still when the input is neutral', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    for (let i = 0; i < 60; i += 1) sim.update(FIXED_STEP_SECONDS, NEUTRAL);
    expect(sim.state.speed).toBe(0);
    expect(sim.state.position.z).toBe(0);
  });

  it('reset returns to the spawn pose with zero speed and steering', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    for (let i = 0; i < 120; i += 1) sim.update(FIXED_STEP_SECONDS, { ...THROTTLE, steer: 1 });
    expect(sim.state.speed).toBeGreaterThan(0);
    sim.reset();
    expect(sim.state.speed).toBe(0);
    expect(sim.state.yaw).toBe(0);
    expect(sim.state.steerAngle).toBe(0);
    expect(sim.state.position).toEqual({ x: VEHICLE_SPAWN.x, y: 0, z: 0 });
    expect(sim.getRenderState().position).toEqual(sim.state.position);
  });

  it('advances the vehicle exactly as a plain stepVehicle chain, so there is one movement system', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    const script: InputState[] = [THROTTLE, { ...THROTTLE, steer: 1 }, NEUTRAL, { ...NEUTRAL, brake: 1 }];
    let manual = createVehicleState(VEHICLE_SPAWN, 0);
    for (let i = 0; i < 240; i += 1) {
      const input = script[Math.floor(i / 30) % script.length] ?? NEUTRAL;
      sim.update(FIXED_STEP_SECONDS, input);
      manual = stepVehicle(manual, input, VEHICLE_CONFIG, FIXED_STEP_SECONDS);
    }
    expect(sim.state).toEqual(manual);
  });

  it('keeps the cosmetic body separate: the body advances, and the vehicle is unaffected by it', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    let body = createBodyState();
    for (let i = 0; i < 60; i += 1) sim.update(FIXED_STEP_SECONDS, THROTTLE);
    // Recompute the body from the same vehicle history, to confirm the body is driven by the vehicle and not the reverse.
    let manual = createVehicleState(VEHICLE_SPAWN, 0);
    for (let i = 0; i < 60; i += 1) {
      manual = stepVehicle(manual, THROTTLE, VEHICLE_CONFIG, FIXED_STEP_SECONDS);
      body = stepBody(body, manual, VEHICLE_CONFIG, FIXED_STEP_SECONDS);
    }
    expect(sim.body).toEqual(body);
    expect(sim.state.position).toEqual(manual.position);
    expect(sim.body.pitch).toBeLessThan(0);
  });

  it('clears the body and the render interpolation on reset', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    for (let i = 0; i < 60; i += 1) sim.update(FIXED_STEP_SECONDS, THROTTLE);
    sim.reset();
    expect(sim.body).toEqual(createBodyState());
    expect(sim.getRenderBody()).toEqual(createBodyState());
  });

  it('interpolates the body between steps for rendering', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    sim.update(FIXED_STEP_SECONDS * 20, THROTTLE);
    sim.update(FIXED_STEP_SECONDS * 0.5, THROTTLE);
    const render = sim.getRenderBody();
    expect(render.pitch).toBeLessThanOrEqual(0);
    expect(render.pitch).toBeGreaterThanOrEqual(sim.body.pitch - 1e-12);
  });
});
