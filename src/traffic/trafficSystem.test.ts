import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { buildRoadBoundary } from '../simulation/roadBoundary';
import { buildCircuitNetwork } from '../world/circuitNetwork';
import { buildLaneGraph, laneSample } from './laneGraph';
import { groundBoxFromPose, groundBoxOverlap } from '../simulation/obb';
import { TrafficSystem, type PlayerPose, type SpawnRequest } from './trafficSystem';
import { findTrafficType, trafficDimensions, TRAFFIC_ROSTER } from './trafficTypes';

/*
 * Traffic system tests (Part 4). Node only: the same fixed step as the game, with no rendering.
 * The player is parked at the loop centre so that traffic never recycles unless a test asks for it.
 */

const network = buildCircuitNetwork();
const graph = buildLaneGraph(network);
const boundary = buildRoadBoundary(network);
const PLAYER_PARKED: PlayerPose = { x: -180, z: 100, yaw: 0, speed: 0 };
/** Player at the loop centre, facing -Z. Traffic on the test lanes is behind it, so no view-cone rule applies. */
const PLAYER_BEHIND_TRAFFIC: PlayerPose = { x: -180, z: 0, yaw: Math.PI, speed: 0 };
const playerFootprint = {
  rearMeters: VEHICLE_CONFIG.footprintRearMeters,
  noseMeters: VEHICLE_CONFIG.footprintFrontMeters,
  halfWidthMeters: VEHICLE_CONFIG.footprintHalfWidthMeters,
};

function createSystem(): TrafficSystem {
  return new TrafficSystem(network, graph, boundary, { playerFootprint });
}

function sedanRequest(laneId: string, s: number, speed: number, cruise: number): SpawnRequest {
  return { typeId: 'sedan', laneId, s, speedMps: speed, cruiseSpeedMps: cruise };
}

describe('traffic roster', () => {
  it('has at least one defined type with positive dimensions and a consistent footprint', () => {
    expect(TRAFFIC_ROSTER.length).toBeGreaterThan(0);
    for (const type of TRAFFIC_ROSTER) {
      expect(type.widthMeters).toBeGreaterThan(1);
      expect(type.rearOverhangMeters + type.wheelbaseMeters + type.frontOverhangMeters).toBeGreaterThan(3);
    }
  });
});

