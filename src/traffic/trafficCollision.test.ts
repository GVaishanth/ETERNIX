import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { GameSimulation } from '../engine/gameSimulation';
import { createVehicleState } from '../simulation/vehicle';
import { buildRoadBoundary } from '../simulation/roadBoundary';
import { groundBoxFromPose, groundBoxOverlap } from '../simulation/obb';
import { applyVehicleContact } from '../simulation/vehicleContact';
import { SpatialHash } from '../simulation/spatialHash';
import { buildCircuitNetwork } from '../world/circuitNetwork';
import { buildLaneGraph } from './laneGraph';
import { ContactLog } from './contactLog';
import { createTrafficRuntime, playerFootprintFromConfig } from './trafficRuntime';
import { findTrafficType, trafficDimensions, type PlayerPose } from './trafficTypes';
import { vehicleBox } from './trafficCollision';
import type { TrafficSystem } from './trafficSystem';

const network = buildCircuitNetwork();
const graph = buildLaneGraph(network);
const boundary = buildRoadBoundary(network);
const footprint = playerFootprintFromConfig(VEHICLE_CONFIG);
/** Spawn-time pose: far behind the test lanes, facing away, so spawns are never rejected by the player rules. */
const SPAWN_VIEW: PlayerPose = { x: -180, z: 0, yaw: Math.PI, speed: 0 };

function sedan(system: TrafficSystem, laneId: string, s: number, speed: number, cruise: number) {
  return system.spawn({ typeId: 'sedan', laneId, s, speedMps: speed, cruiseSpeedMps: cruise }, SPAWN_VIEW);
}

describe('spatial hash (step 6)', () => {
  it('returns every point within the query radius (superset of the exact answer)', () => {
    const hash = new SpatialHash(8);
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const points = Array.from({ length: 200 }, (_unused, id) => ({ id, x: (random() - 0.5) * 400, z: (random() - 0.5) * 400 }));
    for (const p of points) hash.insert(p.id, p.x, p.z);
    for (let trial = 0; trial < 50; trial += 1) {
      const qx = (random() - 0.5) * 400;
      const qz = (random() - 0.5) * 400;
      const radius = 7;
      const found = new Set<number>();
      const out: number[] = [];
      hash.query(qx, qz, radius, out);
      for (const id of out) found.add(id);
      for (const p of points) {
        if (Math.hypot(p.x - qx, p.z - qz) <= radius) expect(found.has(p.id), `point ${p.id} near (${qx},${qz})`).toBe(true);
      }
    }
  });

  it('clears without freeing and reuses its cells', () => {
    const hash = new SpatialHash(8);
    hash.insert(1, 0, 0);
    hash.clear();
    const out: number[] = [];
    hash.query(0, 0, 4, out);
    expect(out).toEqual([]);
    hash.insert(2, 0, 0);
    hash.query(0, 0, 4, out);
    expect(out).toEqual([2]);
  });
});

describe('contact response (step 6): corrections only', () => {
  const base = createVehicleState({ x: 0, y: 0, z: 0 }, 0);
  const moving = { ...base, speed: 10, lateralSpeed: 0 };

  it('pushes the car out along the normal and removes the approach component', () => {
    const next = applyVehicleContact(moving, { x: 0, z: -0.3 }, { x: 0, z: -1 }, { x: 0, z: 0 });
    expect(next.position.z).toBeCloseTo(-0.3, 9);
    expect(next.speed).toBeCloseTo(0, 9);
  });

  it('never adds speed, and keeps the tangential component', () => {
    // Driving diagonally into a wall with normal +X: the normal part goes, the forward part stays.
    const state = { ...base, speed: 10, lateralSpeed: 0, yaw: Math.PI / 4 };
    const next = applyVehicleContact(state, { x: -0.1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 0 });
    const before = Math.hypot(10, 0);
    const after = Math.hypot(next.speed, next.lateralSpeed);
    expect(after).toBeLessThanOrEqual(before + 1e-9);
    expect(after).toBeGreaterThan(0);
  });

  it('does not change yaw or steering, and does not pull a separating car back', () => {
    const state = { ...base, speed: 5, yaw: 0.7, steerAngle: 0.3 };
    const separating = applyVehicleContact(state, { x: 0, z: 0 }, { x: 0, z: 1 }, { x: 0, z: 0 });
    expect(separating.speed).toBeCloseTo(5, 9);
    expect(separating.yaw).toBe(0.7);
    expect(separating.steerAngle).toBe(0.3);
  });
});

