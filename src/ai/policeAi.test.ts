import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { buildRoadBoundary } from '../simulation/roadBoundary';
import { buildCircuitNetwork } from '../world/circuitNetwork';
import { buildLaneGraph, laneSample, successorOf } from '../traffic/laneGraph';
import { OpponentSystem, type OpponentSpec } from './aiOpponents';

/*
 * Part 7 step 5: the AI hooks the pursuit uses (AiDriver.setPolicy, OpponentSystem.place, setDriverPolicy, isActive,
 * retire). Automated. They run the shared vehicle model at the fixed step; nothing is mocked.
 */

const network = buildCircuitNetwork();
const graph = buildLaneGraph(network);
const boundary = buildRoadBoundary(network);

function spec(laneId: string, s: number, speedMps = 0, overrides: Partial<OpponentSpec> = {}): OpponentSpec {
  return { typeId: 'sedan', laneId, s, speedMps, colourIndex: 0, recyclable: false, releasable: false, ...overrides };
}

function positionOf(system: OpponentSystem, id: number): { x: number; z: number } {
  const opponent = system.opponents[id];
  if (!opponent) throw new Error(`no opponent ${id}`);
  return { x: opponent.state.position.x, z: opponent.state.position.z };
}

describe('AiDriver.setPolicy: a policy change is never a teleport', () => {
  it('keeps the route position and the vehicle state when the policy is replaced', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 30, 12)]);
    const before = positionOf(system, 0);
    const routeBefore = system.opponents[0]!.driver.route;
    system.setDriverPolicy(0, { speedCapMps: 5, nextLaneOf: successorOf });
    expect(positionOf(system, 0)).toEqual(before);
    expect(system.opponents[0]!.driver.route).toEqual(routeBefore);
    expect(system.opponents[0]!.state.speed).toBe(12);
  });

  it('applies a speed cap on the following steps', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 30, 14)]);
    system.setDriverPolicy(0, { speedCapMps: 6 });
    for (let step = 0; step < 60 * 6; step += 1) system.integrate(FIXED_STEP_SECONDS, []);
    const decision = system.opponents[0]!.decision;
    if (!decision) throw new Error('no decision');
    expect(decision.targetSpeedMps).toBeLessThanOrEqual(6 + 1e-9);
  });

  it('clears a cap when the policy has none, so the traffic default applies again', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 30, 0)]);
    system.setDriverPolicy(0, { speedCapMps: 4 });
    system.setDriverPolicy(0, {});
    for (let step = 0; step < 60 * 4; step += 1) system.integrate(FIXED_STEP_SECONDS, []);
    const decision = system.opponents[0]!.decision;
    if (!decision) throw new Error('no decision');
    expect(decision.targetSpeedMps).toBeGreaterThan(4);
  });

  it('ignores a policy for a unit that does not exist', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 30)]);
    expect(() => system.setDriverPolicy(7, { speedCapMps: 3 })).not.toThrow();
  });
});

describe('OpponentSystem.place, isActive, retire', () => {
  it('places a unit at its lane position, active, with the given spec', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 10), spec('S1:F:0', 60)]);
    const target = spec('S2a:F:0', 15, 8);
    system.place(1, target);
    expect(system.isActive(1)).toBe(true);
    expect(system.specOf(1)).toEqual(target);
    expect(system.opponents[1]!.driver.route.laneId).toBe('S2a:F:0');
    const lane = graph.byId.get('S2a:F:0');
    if (!lane) throw new Error('lane');
    const pose = laneSample(lane, 15);
    const at = positionOf(system, 1);
    expect(Math.hypot(at.x - pose.x, at.z - pose.z)).toBeLessThan(1e-6);
    expect(system.opponents[1]!.state.speed).toBe(8);
  });

  it('re-activates a retired slot when it is placed again', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 10)]);
    system.retire(0);
    expect(system.isActive(0)).toBe(false);
    system.place(0, spec('S1:F:0', 40, 5));
    expect(system.isActive(0)).toBe(true);
    expect(system.specOf(0)?.s).toBe(40);
  });

  it('does not move a retired unit when the system steps', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 30, 10)]);
    system.retire(0);
    const before = positionOf(system, 0);
    for (let step = 0; step < 60; step += 1) system.integrate(FIXED_STEP_SECONDS, []);
    expect(positionOf(system, 0)).toEqual(before);
    expect(system.isActive(0)).toBe(false);
  });

  it('reports an unknown id as not active, and refuses to place into it', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 30)]);
    expect(system.isActive(9)).toBe(false);
    expect(() => system.place(9, spec('S1:F:0', 30))).toThrow();
  });

  it('keeps a placed unit out of the stall recycle, since police are not recyclable', () => {
    const system = new OpponentSystem(graph, boundary, [spec('S1:F:0', 30, 0, { recyclable: false })]);
    for (let step = 0; step < 60 * 40; step += 1) system.integrate(FIXED_STEP_SECONDS, []);
    expect(system.recycles).toBe(0);
    expect(system.isActive(0)).toBe(true);
  });
});
