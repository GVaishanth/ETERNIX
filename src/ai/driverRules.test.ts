import { describe, expect, it } from 'vitest';
import { AI_CONFIG } from '../config/aiConfig';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { buildCircuitNetwork } from '../world/circuitNetwork';
import { buildLaneGraph, laneSample, type LaneGraph } from '../traffic/laneGraph';
import { trafficDimensions, findTrafficType } from '../traffic/trafficTypes';
import { groundBoxFromPose } from '../simulation/obb';
import { createVehicleState } from '../simulation/vehicle';
import { rightFromYaw } from '../core/coordinates';
import type { VehicleState } from '../core/types';
import { AiDriver, DEFAULT_AI_DRIVER_RULES, type AiDriverRules, type AiObstacle } from './aiController';

/*
 * Driver rules and the speed cap (pursuit and race). The drivers run on the circuit lane graph with no mocks: each test
 * reads one decision from the real driver. A pursuing unit uses PURSUING_RULES (from PURSUIT_CONFIG.drive); a patrol and
 * a traffic car use the defaults (AI_CONFIG).
 */

const graph: LaneGraph = buildLaneGraph(buildCircuitNetwork());
const LANE = 'S1:F:0';
const CAP = 20;

/** The rules a pursuing unit runs under, built the way the pursuit controller builds them. */
const PURSUING: AiDriverRules = {
  respectObstacles: PURSUIT_CONFIG.drive.respectObstacles,
  curveLateralAccelMps2: PURSUIT_CONFIG.drive.curveLateralAccelMps2,
  easeWhenLost: PURSUIT_CONFIG.drive.easeWhenLost,
};

/** A vehicle state on the lane at `s`, aligned with the lane, offset `lateral` metres to the right, at `speed`. */
function stateOn(laneId: string, s: number, speed = 0, lateral = 0): VehicleState {
  const lane = graph.byId.get(laneId);
  if (!lane) throw new Error(`lane ${laneId}`);
  const pose = laneSample(lane, s);
  const right = rightFromYaw(pose.heading);
  const position = { x: pose.x + right.x * lateral, y: 0, z: pose.z + right.z * lateral };
  return { ...createVehicleState(position, pose.heading), speed };
}

/** A sedan parked on the lane `gap` metres ahead of `s`, as an obstacle the driver can see. */
function sedanAhead(laneId: string, s: number, gap: number): AiObstacle {
  const lane = graph.byId.get(laneId);
  if (!lane) throw new Error(`lane ${laneId}`);
  const pose = laneSample(lane, s + gap);
  const dims = trafficDimensions(findTrafficType('sedan'));
  return {
    key: 'traffic:test',
    box: groundBoxFromPose(pose.x, pose.z, pose.heading, dims.rearMeters, dims.noseMeters, dims.halfWidthMeters),
    speedMps: 0,
  };
}

describe('driving rules: the config is the pursuit difference', () => {
  it('pursuing units ignore obstacles, corner faster, and do not ease off when lost; traffic keeps the defaults', () => {
    expect(PURSUIT_CONFIG.drive.respectObstacles).toBe(false);
    expect(PURSUIT_CONFIG.drive.curveLateralAccelMps2).toBeGreaterThan(AI_CONFIG.curveLateralAccelMps2);
    expect(PURSUIT_CONFIG.drive.easeWhenLost).toBe(false);
    expect(DEFAULT_AI_DRIVER_RULES).toEqual({
      respectObstacles: true,
      curveLateralAccelMps2: AI_CONFIG.curveLateralAccelMps2,
      easeWhenLost: true,
    });
  });
});

