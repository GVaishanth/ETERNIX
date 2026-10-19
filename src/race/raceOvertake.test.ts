/*
 * Overtaking. A rival held up by a rival ahead changes to the neighbouring lane when that lane is clear. The test runs a
 * real sprint on the city road, with no mocks, and reads each rival's lane index every step.
 */
import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { RACE_CONFIG } from '../config/raceConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { GameSimulation } from '../engine/gameSimulation';
import { createTrafficRuntime, playerFootprintFromConfig } from '../traffic/trafficRuntime';
import { getWorldDefinition } from '../world/worlds';
import { RaceController } from './raceController';
import { SPRINT_EASTSIDE } from './raceEvents';

const STILL = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const RACE_SECONDS = 90;

interface Run {
  /** Steps at which each rival changed lane index, by rival id. */
  changes: Map<number, number[]>;
  rivalCount: number;
}

function runSprint(): Run {
  const world = getWorldDefinition('city');
  if (!world.network || !world.lanes) throw new Error('city world has no network');
  const traffic = createTrafficRuntime(world.network, world.lanes, world.boundary, world.trafficScenario, playerFootprintFromConfig(VEHICLE_CONFIG), world.ambient);
  const sim = new GameSimulation(VEHICLE_CONFIG, { spawn: world.spawn, boundary: world.boundary, traffic, opponents: null, recoveryLanes: world.lanes.lanes, devReset: world.devReset });
  const race = new RaceController(sim, world.lanes, world.boundary, [SPRINT_EASTSIDE]);
  race.attach();
  const grid = race.entries[0]!.route.grid;
  sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
  sim.update(FIXED_STEP_SECONDS, STILL);
  race.confirm();
  const lastIndex = new Map<number, number>();
  const changes = new Map<number, number[]>();
  let rivalCount = 0;
  for (let step = 0; step < 60 * RACE_SECONDS; step += 1) {
    sim.update(FIXED_STEP_SECONDS, STILL);
    const opponents = sim.opponents;
    if (!opponents) continue;
    rivalCount = Math.max(rivalCount, opponents.opponents.length);
    for (const rival of opponents.opponents) {
      const index = world.lanes.byId.get(rival.driver.route.laneId)?.laneIndex ?? -1;
      const previous = lastIndex.get(rival.id);
      if (previous !== undefined && previous !== index) {
        changes.set(rival.id, [...(changes.get(rival.id) ?? []), step]);
      }
      lastIndex.set(rival.id, index);
    }
  }
  race.cancel();
  return { changes, rivalCount };
}

describe('race overtaking', () => {
  const run = runSprint();
  const cooldownSteps = Math.round(RACE_CONFIG.overtake.cooldownSeconds / FIXED_STEP_SECONDS);

  it('at least one held-up rival changes to the neighbouring lane during a sprint', () => {
    expect(run.rivalCount).toBe(SPRINT_EASTSIDE.opponentCount);
    const total = [...run.changes.values()].reduce((sum, steps) => sum + steps.length, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('no rival swaps back and forth: at most three changes in the race', () => {
    for (const [id, steps] of run.changes) expect(steps.length, `rival ${id}`).toBeLessThanOrEqual(3);
  });

  it('a rival waits the cooldown between two changes', () => {
    for (const [id, steps] of run.changes) {
      for (let i = 1; i < steps.length; i += 1) {
        expect(steps[i]! - steps[i - 1]!, `rival ${id}`).toBeGreaterThanOrEqual(cooldownSteps);
      }
    }
  });
});