describe('single AI traffic vehicle (step 1)', () => {
  it('spawns on a valid lane at the lane start position, facing along the lane', () => {
    const system = createSystem();
    const result = system.spawn(sedanRequest('S1:F:0', 40, 12, 15), { ...PLAYER_PARKED, speed: 12 });
    expect(result.ok).toBe(true);
    const vehicle = system.vehicles[0];
    expect(vehicle?.active).toBe(true);
    expect(vehicle?.laneId).toBe('S1:F:0');
    expect(vehicle?.x).toBeCloseTo(1.8, 6);
    expect(vehicle?.heading).toBeCloseTo(0, 6);
  });

  it('accelerates smoothly toward its cruise speed on a free road', () => {
    const system = createSystem();
    system.spawn(sedanRequest('S1:F:0', 40, 12, 15), { ...PLAYER_PARKED, speed: 12 });
    let previous = 12;
    let maxJump = 0;
    for (let step = 0; step < 60 * 10; step += 1) {
      system.step(FIXED_STEP_SECONDS, PLAYER_PARKED);
      const speed = system.vehicles[0]?.speed ?? 0;
      maxJump = Math.max(maxJump, Math.abs(speed - previous));
      previous = speed;
    }
    expect(previous).toBeGreaterThan(14.5);
    expect(previous).toBeLessThanOrEqual(15.0 + 1e-6);
    // Gradual: no step changes speed by more than the comfortable acceleration allows, times the step.
    expect(maxJump).toBeLessThan(2.1 * FIXED_STEP_SECONDS + 1e-6);
  });

  it('stays exactly on its lane: its position equals the lane sample at its arc length, every step', () => {
    const system = createSystem();
    system.spawn(sedanRequest('S1:F:0', 40, 12, 15), { ...PLAYER_PARKED, speed: 12 });
    for (let step = 0; step < 60 * 30; step += 1) {
      system.step(FIXED_STEP_SECONDS, PLAYER_PARKED);
      const vehicle = system.vehicles[0];
      if (!vehicle?.laneId) throw new Error('vehicle lost its lane');
      const lane = graph.byId.get(vehicle.laneId);
      if (!lane) throw new Error(`unknown lane ${vehicle.laneId}`);
      const pose = laneSample(lane, vehicle.s);
      expect(Math.hypot(vehicle.x - pose.x, vehicle.z - pose.z), `step ${step}`).toBeLessThan(1e-9);
    }
    expect(system.stats.invalidTransitions).toBe(0);
  });

  it('travels around the curve and through the junction, keeping its heading aligned with the lane tangent', () => {
    const system = createSystem();
    system.spawn(sedanRequest('S1:F:0', 40, 12, 15), { ...PLAYER_PARKED, speed: 12 });
    const seen = new Set<string>();
    let worstHeadingError = 0;
    let worstStepDistance = 0;
    let previousX = 1.8;
    let previousZ = 40;
    for (let step = 0; step < 60 * 180; step += 1) {
      system.step(FIXED_STEP_SECONDS, PLAYER_PARKED);
      const vehicle = system.vehicles[0];
      if (!vehicle?.laneId) throw new Error('vehicle lost its lane');
      seen.add(vehicle.laneId);
      const lane = graph.byId.get(vehicle.laneId);
      if (!lane) throw new Error('unknown lane');
      const tangent = laneSample(lane, vehicle.s).heading;
      worstHeadingError = Math.max(worstHeadingError, Math.abs(vehicle.heading - tangent));
      // No teleporting: the move per step must match the distance travelled. The 1 cm allowance covers linear
      // interpolation along the 1 m lane samples. A teleport would be metres, not centimetres.
      const moved = Math.hypot(vehicle.x - previousX, vehicle.z - previousZ);
      worstStepDistance = Math.max(worstStepDistance, moved - vehicle.speed * FIXED_STEP_SECONDS);
      previousX = vehicle.x;
      previousZ = vehicle.z;
    }
    for (const id of ['S1:F:0', 'T1:F:0', 'S2a:F:0', 'J1:east>west:0', 'S2b:F:0', 'T2:F:0', 'S3:F:0', 'T3:F:0', 'S4:F:0', 'T4:F:0']) {
      expect(seen.has(id), `visited ${id}`).toBe(true);
    }
    expect(worstHeadingError).toBeLessThan(0.02);
    expect(worstStepDistance).toBeLessThan(0.01);
    expect(system.stats.invalidTransitions).toBe(0);
  });
});

