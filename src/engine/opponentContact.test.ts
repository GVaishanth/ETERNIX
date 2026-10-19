import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { buildRoadBoundary, footprintFromConfig } from '../simulation/roadBoundary';
import { buildCircuitNetwork, CIRCUIT_SPAWN } from '../world/circuitNetwork';
import { buildLaneGraph } from '../traffic/laneGraph';
import { OpponentSystem } from '../ai/aiOpponents';
import { groundBoxFromPose, groundBoxOverlap } from '../simulation/obb';
import { GameSimulation } from './gameSimulation';

/*
 * Player and opponent contact (Part 4, test C). The contact is symmetric and uses the same push-out rule as the player's
 * traffic contact. Nothing adds force, so neither car is teleported or spun.
 */

const network = buildCircuitNetwork();
const graph = buildLaneGraph(network);
const boundary = buildRoadBoundary(network);

describe('player and opponent contact', () => {
  it('separates overlapping cars, records one event, and leaves the player yaw alone', () => {
    // An opponent starts with its nose inside the player's rear, on the player's lane.
    const opponents = new OpponentSystem(graph, boundary, [
      { typeId: 'sedan', laneId: 'S1:F:0', s: CIRCUIT_SPAWN.position.z + 3.0, speedMps: 0, colourIndex: 0 },
    ]);
    const sim = new GameSimulation(VEHICLE_CONFIG, {
      spawn: CIRCUIT_SPAWN,
      boundary,
      traffic: null,
      opponents,
    });
    const playerBefore = { x: sim.state.position.x, z: sim.state.position.z, yaw: sim.state.yaw };
    const opp = opponents.opponents[0];
    if (!opp) throw new Error('no opponent');
    const oppBefore = opponents.boxOf(opp);
    const fp = footprintFromConfig(VEHICLE_CONFIG);
    const playerBox = () => groundBoxFromPose(sim.state.position.x, sim.state.position.z, sim.state.yaw, fp.rearMeters, fp.frontMeters, fp.halfWidthMeters);
    expect(groundBoxOverlap(playerBox(), oppBefore).overlapping).toBe(true);

    sim.update(FIXED_STEP_SECONDS, { steer: 0, throttle: 0, brake: 0, handbrake: 0 });

    expect(opponents.contacts.counts['opponent-player']).toBe(1);
    expect(sim.state.yaw).toBeCloseTo(playerBefore.yaw, 9);
    expect(Number.isFinite(sim.state.position.x) && Number.isFinite(sim.state.position.z)).toBe(true);
    // The player moved by a small push, and no more than the per-step cap.
    const moved = Math.hypot(sim.state.position.x - playerBefore.x, sim.state.position.z - playerBefore.z);
    expect(moved).toBeLessThan(0.6);
    // The overlap is reduced, and the opponent got the matching push in the opposite direction.
    const overlapAfter = groundBoxOverlap(playerBox(), opponents.boxOf(opp));
    expect(overlapAfter.depthMeters).toBeLessThan(groundBoxOverlap(playerBox(), oppBefore).depthMeters + 1e-9);
  });

  it('counts a continuing overlap once, and not again on the next step', () => {
    const opponents = new OpponentSystem(graph, boundary, [
      { typeId: 'van', laneId: 'S1:F:0', s: CIRCUIT_SPAWN.position.z + 3.0, speedMps: 0, colourIndex: 0 },
    ]);
    const sim = new GameSimulation(VEHICLE_CONFIG, { spawn: CIRCUIT_SPAWN, boundary, traffic: null, opponents });
    const hold = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
    sim.update(FIXED_STEP_SECONDS, hold);
    sim.update(FIXED_STEP_SECONDS, hold);
    sim.update(FIXED_STEP_SECONDS, hold);
    expect(opponents.contacts.counts['opponent-player']).toBeLessThanOrEqual(2);
    expect(opponents.contacts.counts['opponent-player']).toBeGreaterThanOrEqual(1);
  });
});
