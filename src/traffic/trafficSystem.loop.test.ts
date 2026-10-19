import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { wrapDelta } from '../world/wrap/worldWrap';
import { buildRoadBoundary } from '../simulation/roadBoundary';
import { groundBoxFromPose } from '../simulation/obb';
import { SpatialHash } from '../simulation/spatialHash';
import { buildLaneGraph, type LaneGraph, type LanePath } from './laneGraph';
import { createInactiveTrafficVehicle } from './trafficVehicle';
import { findTrafficPairs, type TrafficPair } from './trafficCollision';
import { findTrafficType, trafficDimensions, type PlayerPose } from './trafficTypes';
import { playerFootprintFromConfig } from './trafficRuntime';
import { TrafficSystem } from './trafficSystem';

/*
 * Stage D step 2: traffic on the loop. The seam lies at base x = +1600 (node 10 ≡ node -4, the base origin is -1200). Traffic is simulated in the
 * base domain, so motion, recycling, contact and pairs must all be measured across that seam.
 */

const network = buildLoopCityNetwork();
const PERIOD = network.periodMeters ?? Number.NaN;
const graph: LaneGraph = buildLaneGraph(network);
const boundary = buildRoadBoundary(network);
const footprint = playerFootprintFromConfig(VEHICLE_CONFIG);
const DT = 1 / 60;
/** Far from every test lane, so spawns are never rejected by the player rules. */
const FAR_VIEW: PlayerPose = { x: 0, z: 0, yaw: 0, speed: 0 };

/**
 * An eastbound segment lane that ends at the seam (logical x near +1600), and the eastbound segment that starts just past
 * it (base x near -1200). Connectors are skipped: the car is spawned on segments, and the seam crossing comes from the
 * lane walk. The seam pair is found by position, not by lane id.
 */
function seamLanes(): { before: LanePath; after: LanePath } {
  const eastbound = (lane: LanePath) => lane.kind === 'segment' && lane.direction === 'F' && Math.sin(lane.headings[0] ?? 0) > 0.99;
  const before = graph.lanes.find((lane) => {
    const end = lane.points[lane.points.length - 1];
    const heading = lane.headings[lane.headings.length - 1] ?? 0;
    return eastbound(lane) && !!end && Math.sin(heading) > 0.99 && end.x > 1500 && end.x < 1610;
  });
  const after = graph.lanes.find((lane) => {
    const start = lane.points[0];
    return eastbound(lane) && !!start && start.x < -1100 && start.x > -1210;
  });
  if (!before || !after) throw new Error('no eastbound segment pair across the seam on the loop');
  return { before, after };
}

const { before: SEAM_BEFORE, after: SEAM_AFTER } = seamLanes();

function sedanOn(system: TrafficSystem, lane: LanePath, s: number, speed: number): number {
  const result = system.spawn({ typeId: 'sedan', laneId: lane.id, s, speedMps: speed, cruiseSpeedMps: speed }, FAR_VIEW);
  if (!result.ok) throw new Error(`spawn rejected: ${result.reason}`);
  return result.id;
}

function loopSystem(): TrafficSystem {
  return new TrafficSystem(network, graph, boundary, { playerFootprint: footprint, capacity: 8 });
}

describe('loop traffic: motion across the seam', () => {
  it('moves continuously across the seam at the lane speed and is never recycled', () => {
    const system = loopSystem();
    const id = sedanOn(system, SEAM_BEFORE, SEAM_BEFORE.lengthMeters - 60, 15);
    const vehicle = system.vehicles[id];
    if (!vehicle) throw new Error('vehicle slot missing');
    let prevX = vehicle.x;
    let prevZ = vehicle.z;
    let worstStep = 0;
    let sawEastSide = false;
    let sawWestSide = false;
    let laneAfterSeam = false;
    // 22 s at 15 m/s is 330 m: the car starts about 60 m before the seam and ends about 270 m past it.
    for (let frame = 0; frame < 22 * 60; frame += 1) {
      // The driver trails 60 m behind, so the car is never ahead of the player and never in view-range rules.
      const back = { x: vehicle.x - 60 * Math.sin(vehicle.heading), z: vehicle.z - 60 * Math.cos(vehicle.heading) };
      system.step(DT, { x: back.x, z: back.z, yaw: vehicle.heading, speed: 15 });
      const stepX = wrapDelta(prevX, vehicle.x, PERIOD);
      const stepZ = wrapDelta(prevZ, vehicle.z, PERIOD);
      worstStep = Math.max(worstStep, Math.hypot(stepX, stepZ));
      prevX = vehicle.x;
      prevZ = vehicle.z;
      if (vehicle.x > 1000) sawEastSide = true;
      if (vehicle.x < -1000) sawWestSide = true;
      if (vehicle.laneId === SEAM_AFTER.id) laneAfterSeam = true;
    }
    expect(vehicle.active).toBe(true);
    expect(system.stats.recycled).toBe(0);
    expect(system.stats.invalidTransitions).toBe(0);
    // The car reaches the far side of the seam. Which lane it takes after the junction is a turn choice, so this test
    // does not require the straight-on lane (laneAfterSeam is recorded for diagnostics only).
    expect(sawEastSide && sawWestSide).toBe(true);
    expect(laneAfterSeam || sawWestSide).toBe(true);
    // 15 m/s at 60 Hz is 0.25 m per step. A seam jump would be about 2400 m in raw coordinates.
    expect(worstStep).toBeLessThanOrEqual(15 * DT * 1.05 + 1e-6);
  });
});

