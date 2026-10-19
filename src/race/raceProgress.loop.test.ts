import { describe, expect, it } from 'vitest';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildCityNetwork, buildLoopCityNetwork } from '../world/city/cityNetwork';
import { CAREER_RACE_EVENTS } from '../career/careerRaces';
import { CIRCUIT_BLOCK, SEAM_SPRINT, SPRINT_EASTSIDE } from './raceEvents';
import { buildRaceRoute, type RaceRoute } from './raceRoute';
import { createRacerProgress, nearestRouteSample, stepRacerProgress, type RacerProgress, type RaceProgressEvent } from './raceProgress';
import type { RaceEventDefinition } from './raceTypes';

/*
 * Race progress on the looping world (Stage D). Every route here sits inside the base domain. A car one period away
 * from a route point is the same car, so progress must not change when the car's logical coordinates are shifted by a
 * whole period, and a wrap must never fire a gate, relocate the racer, or finish a lap.
 */

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
const loopGraph = buildLaneGraph(buildLoopCityNetwork());
const finiteGraph = buildLaneGraph(buildCityNetwork());

function routeOf(event: RaceEventDefinition, graph: typeof loopGraph): RaceRoute {
  const result = buildRaceRoute(event, graph);
  if (!result.route) throw new Error(`route ${event.id} invalid: ${result.issues.map((i) => i.code).join(',')}`);
  return result.route;
}

const loopCircuit = routeOf(CIRCUIT_BLOCK, loopGraph);
const finiteCircuit = routeOf(CIRCUIT_BLOCK, finiteGraph);
const loopSprint = routeOf(SPRINT_EASTSIDE, loopGraph);

interface Drive {
  racer: RacerProgress;
  events: RaceProgressEvent[];
}

/**
 * Drives one lap along the route polyline. `shift(i)` gives the logical offset added to route point i, so a
 * whole-period shift models a car that is physically on the same place but logically a period away.
 */
function driveLap(route: RaceRoute, shift: (i: number) => { dx: number; dz: number }, startIndex = 0, count?: number): Drive {
  const { xs, zs } = route.polyline;
  const n = xs.length;
  const first = shift(startIndex);
  const racer = createRacerProgress('p', 'player', 'Player', (xs[startIndex] ?? 0) + first.dx, (zs[startIndex] ?? 0) + first.dz, 0);
  const events: RaceProgressEvent[] = [];
  // A cycle closes back to its first point. A sprint stops at its last point, so it never jumps back to the start.
  const steps = count ?? (route.cyclic ? n : n - 1);
  let t = 0;
  for (let k = 1; k <= steps; k += 1) {
    const i = (startIndex + k) % n;
    const s = shift(i);
    t += 0.1;
    const out = stepRacerProgress(racer, route, (xs[i] ?? 0) + s.dx, (zs[i] ?? 0) + s.dz, t, 1);
    events.push(...out.events);
  }
  return { racer, events };
}

const NONE = { dx: 0, dz: 0 };
const WHOLE_PERIOD_EAST = { dx: PERIOD, dz: 0 };
const WHOLE_PERIOD_NORTH = { dx: 0, dz: PERIOD };

function summary(events: readonly RaceProgressEvent[]): string[] {
  return events.map((e) => (e.kind === 'gate-passed' ? `gate:${e.gateId}` : e.kind === 'lap-completed' ? `lap:${e.lap}` : e.kind));
}

describe('race routes on the loop', () => {
  it('marks loop routes with the period and leaves finite routes unmarked', () => {
    expect(loopCircuit.periodMeters).toBe(PERIOD);
    expect(loopSprint.periodMeters).toBe(PERIOD);
    expect(finiteCircuit.periodMeters).toBeUndefined();
  });

  it('keeps the existing loop race routes inside the base domain (the seam route is tested below)', () => {
    const half = PERIOD / 2;
    // The Seam Run crosses the seam on purpose, so it is left out here. The seam tests above and below cover it.
    const crossesSeam = new Set(['career-seam-race']);
    for (const event of [SPRINT_EASTSIDE, CIRCUIT_BLOCK, ...CAREER_RACE_EVENTS.filter((race) => !crossesSeam.has(race.id))]) {
      const route = routeOf(event, loopGraph);
      for (let i = 0; i < route.polyline.xs.length; i += 1) {
        expect(Math.abs(route.polyline.xs[i] ?? Infinity), `${event.id} x at ${i}`).toBeLessThan(half);
        expect(Math.abs(route.polyline.zs[i] ?? Infinity), `${event.id} z at ${i}`).toBeLessThan(half);
      }
    }
  });

  it('gives the same route length on the loop as on the finite city', () => {
    expect(loopCircuit.totalMeters).toBeCloseTo(finiteCircuit.totalMeters, 6);
  });

  it('the seam sprint is a valid loop route that crosses the east seam, with its gate after the seam', () => {
    const route = routeOf(SEAM_SPRINT, loopGraph);
    expect(route.periodMeters).toBe(PERIOD);
    expect(route.laneIds).toContain('J--4-1:west>east:0');
    // The polyline steps from one side of the seam to the other once: a single segment about one period long.
    let jumps = 0;
    for (let i = 1; i < route.polyline.xs.length; i += 1) {
      const step = Math.hypot((route.polyline.xs[i] ?? 0) - (route.polyline.xs[i - 1] ?? 0), (route.polyline.zs[i] ?? 0) - (route.polyline.zs[i - 1] ?? 0));
      if (step > PERIOD / 2) jumps += 1;
    }
    expect(jumps).toBe(1);
    expect(route.gates.map((g) => g.id)).toEqual(['cp-1', 'finish']);
    expect(route.gates[0]?.routeDistanceMeters ?? 0).toBeGreaterThan(200);
  });
});