describe('contact log: each event recorded once, with ids', () => {
  it('counts a continuing contact once, and counts a new one after it ends', () => {
    const log = new ContactLog(10);
    expect(log.touch('player-traffic', 'player', '3')).toBe(true);
    log.endStep();
    expect(log.touch('player-traffic', 'player', '3')).toBe(false);
    log.endStep();
    log.endStep();
    expect(log.touch('player-traffic', 'player', '3')).toBe(true);
    expect(log.counts['player-traffic']).toBe(2);
    expect(log.recent[0]?.b).toBe('3');
  });

  it('drops old events beyond its capacity', () => {
    const log = new ContactLog(2);
    for (let i = 0; i < 4; i += 1) {
      log.touch('traffic-boundary', String(i), null);
      log.endStep();
    }
    expect(log.recent.length).toBe(2);
    expect(log.counts['traffic-boundary']).toBe(4);
  });
});

describe('player against traffic (step 6)', () => {
  it('stops the player at a stopped car, without overlap, reversal, or added speed, and records one contact', () => {
    const traffic = createTrafficRuntime(network, graph, boundary, [], footprint);
    const parked = sedan(traffic.system, 'S1:F:0', 100, 0, 0);
    expect(parked.ok).toBe(true);
    const sim = new GameSimulation(VEHICLE_CONFIG, {
      spawn: { position: { x: 1.8, y: 0, z: 0 }, yawRadians: 0 },
      boundary,
      traffic,
    });
    let maxOverlapDepth = 0;
    let maxYaw = 0;
    let maxSpeedAfterContact = 0;
    let contactSeen = false;
    for (let step = 0; step < 60 * 15; step += 1) {
      sim.update(FIXED_STEP_SECONDS, { steer: 0, throttle: 1, brake: 0, handbrake: 0 });
      const state = sim.state;
      maxYaw = Math.max(maxYaw, Math.abs(state.yaw));
      const playerBox = groundBoxFromPose(state.position.x, state.position.z, state.yaw, footprint.rearMeters, footprint.noseMeters, footprint.halfWidthMeters);
      for (const vehicle of traffic.system.vehicles) {
        const box = vehicle.active ? vehicleBox(vehicle) : null;
        if (!box) continue;
        const overlap = groundBoxOverlap(playerBox, box);
        if (overlap.overlapping) maxOverlapDepth = Math.max(maxOverlapDepth, overlap.depthMeters);
      }
      if (traffic.system.contacts.counts['player-traffic'] > 0) {
        contactSeen = true;
        maxSpeedAfterContact = Math.max(maxSpeedAfterContact, state.speed);
      }
      if (!Number.isFinite(state.position.x) || !Number.isFinite(state.speed)) throw new Error('non-finite state');
    }
    expect(contactSeen).toBe(true);
    // The player may penetrate by at most one step's push (0.5 m) before it is corrected, and only for one step.
    expect(maxOverlapDepth).toBeLessThanOrEqual(TRAFFIC_CONFIG.collision.maxPlayerPushPerStepMeters + 1e-6);
    // Straight-on hit: the approach component is removed, so the car is stopped against the car and does not bounce.
    expect(maxSpeedAfterContact).toBeLessThan(2);
    expect(maxYaw).toBeLessThan(1e-9);
    // One contact event for one collision, however many steps the overlap lasts.
    expect(traffic.system.contacts.counts['player-traffic']).toBe(1);
    expect(traffic.system.contacts.recent[0]).toMatchObject({ kind: 'player-traffic', a: 'player' });
  });
});

