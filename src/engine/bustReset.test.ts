import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { GameSimulation, type PursuitStepHost } from './gameSimulation';
import { OpponentSystem } from '../ai/aiOpponents';
import { getWorldDefinition } from '../world/worlds';
import type { InputState, Vec3 } from '../core/types';

/*
 * The busted reset in the simulation. A pursuit that ends busted sends the car back to the spawn with zero speed, after
 * the step loop, and counts the bust. Nothing else moves the car. The pursuit itself is stubbed here, so only the reset
 * is under test. The pursuit's own busted flag is tested in pursuitController.test.ts.
 */

const DT = FIXED_STEP_SECONDS;
const THROTTLE: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };
const NEUTRAL: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

class StubPursuit implements PursuitStepHost {
  readonly police: OpponentSystem;
  bustNext = false;
  resets = 0;
  constructor(graph: NonNullable<ReturnType<typeof getWorldDefinition>['lanes']>) {
    this.police = new OpponentSystem(graph, null, []);
  }
  isSuspended(): boolean {
    return false;
  }
  afterStep(): void {}
  onPlayerReset(): void {
    this.resets += 1;
  }
  onRam(): void {}
  driveInput(frameInput: InputState): InputState {
    return frameInput;
  }
  takeBustReset(): boolean {
    const pending = this.bustNext;
    this.bustNext = false;
    return pending;
  }
}

function makeSim(): { sim: GameSimulation; pursuit: StubPursuit; spawn: { position: Vec3; yawRadians: number } } {
  const world = getWorldDefinition('city');
  if (!world.lanes) throw new Error('city world has no lanes');
  const pursuit = new StubPursuit(world.lanes);
  const sim = new GameSimulation(VEHICLE_CONFIG, {
    spawn: world.spawn,
    boundary: world.boundary,
    traffic: null,
    opponents: null,
    recoveryLanes: world.lanes.lanes,
    devReset: world.devReset,
    pursuit,
  });
  return { sim, pursuit, spawn: world.spawn };
}

function distanceFromSpawn(sim: GameSimulation, spawn: Vec3): number {
  const p = sim.state.position;
  return Math.hypot(p.x - spawn.x, p.z - spawn.z);
}

describe('busted reset: the car goes back to the spawn', () => {
  it('a bust moves the car to the spawn with zero speed, counts once, and resets the pursuit', () => {
    const { sim, pursuit, spawn } = makeSim();
    for (let i = 0; i < 240; i += 1) sim.update(DT, THROTTLE);
    expect(distanceFromSpawn(sim, spawn.position)).toBeGreaterThan(10);
    expect(sim.bustCount).toBe(0);

    const resetsBefore = pursuit.resets;
    pursuit.bustNext = true;
    sim.update(DT, NEUTRAL);

    expect(sim.bustCount).toBe(1);
    expect(distanceFromSpawn(sim, spawn.position)).toBeLessThan(1e-9);
    expect(sim.state.speed).toBeCloseTo(0, 9);
    expect(pursuit.resets).toBeGreaterThan(resetsBefore);
  });

  it('the reset happens once per bust: a later step without a bust does not count again', () => {
    const { sim, pursuit, spawn } = makeSim();
    pursuit.bustNext = true;
    sim.update(DT, NEUTRAL);
    expect(sim.bustCount).toBe(1);
    for (let i = 0; i < 30; i += 1) sim.update(DT, NEUTRAL);
    expect(sim.bustCount).toBe(1);
    expect(distanceFromSpawn(sim, spawn.position)).toBeLessThan(1e-6);
  });

  it('no bust, no reset: driving on the pursuit stub moves the car and leaves the count alone', () => {
    const { sim } = makeSim();
    for (let i = 0; i < 60; i += 1) sim.update(DT, THROTTLE);
    expect(sim.bustCount).toBe(0);
    expect(sim.state.speed).toBeGreaterThan(0);
  });

  it('a second bust counts again and resets again', () => {
    const { sim, pursuit, spawn } = makeSim();
    pursuit.bustNext = true;
    sim.update(DT, NEUTRAL);
    for (let i = 0; i < 120; i += 1) sim.update(DT, THROTTLE);
    expect(distanceFromSpawn(sim, spawn.position)).toBeGreaterThan(5);
    pursuit.bustNext = true;
    sim.update(DT, NEUTRAL);
    expect(sim.bustCount).toBe(2);
    expect(distanceFromSpawn(sim, spawn.position)).toBeLessThan(1e-9);
  });
});
