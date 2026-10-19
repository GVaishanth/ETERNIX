import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute, formatRouteIssues } from './raceRoute';
import { CIRCUIT_BLOCK } from './raceEvents';
import type { RaceEventDefinition } from './raceTypes';

/*
 * Circuit route (Part 6, step J). The circuit is a closed cycle on the city graph. These tests check the cycle, the lap
 * count, the gates per lap, the lap-closing flag, and the refusal of invalid circuits. Automated.
 */

const graph = buildLaneGraph(buildCityNetwork());

describe('block circuit route', () => {
  const result = buildRaceRoute(CIRCUIT_BLOCK, graph);
  const route = result.route;

  it('validates against the city graph with no issues', () => {
    expect(formatRouteIssues(result)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(route).not.toBeNull();
  });

  it('is a closed cycle: it wraps, and every lane leads to the next lane on the route', () => {
    if (!route) throw new Error('no route');
    expect(route.cyclic).toBe(true);
    expect(route.laneIds.length).toBe(12);
    for (let i = 0; i < route.laneIds.length; i += 1) {
      const here = route.laneIds[i]!;
      const next = route.laneIds[(i + 1) % route.laneIds.length]!;
      expect(route.nextLaneId.get(here)).toBe(next);
      expect(graph.byId.get(here)?.successorIds ?? []).toContain(next);
    }
  });

  it('has the configured number of laps, with one lap length and the total covering all laps', () => {
    if (!route) throw new Error('no route');
    expect(route.laps).toBe(2);
    expect(route.totalMeters).toBeGreaterThan(600);
    // The polyline's distances are lane vertex distances, so its last vertex sits at most one segment before the lap end.
    const lastVertex = route.polyline.ds[route.polyline.ds.length - 1] ?? 0;
    expect(lastVertex).toBeLessThanOrEqual(route.totalMeters);
    expect(lastVertex).toBeGreaterThan(route.totalMeters - 2);
  });

  it('has the same gate sequence on every lap: checkpoint A, checkpoint B, then the start/finish line that closes the lap', () => {
    if (!route) throw new Error('no route');
    expect(route.gates.map((gate) => gate.label)).toEqual(['Checkpoint A', 'Checkpoint B', 'Start / Finish']);
    expect(route.gates.map((gate) => gate.closesLap)).toEqual([false, false, true]);
    // Circuit distances run from the start/finish line (0), so the finish is at 0, which is also the lap end.
    const [a, b, finish] = route.gates.map((gate) => gate.routeDistanceMeters);
    expect(finish).toBe(0);
    expect(a!).toBeGreaterThan(0);
    expect(a!).toBeLessThan(b!);
    expect(b!).toBeLessThan(route.totalMeters);
  });

  it('refuses a circuit with fewer than two laps', () => {
    const bad: RaceEventDefinition = { ...CIRCUIT_BLOCK, laps: 1 };
    const r = buildRaceRoute(bad, graph);
    expect(r.valid).toBe(false);
    expect(formatRouteIssues(r).join(' ')).toMatch(/laps|lap/i);
  });

  it('refuses a circuit whose checkpoint names a lane that is not in the graph', () => {
    const bad: RaceEventDefinition = {
      ...CIRCUIT_BLOCK,
      checkpoints: [{ id: 'cp-a', label: 'Checkpoint A', laneId: 'GHOST:F:0', s: 100 }, CIRCUIT_BLOCK.checkpoints[1]!],
    };
    const r = buildRaceRoute(bad, graph);
    expect(r.valid).toBe(false);
    expect(r.route).toBeNull();
    expect(formatRouteIssues(r).join(' ')).toMatch(/GHOST/);
  });
});