describe('traffic against traffic (step 6)', () => {
  it('pulls an overlapping follower back along its lane and caps its speed, recording one contact', () => {
    const traffic = createTrafficRuntime(network, graph, boundary, [], footprint);
    const leader = sedan(traffic.system, 'S1:F:0', 100, 5, 5);
    const follower = sedan(traffic.system, 'S1:F:0', 60, 12, 14);
    expect(leader.ok && follower.ok).toBe(true);
    if (!leader.ok || !follower.ok) return;
    // Force an overlap that spawning would never allow, to test the correction.
    const vehicle = traffic.system.vehicles[follower.id];
    if (!vehicle) throw new Error('missing vehicle');
    vehicle.s = 100 - trafficDimensions(findTrafficType('sedan')).noseMeters + 0.5;
    traffic.system.vehicles[follower.id] = vehicle;
    const playerFar: PlayerPose = { x: -180, z: 0, yaw: Math.PI, speed: 0 };
    traffic.system.step(FIXED_STEP_SECONDS, playerFar);
    expect(traffic.system.contacts.counts['traffic-traffic']).toBe(1);
    const a = traffic.system.vehicles[leader.id];
    const b = traffic.system.vehicles[follower.id];
    if (!a || !b) throw new Error('missing vehicle');
    const boxA = vehicleBox(a);
    const boxB = vehicleBox(b);
    if (!boxA || !boxB) throw new Error('missing box');
    expect(groundBoxOverlap(boxA, boxB).overlapping).toBe(false);
    expect(b.speed).toBeLessThanOrEqual(a.speed + 1e-6);
    expect(traffic.system.stats.invalidTransitions).toBe(0);
  });
});

describe('obstacle response and stalls (step 7)', () => {
  it('brakes for a stopped player car in its lane, and recycles it after it stays stopped too long', () => {
    const traffic = createTrafficRuntime(network, graph, boundary, [], footprint);
    const sim = new GameSimulation(VEHICLE_CONFIG, {
      spawn: { position: { x: 1.8, y: 0, z: 120 }, yawRadians: 0 },
      boundary,
      traffic,
    });
    // The player stays stopped at s=120. A car spawns 100 m behind it, at 12 m/s.
    const approaching = sedan(traffic.system, 'S1:F:0', 20, 12, 15);
    expect(approaching.ok).toBe(true);
    if (!approaching.ok) return;

    let overlapFrames = 0;
    let sawPlayerLeader = false;
    let minGap = Number.POSITIVE_INFINITY;
    for (let step = 0; step < 60 * 40; step += 1) {
      sim.update(FIXED_STEP_SECONDS, { steer: 0, throttle: 0, brake: 0, handbrake: 0 });
      const vehicle = traffic.system.vehicles[approaching.id];
      if (vehicle?.active && vehicle.leaderIsPlayer) {
        sawPlayerLeader = true;
        if (vehicle.leaderGapMeters !== null) minGap = Math.min(minGap, vehicle.leaderGapMeters);
      }
      const state = sim.state;
      const playerBox = groundBoxFromPose(state.position.x, state.position.z, state.yaw, footprint.rearMeters, footprint.noseMeters, footprint.halfWidthMeters);
      const box = vehicle?.active ? vehicleBox(vehicle) : null;
      if (box && groundBoxOverlap(playerBox, box).overlapping && groundBoxOverlap(playerBox, box).depthMeters > 0.5) overlapFrames += 1;
    }
    expect(sawPlayerLeader).toBe(true);
    expect(minGap).toBeGreaterThan(-0.01);
    expect(overlapFrames).toBe(0);
    // Stopped behind the player for more than the stall time: recycled, so the queue cannot stay forever.
    expect(traffic.system.stats.stallRecycled).toBeGreaterThanOrEqual(1);
    expect(traffic.system.vehicles[approaching.id]?.active).toBe(false);
  });

  it('keeps no traffic on the road in a normal free run: no boundary contacts', () => {
    const traffic = createTrafficRuntime(network, graph, boundary, [], footprint);
    sedan(traffic.system, 'S1:F:0', 40, 12, 15);
    sedan(traffic.system, 'T1:F:0', 40, 10, 14);
    for (let step = 0; step < 60 * 60; step += 1) traffic.system.step(FIXED_STEP_SECONDS, SPAWN_VIEW);
    expect(traffic.system.contacts.counts['traffic-boundary']).toBe(0);
    expect(traffic.system.contacts.counts['traffic-traffic']).toBe(0);
  });
});