describe('the seam sprint at the seam', () => {
  const route = routeOf(SEAM_SPRINT, loopGraph);

  it('a point on the same street far from the route is not matched through the seam segment', () => {
    // (0, -201.8) lies on the east-west street, which is not part of this route. The route's nearest point is about
    // 800 m away. A seam segment, if it were searched, would put this point at distance 0.
    const near = nearestRouteSample(route, 0, -201.8, null);
    expect(near).not.toBeNull();
    expect(near?.distance ?? 0).toBeGreaterThan(100);
  });

  it('a car driven through the seam finishes at the finish gate: no relocation, each gate once, no lost distance', () => {
    // The logical position keeps increasing past the seam, so the points after it are one period further east.
    const xs = route.polyline.xs;
    let seamAt = -1;
    for (let i = 1; i < xs.length; i += 1) {
      if (Math.abs((xs[i] ?? 0) - (xs[i - 1] ?? 0)) > PERIOD / 2) seamAt = i;
    }
    expect(seamAt).toBeGreaterThan(0);
    const drive = driveLap(route, (i) => (i >= seamAt ? { dx: PERIOD, dz: 0 } : NONE));
    expect(drive.racer.finished).toBe(true);
    expect(drive.racer.relocations).toBe(0);
    expect(drive.racer.relocationsHeld).toBe(0);
    expect(summary(drive.events)).toEqual(['gate:cp-1', 'gate:finish', 'finished']);
    // The race ends at the finish gate. The route runs on to the end of the last lane, as the sprint does.
    const finishAt = route.gates[route.gates.length - 1]?.routeDistanceMeters ?? Infinity;
    expect(drive.racer.travelledMeters).toBeGreaterThan(finishAt - 3);
    expect(drive.racer.travelledMeters).toBeLessThan(finishAt + 3);
  });

  it('the route distance grows across the seam: the far side is later on the route', () => {
    const before = nearestRouteSample(route, 1150, -201.8, null);
    const after = nearestRouteSample(route, -1150, -201.8, null);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(before?.distance ?? Infinity).toBeLessThan(1);
    expect(after?.distance ?? Infinity).toBeLessThan(1);
    expect(after?.d ?? 0).toBeGreaterThan(before?.d ?? Infinity);
  });
});

describe('race progress on the loop', () => {
  it('a lap on the loop passes the same gates as a lap in the finite city', () => {
    const loop = driveLap(loopCircuit, () => NONE);
    const finite = driveLap(finiteCircuit, () => NONE);
    expect(summary(loop.events)).toEqual(summary(finite.events));
    expect(loop.events.some((e) => e.kind === 'gate-passed')).toBe(true);
  });

  it('a car one period away from every route point makes the same progress', () => {
    const base = driveLap(loopCircuit, () => NONE);
    const east = driveLap(loopCircuit, () => WHOLE_PERIOD_EAST);
    const north = driveLap(loopCircuit, () => WHOLE_PERIOD_NORTH);
    expect(summary(east.events)).toEqual(summary(base.events));
    expect(summary(north.events)).toEqual(summary(base.events));
    expect(east.racer.relocations).toBe(0);
    expect(north.racer.relocations).toBe(0);
    expect(east.racer.lapsDone).toBe(base.racer.lapsDone);
  });

  it('a wrap in the middle of a lap changes nothing and is not a relocation', () => {
    const n = loopCircuit.polyline.xs.length;
    const half = Math.floor(n / 2);
    const base = driveLap(loopCircuit, () => NONE);
    const jumped = driveLap(loopCircuit, (i) => (i >= half ? WHOLE_PERIOD_EAST : NONE));
    expect(summary(jumped.events)).toEqual(summary(base.events));
    expect(jumped.racer.relocations).toBe(0);
    expect(jumped.racer.gatesPassed).toBe(base.racer.gatesPassed);
    expect(jumped.racer.lapsDone).toBe(base.racer.lapsDone);
  });

  it('a wrap at the start line does not fire a gate or finish a lap', () => {
    // Park on the start line and flip the logical position by whole periods, without moving. Nothing may happen.
    const start = driveLap(loopCircuit, () => NONE, 0, 0);
    const racer = start.racer;
    const xs = loopCircuit.polyline.xs[0] ?? 0;
    const zs = loopCircuit.polyline.zs[0] ?? 0;
    const events: RaceProgressEvent[] = [];
    let t = 0;
    for (const sign of [1, -1, 1, 1, -1]) {
      t += 0.1;
      const out = stepRacerProgress(racer, loopCircuit, xs + sign * PERIOD, zs, t, 1);
      events.push(...out.events);
    }
    expect(summary(events)).toEqual([]);
    expect(racer.lapsDone).toBe(0);
    expect(racer.finished).toBe(false);
  });

  it('a wrap just before the start line does not finish the race', () => {
    // Stop on the last point before the line, then the logical position jumps a period in place. No gate, no lap.
    const last = loopCircuit.polyline.xs.length - 1;
    const short = driveLap(loopCircuit, () => NONE, 0, last);
    const xs = loopCircuit.polyline.xs[last] ?? 0;
    const zs = loopCircuit.polyline.zs[last] ?? 0;
    const out = stepRacerProgress(short.racer, loopCircuit, xs + PERIOD, zs, 50, 1);
    expect(out.events.filter((e) => e.kind === 'lap-completed' || e.kind === 'finished')).toEqual([]);
    expect(short.racer.lapsDone).toBe(0);
    expect(short.racer.finished).toBe(false);
  });

  it('the sprint on the loop finishes once, as it does in the finite city', () => {
    const drive = driveLap(loopSprint, () => NONE);
    expect(drive.racer.finished).toBe(true);
    expect(drive.events.filter((e) => e.kind === 'finished')).toHaveLength(1);
  });
});
