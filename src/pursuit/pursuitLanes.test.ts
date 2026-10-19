/*
 * Police use the road's four lanes (two forward, two reverse). A new unit prefers a lane no other unit uses, so the units
 * spread over the lanes instead of stacking on one. The preference is soft: when every lane is taken, a unit still
 * deploys. Tests use the real city road.
 */
import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { GameSimulation } from '../engine/gameSimulation';
import { createTrafficRuntime, playerFootprintFromConfig } from '../traffic/trafficRuntime';
import { getWorldDefinition } from '../world/worlds';
import { chooseDeployment, type DeployRules } from './deployment';
import { PursuitController } from './pursuitController';

const RULES: DeployRules = {
  minDistanceMeters: 40,
  maxDistanceMeters: 120,
  preferredDistanceMeters: 70,
  forbiddenAheadRadians: 1.2,
  preferredOutOfViewRadians: 2.0,
  clearanceMeters: 1,
  sampleStepMeters: 5,
};

function cityWorld() {
  const world = getWorldDefinition('city');
  if (!world.network || !world.lanes) throw new Error('city world has no network');
  return world;
}

describe('police deployment spreads over the lanes', () => {
  const world = cityWorld();
  const player = { x: world.spawn.position.x, z: world.spawn.position.z, yaw: world.spawn.yawRadians };
  const request = { graph: world.lanes!, player, bodies: [], footprint: { rearMeters: 2.5, frontMeters: 2.5, halfWidthMeters: 1 }, rules: RULES, period: null };

  it('a unit placed where another already is goes to a different lane, when one fits', () => {
    const first = chooseDeployment(request);
    expect(first).not.toBeNull();
    const second = chooseDeployment({ ...request, usedLaneIds: new Set([first!.laneId]) });
    expect(second).not.toBeNull();
    expect(second!.laneId).not.toBe(first!.laneId);
  });

  it('without a used lane, the choice is the same as before (the preference only ever changes a tie of lanes)', () => {
    const plain = chooseDeployment(request);
    const emptySet = chooseDeployment({ ...request, usedLaneIds: new Set<string>() });
    expect(emptySet).toEqual(plain);
  });

  it('when every nearby lane is used, a unit still deploys on one of them', () => {
    const first = chooseDeployment(request);
    const everyLane = new Set(world.lanes!.lanes.map((lane) => lane.id));
    const forced = chooseDeployment({ ...request, usedLaneIds: everyLane });
    expect(forced).not.toBeNull();
    expect(first).not.toBeNull();
  });
});

describe('the patrols are on different lanes', () => {
  it('the two patrols of the city pursuit are placed on two different lanes', () => {
    const world = cityWorld();
    const footprint = playerFootprintFromConfig(VEHICLE_CONFIG);
    const traffic = createTrafficRuntime(world.network!, world.lanes!, world.boundary, world.trafficScenario, footprint, world.ambient);
    const pursuit = new PursuitController({
      graph: world.lanes!,
      boundary: world.boundary,
      traffic: traffic.system,
      playerFootprint: { rearMeters: footprint.rearMeters, frontMeters: footprint.noseMeters, halfWidthMeters: footprint.halfWidthMeters },
      spawn: { x: world.spawn.position.x, z: world.spawn.position.z, yaw: world.spawn.yawRadians },
    });
    const sim = new GameSimulation(VEHICLE_CONFIG, { spawn: world.spawn, boundary: world.boundary, traffic, opponents: null, recoveryLanes: world.lanes!.lanes, devReset: world.devReset, pursuit });
    for (let i = 0; i < 2; i += 1) sim.update(FIXED_STEP_SECONDS, { steer: 0, throttle: 0, brake: 0, handbrake: 0 });
    const active = pursuit.police.opponents.filter((opponent) => pursuit.police.isActive(opponent.id));
    expect(active.length).toBeGreaterThanOrEqual(2);
    const lanes = new Set(active.map((opponent) => opponent.spec.laneId));
    expect(lanes.size).toBe(active.length);
  });
});