describe('driver rules: obstacles', () => {
  it('a traffic driver brakes for an obstacle on the route, and a pursuing driver drives on past it', () => {
    const obstacle = sedanAhead(LANE, 20, 12);

    const traffic = new AiDriver(graph, LANE, 20, { speedCapMps: CAP });
    const held = traffic.decide(stateOn(LANE, 20, 14), [obstacle]);
    expect(held.obstacleGapMeters).not.toBeNull();
    expect(held.targetSpeedMps).toBeLessThan(CAP);

    const pursuer = new AiDriver(graph, LANE, 20, { speedCapMps: CAP, rules: PURSUING });
    const driven = pursuer.decide(stateOn(LANE, 20, 14), [obstacle]);
    expect(driven.obstacleGapMeters).toBeNull();
    expect(driven.targetSpeedMps).toBeCloseTo(CAP, 6);
  });
});

describe('driver rules: curves', () => {
  it('a pursuing driver takes a corner faster than a traffic driver, on the same road', () => {
    // Find a point on the circuit where the curve limit, not the lane limit, sets the traffic driver's speed.
    let found: { laneId: string; s: number } | null = null;
    for (const lane of graph.lanes) {
      for (let s = 5; s < lane.lengthMeters - 5 && found === null; s += 5) {
        const traffic = new AiDriver(graph, lane.id, s).decide(stateOn(lane.id, s, 0), []);
        if (traffic.targetSpeedMps < lane.speedLimitMps - 0.5) found = { laneId: lane.id, s };
      }
      if (found !== null) break;
    }
    expect(found, 'the circuit has a curve where the curve limit applies').not.toBeNull();
    const { laneId, s } = found!;

    const traffic = new AiDriver(graph, laneId, s).decide(stateOn(laneId, s, 0), []);
    const pursuer = new AiDriver(graph, laneId, s, { rules: PURSUING }).decide(stateOn(laneId, s, 0), []);
    expect(pursuer.targetSpeedMps).toBeGreaterThan(traffic.targetSpeedMps);
  });
});

describe('driver rules: losing the line', () => {
  it('a traffic driver far off the line crawls and reports lost; a pursuing driver keeps its speed', () => {
    const off = AI_CONFIG.lostLateralMeters + 2;
    const traffic = new AiDriver(graph, LANE, 20, { speedCapMps: CAP }).decide(stateOn(LANE, 20, 12, off), []);
    expect(traffic.state).toBe('lost');
    expect(traffic.targetSpeedMps).toBeLessThanOrEqual(AI_CONFIG.lostCrawlMps + 1e-9);

    const pursuer = new AiDriver(graph, LANE, 20, { speedCapMps: CAP, rules: PURSUING }).decide(stateOn(LANE, 20, 12, off), []);
    expect(pursuer.state).not.toBe('lost');
    expect(pursuer.state).not.toBe('recover');
    expect(pursuer.targetSpeedMps).toBeCloseTo(CAP, 6);
  });
});

describe('driver rules: the speed cap and the policy', () => {
  it('setSpeedCap changes only the cap: the route and the rules stay as they were', () => {
    const driver = new AiDriver(graph, LANE, 20, { speedCapMps: CAP, rules: PURSUING });
    const routeBefore = driver.route;
    driver.setSpeedCap(12);
    expect(driver.capMps).toBe(12);
    expect(driver.route).toEqual(routeBefore);
    expect(driver.drivingRules).toEqual(PURSUING);
    expect(driver.decide(stateOn(LANE, 20, 0), []).targetSpeedMps).toBeLessThanOrEqual(12 + 1e-9);

    driver.setSpeedCap(null);
    expect(driver.capMps).toBeNull();
    expect(driver.route).toEqual(routeBefore);
  });

  it('a policy with no rules falls back to the traffic rules, so a pursuing unit must pass its rules on every plan', () => {
    const driver = new AiDriver(graph, LANE, 20, { speedCapMps: CAP, rules: PURSUING });
    driver.setPolicy({ speedCapMps: CAP, rules: PURSUING });
    expect(driver.drivingRules).toEqual(PURSUING);
    driver.setPolicy({ speedCapMps: CAP });
    expect(driver.drivingRules).toEqual(DEFAULT_AI_DRIVER_RULES);
  });
});
