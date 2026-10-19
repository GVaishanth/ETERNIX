import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute, type RaceRoute } from './raceRoute';
import { SPRINT_EASTSIDE } from './raceEvents';
import { crossesGate } from './gates';
import {
  createRacerProgress,
  nearestRouteSample,
  refreshRouteDistance,
  legProgressMeters,
  stepRacerProgress,
  type RacerProgress,
} from './raceProgress';
import { RACE_CONFIG } from '../config/raceConfig';

const route = buildRaceRoute(SPRINT_EASTSIDE, buildLaneGraph(buildCityNetwork())).route as RaceRoute;
const gate = (id: string) => route.gates.find((g) => g.id === id)!;

/** A point `ahead` metres along the gate heading from the gate centre (negative is behind it). */
function pointAt(g: { x: number; z: number; headingRadians: number }, ahead: number, lateral = 0) {
  const fx = Math.sin(g.headingRadians);
  const fz = Math.cos(g.headingRadians);
  const rx = Math.cos(g.headingRadians);
  const rz = -Math.sin(g.headingRadians);
  return { x: g.x + fx * ahead + rx * lateral, z: g.z + fz * ahead + rz * lateral };
}

function racerAt(p: { x: number; z: number }, id = 'p'): RacerProgress {
  return createRacerProgress(id, 'player', 'Player', p.x, p.z, 0);
}

describe('gate crossing', () => {
  const g = gate('cp-1');

  it('counts a forward crossing through the centre', () => {
    const behind = pointAt(g, -2);
    const front = pointAt(g, 2);
    expect(crossesGate(g, behind.x, behind.z, front.x, front.z, RACE_CONFIG.gateHalfWidthMeters)).toBe(true);
  });

  it('does not count a backward crossing', () => {
    const behind = pointAt(g, -2);
    const front = pointAt(g, 2);
    expect(crossesGate(g, front.x, front.z, behind.x, behind.z, RACE_CONFIG.gateHalfWidthMeters)).toBe(false);
  });

  it('does not count a crossing outside the half width, and counts one just inside it', () => {
    const w = RACE_CONFIG.gateHalfWidthMeters;
    const a = pointAt(g, -2, w + 1);
    const b = pointAt(g, 2, w + 1);
    expect(crossesGate(g, a.x, a.z, b.x, b.z, w)).toBe(false);
    const c = pointAt(g, -2, w - 0.5);
    const d = pointAt(g, 2, w - 0.5);
    expect(crossesGate(g, c.x, c.z, d.x, d.z, w)).toBe(true);
  });

  it('catches a fast step that skips past the gate in one fixed step (swept segment)', () => {
    const a = pointAt(g, -20);
    const b = pointAt(g, 20);
    expect(crossesGate(g, a.x, a.z, b.x, b.z, RACE_CONFIG.gateHalfWidthMeters)).toBe(true);
  });

  it('does not count a segment that stays on one side', () => {
    const a = pointAt(g, 1);
    const b = pointAt(g, 5);
    expect(crossesGate(g, a.x, a.z, b.x, b.z, RACE_CONFIG.gateHalfWidthMeters)).toBe(false);
  });
});

describe('sequence rules', () => {
  it('advances on the expected gate and reports the pass', () => {
    const p = racerAt(pointAt(gate('cp-1'), -1), 'p');
    const next = pointAt(gate('cp-1'), 1);
    const result = stepRacerProgress(p, route, next.x, next.z, 5, 1);
    expect(p.gatesPassed).toBe(1);
    expect(result.events).toEqual([{ kind: 'gate-passed', racerId: 'p', gateId: 'cp-1', atSeconds: 5 }]);
  });

  it('reports a later gate crossed early as out of order, and does not advance', () => {
    const start = pointAt(gate('finish'), -1);
    const p = racerAt(start, 'p');
    const next = pointAt(gate('finish'), 1);
    const result = stepRacerProgress(p, route, next.x, next.z, 10, 1);
    expect(p.gatesPassed).toBe(0);
    expect(p.outOfOrderCount).toBe(1);
    expect(result.events).toEqual([{ kind: 'out-of-order', racerId: 'p', gateId: 'finish', expectedGateId: 'cp-1' }]);
  });

  it('ignores a re-crossing of the gate just passed, silently', () => {
    const p = racerAt(pointAt(gate('cp-1'), -1));
    const forward = pointAt(gate('cp-1'), 1);
    stepRacerProgress(p, route, forward.x, forward.z, 1, 1);
    const cp2 = pointAt(gate('cp-2'), -3);
    // Move back across cp-1 (backward: not counted), then forward across it again (the previous gate, ignored).
    stepRacerProgress(p, route, pointAt(gate('cp-1'), -1).x, pointAt(gate('cp-1'), -1).z, 2, 1);
    const again = stepRacerProgress(p, route, forward.x, forward.z, 3, 1);
    expect(p.gatesPassed).toBe(1);
    expect(again.events).toEqual([]);
    void cp2;
  });

  it('a teleport (larger than the guard) tests no gates; a teleport short of the next gate re-anchors the route distance', () => {
    const p = racerAt(pointAt(gate('cp-1'), -30));
    const near = pointAt(gate('cp-1'), -10);
    const result = stepRacerProgress(p, route, near.x, near.z, 1, 1);
    expect(result.events).toEqual([]);
    expect(p.gatesPassed).toBe(0);
    expect(p.routeD).toBeGreaterThan(gate('cp-1').routeDistanceMeters - 40);
    expect(p.routeD).toBeLessThan(gate('cp-1').routeDistanceMeters);
  });

  it('a teleport past the next gate is held at that gate (no silent skip)', () => {
    const p = racerAt(pointAt(gate('cp-1'), -30));
    const far = pointAt(gate('cp-1'), 30);
    const result = stepRacerProgress(p, route, far.x, far.z, 1, 1);
    expect(result.events).toEqual([{ kind: 'relocation-held', racerId: 'p', gateId: 'cp-1' }]);
    expect(p.gatesPassed).toBe(0);
    expect(p.routeD).toBeCloseTo(gate('cp-1').routeDistanceMeters, 6);
  });

  it('finishes only after every gate, and sets the finish order and time', () => {
    const p = racerAt(pointAt(gate('cp-1'), -1));
    const cp1 = pointAt(gate('cp-1'), 1);
    stepRacerProgress(p, route, cp1.x, cp1.z, 20, 1);
    const cp2a = pointAt(gate('cp-2'), -1);
    stepRacerProgress(p, route, cp2a.x, cp2a.z, 25, 1);
    const cp2b = pointAt(gate('cp-2'), 1);
    stepRacerProgress(p, route, cp2b.x, cp2b.z, 30, 1);
    expect(p.finished).toBe(false);
    const fa = pointAt(gate('finish'), -1);
    stepRacerProgress(p, route, fa.x, fa.z, 40, 1);
    const fb = pointAt(gate('finish'), 1);
    const result = stepRacerProgress(p, route, fb.x, fb.z, 42, 1);
    expect(result.finishedNow).toBe(true);
    expect(p.finished).toBe(true);
    expect(p.finishTime).toBe(42);
    expect(p.finishOrder).toBe(1);
    expect(p.gatesPassed).toBe(3);
  });

  it('a finished racer ignores further crossings', () => {
    const p = racerAt(pointAt(gate('cp-1'), -1));
    p.finished = true;
    p.finishOrder = 1;
    const fb = pointAt(gate('cp-1'), 1);
    const result = stepRacerProgress(p, route, fb.x, fb.z, 9, 2);
    expect(result.events).toEqual([]);
    expect(p.gatesPassed).toBe(0);
  });
});