describe('spawn validation (step 2)', () => {
  const PLAYER_AT_LANE_START: PlayerPose = { x: 1.8, z: 0, yaw: 0, speed: 0 };

  it('rejects unknown lanes and junction connector lanes by name', () => {
    const system = createSystem();
    expect(system.spawn(sedanRequest('NOPE:F:0', 10, 10, 15), PLAYER_PARKED)).toEqual({ ok: false, reason: 'unknown-lane' });
    expect(system.spawn(sedanRequest('J1:east>west:0', 5, 10, 15), PLAYER_PARKED)).toEqual({ ok: false, reason: 'connector-lane' });
  });

  it('rejects positions that would put the vehicle off the end of its lane', () => {
    const system = createSystem();
    expect(system.spawn(sedanRequest('S1:F:0', 0.1, 10, 15), PLAYER_PARKED)).toEqual({ ok: false, reason: 'lane-end' });
    expect(system.spawn(sedanRequest('S1:F:0', 199.5, 10, 15), PLAYER_PARKED)).toEqual({ ok: false, reason: 'lane-end' });
  });

  it('rejects overlap with the player and never forces the spawn', () => {
    const system = createSystem();
    const result = system.spawn(sedanRequest('S1:F:0', 3, 0, 15), PLAYER_AT_LANE_START);
    expect(result).toEqual({ ok: false, reason: 'overlap-player' });
    expect(system.activeCount).toBe(0);
  });

  it('never spawns directly ahead of the player inside the view cone', () => {
    const system = createSystem();
    // The player faces +Z at the start of S1. A spawn 120 m ahead is inside the forward view range.
    const result = system.spawn(sedanRequest('S1:F:0', 120, 12, 15), { x: 1.8, z: 0, yaw: 0, speed: 12 });
    expect(result).toEqual({ ok: false, reason: 'visible-ahead' });
  });

  it('rejects a spawn too close behind the player when the traffic is faster, and accepts one far enough back', () => {
    const system = createSystem();
    const player: PlayerPose = { x: 1.8, z: 100, yaw: 0, speed: 12 };
    // 30 m behind the player, traffic at 12 m/s, equal to the player: the behind gap is 30 m, below the 45 m minimum.
    expect(system.spawn(sedanRequest('S1:F:0', 70, 12, 15), player)).toEqual({ ok: false, reason: 'too-close-behind' });
    // 60 m behind: accepted.
    expect(system.spawn(sedanRequest('S1:F:0', 40, 12, 15), player).ok).toBe(true);
  });

  it('keeps the gap ahead of other traffic based on the new vehicle speed', () => {
    const system = createSystem();
    expect(system.spawn(sedanRequest('S1:F:0', 100, 12, 15), PLAYER_BEHIND_TRAFFIC).ok).toBe(true);
    // 60 m behind a vehicle at 100 m: gap 58 m, enough for 12 m/s.
    expect(system.spawn(sedanRequest('S1:F:0', 40, 12, 15), PLAYER_BEHIND_TRAFFIC).ok).toBe(true);
    // 15 m behind: gap 13 m, below 2 m + 1.5 s x 12 m/s = 20 m.
    expect(system.spawn(sedanRequest('S1:F:0', 85, 12, 15), PLAYER_BEHIND_TRAFFIC)).toEqual({ ok: false, reason: 'traffic-gap-ahead' });
  });

  it('keeps the gap behind other traffic based on that vehicle speed', () => {
    const system = createSystem();
    expect(system.spawn(sedanRequest('S1:F:0', 40, 15, 15), PLAYER_BEHIND_TRAFFIC).ok).toBe(true);
    // 20 m ahead of the existing vehicle at 15 m/s. The existing vehicle needs 2 + 1.5 x 15 = 24.5 m.
    expect(system.spawn(sedanRequest('S1:F:0', 60, 12, 15), PLAYER_BEHIND_TRAFFIC)).toEqual({ ok: false, reason: 'traffic-gap-behind' });
  });

  it('rejects spawns that would sit on the junction', () => {
    const system = createSystem();
    const lane = graph.byId.get('S2a:F:0');
    if (!lane) throw new Error('missing lane');
    const s = lane.lengthMeters - 1 - trafficDimensions(findTrafficType('sedan')).noseMeters;
    expect(system.spawn(sedanRequest('S2a:F:0', s, 10, 15), PLAYER_BEHIND_TRAFFIC)).toEqual({ ok: false, reason: 'junction-occupied' });
  });

  it('respects the pool: a full pool rejects with no-free-slot', () => {
    const system = new TrafficSystem(network, graph, boundary, { capacity: 1, playerFootprint });
    expect(system.spawn(sedanRequest('S1:F:0', 40, 12, 15), PLAYER_BEHIND_TRAFFIC).ok).toBe(true);
    expect(system.spawn(sedanRequest('S3:F:0', 40, 12, 15), PLAYER_BEHIND_TRAFFIC)).toEqual({ ok: false, reason: 'no-free-slot' });
  });

  it('counts every rejection by reason, for diagnostics', () => {
    const system = createSystem();
    system.spawn(sedanRequest('NOPE:F:0', 10, 10, 15), PLAYER_PARKED);
    system.spawn(sedanRequest('NOPE:F:0', 10, 10, 15), PLAYER_PARKED);
    expect(system.stats.rejections['unknown-lane']).toBe(2);
    expect(system.stats.spawned).toBe(0);
  });
});

describe('leader search along the lane chain', () => {
  it('sees a leader on the next straight at its true distance, across a curve-to-straight joint', () => {
    const system = createSystem();
    const leader = system.spawn(sedanRequest('S2a:F:0', 50, 0, 15), PLAYER_BEHIND_TRAFFIC);
    const follower = system.spawn(sedanRequest('T1:F:0', 80, 10, 15), PLAYER_BEHIND_TRAFFIC);
    expect(leader).toMatchObject({ ok: true });
    expect(follower).toMatchObject({ ok: true });
    if (!leader.ok || !follower.ok) return;
    system.step(FIXED_STEP_SECONDS, PLAYER_BEHIND_TRAFFIC);
    const followerVehicle = system.vehicles[follower.id];
    expect(followerVehicle?.leaderId).toBe(leader.id);
    // Chain distance: the rest of T1 (97.07 - 80) plus 50 m on S2a. Gap subtracts the follower's nose distance from
    // its reference point (rear axle to nose: 2.7 wheelbase + 0.95 front overhang = 3.65) and the leader's rear
    // overhang (0.9). The leader gap is read before the follower moves in this step, so no travel is subtracted.
    const expectedGap = 97.07 - 80 + 50 - 3.65 - 0.9;
    expect(followerVehicle?.leaderGapMeters ?? Number.NaN).toBeCloseTo(expectedGap, 0);
  });
});

