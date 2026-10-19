import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { buildRoadBoundary } from '../simulation/roadBoundary';
import { groundBoxFromPose, groundBoxOverlap, type GroundBox } from '../simulation/obb';
import { buildCircuitNetwork } from '../world/circuitNetwork';
import { buildLaneGraph, laneSample } from '../traffic/laneGraph';
import { trafficDimensions, findTrafficType } from '../traffic/trafficTypes';
import { GameSimulation } from '../engine/gameSimulation';
import { createTrafficRuntime, playerFootprintFromConfig } from '../traffic/trafficRuntime';
import { CIRCUIT_OPPONENT_SPECS, CIRCUIT_TRAFFIC_SCENARIO } from '../traffic/trafficScenarios';
import { OpponentSystem, type OpponentSpec } from './aiOpponents';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { AiDriver, type AiObstacle } from './aiController';
import { createVehicleState } from '../simulation/vehicle';
import type { VehicleState } from '../core/types';

/*
 * AI controller and opponent tests (Part 4, steps 9 and 10). The opponents drive the shared vehicle model, so these
 * tests run the real physics at the fixed step. Nothing is mocked.
 */

const network = buildCircuitNetwork();
const graph = buildLaneGraph(network);
const boundary = buildRoadBoundary(network);

function opponentAt(laneId: string, s: number, speed: number, typeId: OpponentSpec['typeId'] = 'sedan'): OpponentSpec {
  return { typeId, laneId, s, speedMps: speed, colourIndex: 0 };
}

function boxAhead(laneId: string, s: number, typeId: OpponentSpec['typeId'] = 'sedan'): GroundBox {
  const lane = graph.byId.get(laneId);
  if (!lane) throw new Error('lane');
  const pose = laneSample(lane, s);
  const dims = trafficDimensions(findTrafficType(typeId));
  return groundBoxFromPose(pose.x, pose.z, pose.heading, dims.rearMeters, dims.noseMeters, dims.halfWidthMeters);
}

