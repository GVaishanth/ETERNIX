import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState } from '../core/types';
import { getWorldDefinition } from '../world/worlds';
import { GameSimulation } from './gameSimulation';

/*
 * Part 5 recovery in the real simulation, on the city's road boundary and lanes. Frame time is one fixed step per call.
 */

const FRAME = FIXED_STEP_SECONDS;
const NO_INPUT: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const FULL_THROTTLE: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };

function cityWorld() {
  const world = getWorldDefinition('city');
  const sim = new GameSimulation(VEHICLE_CONFIG, {
    spawn: world.spawn,
    boundary: world.boundary,
    recoveryLanes: world.lanes ? world.lanes.lanes : null,
    devReset: world.devReset,
  });
  return { world, sim };
}

describe('recovery in the simulation (test: world bounds)', () => {
  it('never recovers a parked car on the road in a long idle run', () => {
    const { sim } = cityWorld();
    for (let i = 0; i < 60 / FRAME; i += 1) sim.update(FRAME, NO_INPUT);
    expect(sim.recoveryCount).toBe(0);
    expect(sim.lastRecoveryReason).toBeNull();
  });

  it('never recovers during ordinary driving along the spawn street', () => {
    const { sim } = cityWorld();
    for (let i = 0; i < 12 / FRAME; i += 1) sim.update(FRAME, FULL_THROTTLE);
    expect(sim.recoveryCount).toBe(0);
    expect(sim.getRenderState().speed).toBeGreaterThan(5);
  });

  it('does not recover a car pinned on the road against the east boundary: it is recoverable, so it stays put', () => {
    const { sim } = cityWorld();
    // Full throttle east: the boundary holds the car at the edge, at zero speed, still on the road. Over 150 s it must not
    // be recovered, since the car can reverse out. The stuck rule itself is tested in worldRecovery.test.ts.
    for (let i = 0; i < 150 / FRAME; i += 1) sim.update(FRAME, FULL_THROTTLE);
    expect(sim.recoveryCount).toBe(0);
    expect(sim.getRenderState().position.x).toBeGreaterThan(400);
  });

  it('recovers a car that starts outside the world bounds, at once, onto a driving lane inside the city', () => {
    const world = getWorldDefinition('city');
    const lost = new GameSimulation(VEHICLE_CONFIG, {
      spawn: { position: { x: 2000, y: 0, z: 2000 }, yawRadians: 0 },
      boundary: world.boundary,
      recoveryLanes: world.lanes ? world.lanes.lanes : null,
    });
    lost.update(FRAME, NO_INPUT);
    expect(lost.recoveryCount).toBe(1);
    expect(lost.lastRecoveryReason).toBe('outside-bounds');
    const state = lost.getRenderState();
    expect(state.speed).toBeCloseTo(0, 9);
    expect(state.position.x).toBeGreaterThanOrEqual(world.bounds ? world.bounds.minX : -Infinity);
    expect(state.position.x).toBeLessThanOrEqual(world.bounds ? world.bounds.maxX : Infinity);
    expect(state.position.z).toBeGreaterThanOrEqual(world.bounds ? world.bounds.minZ : -Infinity);
    expect(state.position.z).toBeLessThanOrEqual(world.bounds ? world.bounds.maxZ : Infinity);
  });

  it('the DEV reset moves the car to the explicit DEV pose with zero speed, and only where a pose exists', () => {
    const { sim, world } = cityWorld();
    for (let i = 0; i < 3 / FRAME; i += 1) sim.update(FRAME, FULL_THROTTLE);
    expect(sim.devReset()).toBe(true);
    const state = sim.getRenderState();
    expect(state.position.x).toBeCloseTo(world.devReset?.position.x ?? NaN, 6);
    expect(state.position.z).toBeCloseTo(world.devReset?.position.z ?? NaN, 6);
    expect(state.speed).toBeCloseTo(0, 9);
    // A simulation with no DEV pose refuses the reset.
    const plain = new GameSimulation(VEHICLE_CONFIG, { spawn: world.spawn, boundary: world.boundary });
    expect(plain.devReset()).toBe(false);
  });
});
