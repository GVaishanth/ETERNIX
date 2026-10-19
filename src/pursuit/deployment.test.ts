import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, laneSample } from '../traffic/laneGraph';
import { findTrafficType, trafficDimensions } from '../traffic/trafficTypes';
import { groundBoxFromPose, groundBoxOverlap, type GroundBox } from '../simulation/obb';
import { chooseDeployment, boxAt, type DeployFootprint, type DeployRules } from './deployment';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { degToRad } from './testMath';

const graph = buildLaneGraph(buildCityNetwork());
const dims = trafficDimensions(findTrafficType('sedan'));
const footprint: DeployFootprint = { rearMeters: dims.rearMeters, frontMeters: dims.noseMeters, halfWidthMeters: dims.halfWidthMeters };
const rules: DeployRules = {
  minDistanceMeters: PURSUIT_CONFIG.deploy.minDistanceMeters,
  maxDistanceMeters: PURSUIT_CONFIG.deploy.maxDistanceMeters,
  preferredDistanceMeters: PURSUIT_CONFIG.deploy.preferredDistanceMeters,
  forbiddenAheadRadians: degToRad(PURSUIT_CONFIG.deploy.forbiddenAheadDegrees),
  preferredOutOfViewRadians: degToRad(PURSUIT_CONFIG.deploy.preferredOutOfViewDegrees),
  clearanceMeters: PURSUIT_CONFIG.deploy.clearanceMeters,
  sampleStepMeters: PURSUIT_CONFIG.deploy.sampleStepMeters,
};

// A player on a straight segment lane, heading down the lane.
const segmentLane = graph.lanes.filter((lane) => lane.kind === 'segment').sort((a, b) => b.lengthMeters - a.lengthMeters)[0]!;
const mid = laneSample(segmentLane, segmentLane.lengthMeters / 2);
const player = { x: mid.x, z: mid.z, yaw: mid.heading };
const playerBox = boxAt(player.x, player.z, player.yaw, footprint);

describe('police deployment', () => {
  it('finds a candidate in the distance band, on a segment lane, and not ahead of the player', () => {
    const candidate = chooseDeployment({ graph, player, bodies: [playerBox], footprint, rules });
    expect(candidate).not.toBeNull();
    const lane = graph.byId.get(candidate!.laneId)!;
    expect(lane.kind).toBe('segment');
    expect(candidate!.distanceMeters).toBeGreaterThanOrEqual(rules.minDistanceMeters);
    expect(candidate!.distanceMeters).toBeLessThanOrEqual(rules.maxDistanceMeters);
    const bearing = Math.abs(Math.atan2(Math.sin(Math.atan2(candidate!.x - player.x, candidate!.z - player.z) - player.yaw), Math.cos(Math.atan2(candidate!.x - player.x, candidate!.z - player.z) - player.yaw)));
    expect(bearing).toBeGreaterThanOrEqual(rules.forbiddenAheadRadians);
  });

  it('is deterministic for the same inputs', () => {
    const a = chooseDeployment({ graph, player, bodies: [playerBox], footprint, rules });
    const b = chooseDeployment({ graph, player, bodies: [playerBox], footprint, rules });
    expect(a).toEqual(b);
  });

  it('never returns a candidate that overlaps a body, and moves when the best spot is taken', () => {
    const first = chooseDeployment({ graph, player, bodies: [playerBox], footprint, rules })!;
    const taken: GroundBox = groundBoxFromPose(first.x, first.z, first.yaw, footprint.rearMeters, footprint.frontMeters, footprint.halfWidthMeters);
    const second = chooseDeployment({ graph, player, bodies: [playerBox, taken], footprint, rules });
    expect(second).not.toBeNull();
    const box = boxAt(second!.x, second!.z, second!.yaw, { ...footprint });
    expect(groundBoxOverlap(box, taken).overlapping).toBe(false);
    expect(groundBoxOverlap(box, playerBox).overlapping).toBe(false);
  });

  it('returns null when the rules cannot be met, so the caller postpones rather than forcing a spawn', () => {
    const impossible: DeployRules = { ...rules, minDistanceMeters: 100000, maxDistanceMeters: 100001 };
    expect(chooseDeployment({ graph, player, bodies: [playerBox], footprint, rules: impossible })).toBeNull();
  });
});