describe('opponent drives the circuit (step 9)', () => {
  it('follows the loop through the curves and the junction, staying in lane, with no boundary contact', () => {
    const system = new OpponentSystem(graph, boundary, [opponentAt('S1:F:0', 20, 14)]);
    const visited: string[] = [];
    let maxLateral = 0;
    let minSpeedAtJunction = Number.POSITIVE_INFINITY;
    let lost = false;
    for (let step = 0; step < 60 * 110; step += 1) {
      system.integrate(FIXED_STEP_SECONDS, []);
      const opponent = system.opponents[0];
      const decision = opponent?.decision;
      if (!opponent || !decision) throw new Error('no decision');
      const laneId = decision.laneId;
      if (visited[visited.length - 1] !== laneId) visited.push(laneId);
      if (step > 60 * 3) maxLateral = Math.max(maxLateral, Math.abs(decision.lateralErrorMeters));
      if (laneId.startsWith('J1')) minSpeedAtJunction = Math.min(minSpeedAtJunction, opponent.state.speed);
      if (decision.state === 'lost') lost = true;
      if (!Number.isFinite(opponent.state.position.x) || !Number.isFinite(opponent.state.yaw)) throw new Error('non-finite');
    }
    for (const id of ['S1:F:0', 'T1:F:0', 'S2a:F:0', 'J1:east>west:0', 'S2b:F:0', 'T2:F:0', 'S3:F:0', 'T3:F:0', 'S4:F:0', 'T4:F:0']) {
      expect(visited, `visited ${id}`).toContain(id);
    }
    expect(lost).toBe(false);
    expect(maxLateral).toBeLessThan(1.0);
    expect(minSpeedAtJunction).toBeGreaterThan(3);
    expect(system.contacts.counts['opponent-boundary']).toBe(0);
  });

  it('recovers from a small lateral error, and steers back toward the lane centre', () => {
    const system = new OpponentSystem(graph, boundary, [opponentAt('S1:F:0', 40, 12)]);
    const opponent = system.opponents[0];
    if (!opponent) throw new Error('no opponent');
    opponent.state = { ...opponent.state, position: { ...opponent.state.position, x: opponent.state.position.x + 1.6 } };
    system.integrate(FIXED_STEP_SECONDS, []);
    expect(opponent.decision?.state).toBe('recover');
    const startError = Math.abs(opponent.decision?.lateralErrorMeters ?? 0);
    for (let step = 0; step < 60 * 6; step += 1) system.integrate(FIXED_STEP_SECONDS, []);
    expect(Math.abs(opponent.decision?.lateralErrorMeters ?? 99)).toBeLessThan(0.3);
    expect(startError).toBeGreaterThan(0.9);
  });

  it('stops short of a stopped vehicle ahead in its lane, and never overlaps it', () => {
    const system = new OpponentSystem(graph, boundary, [opponentAt('S1:F:0', 20, 14)]);
    const parkedBox = boxAhead('S1:F:0', 120);
    const parked: AiObstacle = { key: 'traffic:9', box: parkedBox, speedMps: 0 };
    let overlapped = false;
    let braked = false;
    // Shorter than the stall time, so the stop is not recycled during the run.
    for (let step = 0; step < 60 * 15; step += 1) {
      system.integrate(FIXED_STEP_SECONDS, [parked]);
      const opponent = system.opponents[0];
      if (!opponent) throw new Error('no opponent');
      if (opponent.decision?.state === 'brake') braked = true;
      if (groundBoxOverlap(system.boxOf(opponent), parkedBox).overlapping) overlapped = true;
    }
    const final = system.opponents[0];
    expect(braked).toBe(true);
    expect(overlapped).toBe(false);
    expect(final?.state.speed ?? 99).toBeLessThan(0.5);
    const gap = (final?.decision?.obstacleGapMeters ?? 0);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(8);
  });

  it('never holds the brake at standstill, so the car never reverses', () => {
    const system = new OpponentSystem(graph, boundary, [opponentAt('S1:F:0', 20, 6)]);
    const parked: AiObstacle = { key: 'traffic:9', box: boxAhead('S1:F:0', 40), speedMps: 0 };
    let slowest = Number.POSITIVE_INFINITY;
    for (let step = 0; step < 60 * 15; step += 1) {
      system.integrate(FIXED_STEP_SECONDS, [parked]);
      const opponent = system.opponents[0];
      if (opponent) slowest = Math.min(slowest, opponent.state.speed);
    }
    expect(slowest).toBeGreaterThan(-0.05);
  });

  it('recycles a stalled opponent to its spawn once the stall time has passed and the spawn is clear', () => {
    const system = new OpponentSystem(graph, boundary, [opponentAt('S1:F:0', 20, 14)]);
    const parked: AiObstacle = { key: 'traffic:9', box: boxAhead('S1:F:0', 120), speedMps: 0 };
    for (let step = 0; step < 60 * 40; step += 1) system.integrate(FIXED_STEP_SECONDS, [parked]);
    expect(system.recycles).toBeGreaterThanOrEqual(1);
    const opponent = system.opponents[0];
    expect(opponent?.spec.laneId).toBe('S1:F:0');
    expect(opponent?.stalledSeconds ?? 99).toBeLessThan(TRAFFIC_CONFIG.obstacle.stallRecycleSeconds);
  });

  it('does not recycle while the spawn is blocked, and waits instead', () => {
    const system = new OpponentSystem(graph, boundary, [opponentAt('S1:F:0', 20, 14)]);
    // A parked car sits on the opponent's own spawn point, so the recycle must be postponed.
    const onSpawn: AiObstacle = { key: 'traffic:9', box: boxAhead('S1:F:0', 20), speedMps: 0 };
    const ahead: AiObstacle = { key: 'traffic:8', box: boxAhead('S1:F:0', 120), speedMps: 0 };
    for (let step = 0; step < 60 * 40; step += 1) system.integrate(FIXED_STEP_SECONDS, [onSpawn, ahead]);
    expect(system.recycles).toBe(0);
  });

  it('is deterministic: the same inputs give the same final state', () => {
    const run = () => {
      const system = new OpponentSystem(graph, boundary, [opponentAt('S3:F:0', 60, 8)]);
      for (let step = 0; step < 60 * 40; step += 1) system.integrate(FIXED_STEP_SECONDS, []);
      const state = system.opponents[0]?.state;
      return state ? [state.position.x, state.position.z, state.yaw, state.speed] : [];
    };
    expect(run()).toEqual(run());
  });

  it('keeps the steering input inside the controller range, and never steers into a zero-speed reversal', () => {
    const driver = new AiDriver(graph, 'S1:F:0', 10);
    const state = { ...createStateAt('S1:F:0', 10), speed: 0 };
    const decision = driver.decide(state, []);
    expect(decision.input.steer).toBeGreaterThanOrEqual(-1);
    expect(decision.input.steer).toBeLessThanOrEqual(1);
    expect(decision.input.throttle).toBeGreaterThanOrEqual(0);
    expect(decision.input.brake).toBeGreaterThanOrEqual(0);
    expect(decision.input.throttle * decision.input.brake).toBe(0);
    expect(VEHICLE_CONFIG.maxForwardSpeedMps).toBeGreaterThan(0);
  });
});

describe('circuit with traffic and opponents (step 9 integration)', () => {
  it('runs for a minute with traffic and the opponent on the road, without NaN, boundary contacts, or stuck cars', () => {
    const playerFp = playerFootprintFromConfig(VEHICLE_CONFIG);
    const traffic = createTrafficRuntime(network, graph, boundary, CIRCUIT_TRAFFIC_SCENARIO, playerFp);
    const opponents = new OpponentSystem(graph, boundary, CIRCUIT_OPPONENT_SPECS);
    const sim = new GameSimulation(VEHICLE_CONFIG, {
      spawn: { position: { x: 1.8, y: 0, z: 0 }, yawRadians: 0 },
      boundary,
      traffic,
      opponents,
    });
    const start = opponents.opponents[0]?.state.position;
    for (let step = 0; step < 60 * 60; step += 1) {
      sim.update(FIXED_STEP_SECONDS, { steer: 0, throttle: 0, brake: 0, handbrake: 0 });
    }
    const end = opponents.opponents[0]?.state.position;
    const moved = start && end ? Math.hypot(end.x - start.x, end.z - start.z) : 0;
    expect(moved).toBeGreaterThan(20);
    expect(opponents.contacts.counts['opponent-boundary']).toBe(0);
    expect(traffic.system.contacts.counts['traffic-boundary']).toBe(0);
    expect(traffic.system.contacts.counts['traffic-traffic']).toBe(0);
    expect(Number.isFinite(sim.state.position.x) && Number.isFinite(sim.state.position.z)).toBe(true);
  });
});

function createStateAt(laneId: string, s: number): VehicleState {
  const lane = graph.byId.get(laneId);
  if (!lane) throw new Error('lane');
  const pose = laneSample(lane, s);
  return { ...createVehicleState({ x: pose.x, y: 0, z: pose.z }, pose.heading), speed: 10 };
}