describe('route distance and leg progress', () => {
  it('finds the route distance of a point on the route', () => {
    const cp1 = gate('cp-1');
    const near = nearestRouteSample(route, cp1.x, cp1.z, null);
    expect(near).not.toBeNull();
    expect(Math.abs(near!.d - cp1.routeDistanceMeters)).toBeLessThan(1);
    // The polyline follows the lane centre (1.8 m right of the road centre), so the gate is one lane offset away.
    expect(near!.distance).toBeLessThan(2);
  });

  it('marks a racer far from the route as off route and holds its distance', () => {
    const p = racerAt({ x: 0, z: 0 });
    p.routeD = 123;
    refreshRouteDistance(p, route);
    expect(p.onRoute).toBe(false);
    expect(p.routeD).toBe(123);
  });

  it('leg progress grows as the racer moves along the route after its last gate', () => {
    const cp1 = gate('cp-1');
    const a = pointAt(cp1, 1);
    const p = racerAt(a);
    p.legRefD = cp1.routeDistanceMeters;
    refreshRouteDistance(p, route);
    const first = legProgressMeters(p, route);
    const b = pointAt(cp1, 50);
    p.x = b.x;
    p.z = b.z;
    refreshRouteDistance(p, route);
    expect(legProgressMeters(p, route)).toBeGreaterThan(first + 40);
  });
});

describe('relocation near a gate', () => {
  it('a relocation past the next gate is held at that gate and does not count it', () => {
    const cp1 = gate('cp-1');
    const start = pointAt(cp1, -30);
    const p = racerAt(start);
    refreshRouteDistance(p, route);
    const ahead = pointAt(cp1, 60);
    const result = stepRacerProgress(p, route, ahead.x, ahead.z, 5, 1);
    expect(p.gatesPassed).toBe(0);
    expect(p.relocations).toBe(1);
    expect(p.relocationsHeld).toBe(1);
    expect(p.routeD).toBeCloseTo(cp1.routeDistanceMeters, 6);
    expect(result.events).toEqual([{ kind: 'relocation-held', racerId: 'p', gateId: 'cp-1' }]);
  });

  it('after a held relocation, the gate counts only when the racer drives forward through it', () => {
    const cp1 = gate('cp-1');
    const p = racerAt(pointAt(cp1, -30));
    refreshRouteDistance(p, route);
    const ahead = pointAt(cp1, 60);
    stepRacerProgress(p, route, ahead.x, ahead.z, 5, 1);
    const behind = pointAt(cp1, -2);
    stepRacerProgress(p, route, behind.x, behind.z, 6, 1);
    expect(p.gatesPassed).toBe(0);
    const front = pointAt(cp1, 2);
    const result = stepRacerProgress(p, route, front.x, front.z, 7, 1);
    expect(p.gatesPassed).toBe(1);
    expect(result.events.some((e) => e.kind === 'gate-passed' && e.gateId === 'cp-1')).toBe(true);
  });

  it('a relocation that does not reach the next gate re-anchors normally', () => {
    const cp1 = gate('cp-1');
    const p = racerAt(pointAt(cp1, -60));
    refreshRouteDistance(p, route);
    const near = pointAt(cp1, -30);
    const result = stepRacerProgress(p, route, near.x, near.z, 5, 1);
    expect(p.relocations).toBe(1);
    expect(p.relocationsHeld).toBe(0);
    expect(result.events).toEqual([]);
    expect(p.routeD).toBeLessThan(cp1.routeDistanceMeters);
  });
});