describe('several vehicles with spacing (step 5)', () => {
  function boxOf(vehicle: { x: number; z: number; heading: number; typeId: string | null }) {
    const type = findTrafficType((vehicle.typeId ?? 'sedan') as 'sedan');
    const dims = trafficDimensions(type);
    return groundBoxFromPose(vehicle.x, vehicle.z, vehicle.heading, dims.rearMeters, dims.noseMeters, dims.halfWidthMeters);
  }

  it('follows a slow leader without overlap, settles behind it, and never stops permanently', () => {
    const system = createSystem();
    const fast = system.spawn(sedanRequest('S1:F:0', 20, 14, 15), PLAYER_BEHIND_TRAFFIC);
    const slow = system.spawn(sedanRequest('S1:F:0', 100, 6, 6), PLAYER_BEHIND_TRAFFIC);
    const curve = system.spawn(sedanRequest('T1:F:0', 40, 10, 14), PLAYER_BEHIND_TRAFFIC);
    const straight = system.spawn(sedanRequest('S3:F:0', 50, 12, 14), PLAYER_BEHIND_TRAFFIC);
    expect([fast, slow, curve, straight].every((result) => result.ok)).toBe(true);
    if (!fast.ok || !slow.ok || !curve.ok || !straight.ok) return;

    // Distance is accumulated from speed x step. Lane-relative s resets at each lane transition, so it is not used.
    const travelled = system.vehicles.map(() => 0);
    let worstOverlapPairs = 0;
    let minFollowGap = Number.POSITIVE_INFINITY;
    let slowedDown = false;
    for (let step = 0; step < 60 * 40; step += 1) {
      system.step(FIXED_STEP_SECONDS, PLAYER_BEHIND_TRAFFIC);
      for (const vehicle of system.vehicles) {
        if (vehicle.active) travelled[vehicle.id] = (travelled[vehicle.id] ?? 0) + vehicle.speed * FIXED_STEP_SECONDS;
      }
      const active = system.vehicles.filter((vehicle) => vehicle.active);
      let overlapPairs = 0;
      for (let i = 0; i < active.length; i += 1) {
        for (let j = i + 1; j < active.length; j += 1) {
          const a = active[i];
          const b = active[j];
          if (a && b && groundBoxOverlap(boxOf(a), boxOf(b)).overlapping) overlapPairs += 1;
        }
      }
      worstOverlapPairs = Math.max(worstOverlapPairs, overlapPairs);
      const follower = system.vehicles[fast.id];
      if (follower?.leaderId === slow.id && follower.leaderGapMeters !== null) {
        minFollowGap = Math.min(minFollowGap, follower.leaderGapMeters);
      }
      if ((follower?.speed ?? 0) < 13.9) slowedDown = true;
    }

    expect(worstOverlapPairs).toBe(0);
    expect(slowedDown).toBe(true);
    expect(minFollowGap).toBeGreaterThan(0.5);
    // Settled gap behind the slow car at 6 m/s: the IDM equilibrium is about minGap + headway x speed = 2 + 9 m.
    const settled = system.vehicles[fast.id];
    expect(settled?.leaderGapMeters ?? Number.NaN).toBeGreaterThan(4);
    expect(settled?.leaderGapMeters ?? Number.NaN).toBeLessThan(25);
    expect(system.vehicles[slow.id]?.speed ?? 0).toBeCloseTo(6, 0);
    for (const index of [fast.id, slow.id, curve.id, straight.id]) {
      expect(travelled[index] ?? 0, `vehicle ${index} moved`).toBeGreaterThan(20);
    }
    expect(system.stats.invalidTransitions).toBe(0);
  });
});