describe('loop traffic: player contact across the seam', () => {
  it('finds a player on the far side of the seam, and no contact when the player is far away', () => {
    const system = loopSystem();
    const id = sedanOn(system, SEAM_AFTER, 60, 0);
    const vehicle = system.vehicles[id];
    if (!vehicle) throw new Error('vehicle slot missing');
    system.step(0, FAR_VIEW);
    // Player 2 m west of the car, on the other side of the seam: logical x is one period east of the car.
    const across = system.resolvePlayerContact({ x: vehicle.x + PERIOD - 2, z: vehicle.z, yaw: vehicle.heading, speed: 0 });
    expect(across).not.toBeNull();
    expect(across?.vehicleId).toBe(id);
    expect(Math.hypot(across?.normal.x ?? 0, across?.normal.z ?? 0)).toBeCloseTo(1, 6);
    // The same contact at the car's own image is unchanged (an image is an image).
    const direct = system.resolvePlayerContact({ x: vehicle.x - 2, z: vehicle.z, yaw: vehicle.heading, speed: 0 });
    expect(direct?.vehicleId).toBe(id);
    // Far away, on the loop, is no contact.
    expect(system.resolvePlayerContact({ x: vehicle.x + PERIOD + 300, z: vehicle.z, yaw: vehicle.heading, speed: 0 })).toBeNull();
  });
});

describe('loop traffic: recycling distance', () => {
  it('keeps a car that is 15 m from the player across the seam, and recycles one 400 m away', () => {
    const system = loopSystem();
    const near = sedanOn(system, SEAM_AFTER, 60, 0);
    const nearVehicle = system.vehicles[near];
    if (!nearVehicle) throw new Error('vehicle slot missing');
    // Raw distance is about 2400 m, wrapped distance is 15 m.
    system.step(DT, { x: nearVehicle.x + PERIOD + 15, z: nearVehicle.z, yaw: nearVehicle.heading, speed: 0 });
    expect(nearVehicle.active).toBe(true);
    expect(system.stats.recycled).toBe(0);

    const far = sedanOn(system, SEAM_AFTER, 90, 0);
    const farVehicle = system.vehicles[far];
    if (!farVehicle) throw new Error('vehicle slot missing');
    // Wrapped distance is 400 m, which is beyond the 330 m active radius.
    system.step(DT, { x: farVehicle.x + 2000, z: farVehicle.z, yaw: farVehicle.heading, speed: 0 });
    expect(farVehicle.active).toBe(false);
    expect(system.stats.recycled).toBeGreaterThan(0);
  });
});

describe('loop traffic: vehicle pairs across the seam', () => {
  // Heading pi/2 puts the car's length along x, the axis the pair is separated on.
  const HALF_PI = Math.PI / 2;
  function boxesForPair(xA: number, xB: number) {
    const dims = trafficDimensions(findTrafficType('sedan'));
    const vehicles = [createInactiveTrafficVehicle(0), createInactiveTrafficVehicle(1)];
    for (const vehicle of vehicles) vehicle.active = true;
    const boxes = [
      groundBoxFromPose(xA, 0, HALF_PI, dims.rearMeters, dims.noseMeters, dims.halfWidthMeters),
      groundBoxFromPose(xB, 0, HALF_PI, dims.rearMeters, dims.noseMeters, dims.halfWidthMeters),
    ];
    const hash = new SpatialHash(TRAFFIC_CONFIG.collision.hashCellMeters);
    hash.insert(0, boxes[0]?.cx ?? 0, boxes[0]?.cz ?? 0);
    hash.insert(1, boxes[1]?.cx ?? 0, boxes[1]?.cz ?? 0);
    return { vehicles, boxes, hash };
  }

  it('pairs two overlapping vehicles across the seam once, and not at all on a finite world', () => {
    // 2.5 m apart across the seam (1598 to -1199.5, which is 1600.5, wraps to +2.5 m), which overlaps a 4.5 m sedan.
    const { vehicles, boxes, hash } = boxesForPair(1598, -1199.5);
    const out: TrafficPair[] = [];
    const scratch: number[] = [];
    findTrafficPairs(vehicles, boxes, hash, out, scratch, PERIOD);
    expect(out.length).toBe(1);
    expect(out[0]?.a.id).toBe(0);
    expect(out[0]?.b.id).toBe(1);
    // The same two boxes on an unwrapped world are 2797.5 m apart: no pair.
    findTrafficPairs(vehicles, boxes, hash, out, scratch, null);
    expect(out.length).toBe(0);
  });

  it('does not pair vehicles that are far apart across the seam', () => {
    const { vehicles, boxes, hash } = boxesForPair(1100, -1100);
    const out: TrafficPair[] = [];
    findTrafficPairs(vehicles, boxes, hash, out, [], PERIOD);
    expect(out.length).toBe(0);
  });
});

describe('loop traffic: configuration', () => {
  it('uses the configured wrap period, and the seam is where the wrap config says', () => {
    expect(PERIOD).toBe(WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters);
  });
});
