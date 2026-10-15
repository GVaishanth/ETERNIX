import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS, VEHICLE_SPAWN } from '../config/simulationConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState } from '../core/types';
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
});
