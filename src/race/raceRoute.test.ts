import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, type LaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute, type RouteIssueCode } from './raceRoute';
import { SPRINT_EASTSIDE } from './raceEvents';
import type { RaceEventDefinition } from './raceTypes';

function freshGraph(): LaneGraph {
  return buildLaneGraph(buildCityNetwork());
}

function withEvent(patch: Partial<RaceEventDefinition>): RaceEventDefinition {
  return { ...SPRINT_EASTSIDE, ...patch };
}

function codes(event: RaceEventDefinition, graph: LaneGraph = freshGraph()): RouteIssueCode[] {
  return buildRaceRoute(event, graph).issues.map((issue) => issue.code);
}

describe('route validation: the Eastside Sprint on the city graph', () => {
  const result = buildRaceRoute(SPRINT_EASTSIDE, freshGraph());

  it('is valid with no issues', () => {
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.route).not.toBeNull();
  });

  it('runs on connected street lanes from the start lane to the finish, in order', () => {
    const route = result.route!;
    expect(route.cyclic).toBe(false);
    expect(route.laneIds[0]).toBe('H-0-0:F:0');
    expect(route.laneIds[route.laneIds.length - 1]).toBe('H-3-2:F:0');
    // The route visits the checkpoint lanes in order.
    const at = (id: string) => route.laneIds.indexOf(id);
    expect(at('H-2-0:F:0')).toBeGreaterThan(0);
    expect(at('V-3-1:F:0')).toBeGreaterThan(at('H-2-0:F:0'));
    expect(at('H-3-2:F:0')).toBeGreaterThan(at('V-3-1:F:0'));
  });

  it('has gates in strictly increasing route distance, finish last and closing the lap', () => {
    const gates = result.route!.gates;
    expect(gates.map((g) => g.id)).toEqual(['cp-1', 'cp-2', 'finish']);
    for (let i = 1; i < gates.length; i += 1) {
      expect(gates[i]!.routeDistanceMeters).toBeGreaterThan(gates[i - 1]!.routeDistanceMeters);
    }
    expect(gates[gates.length - 1]!.closesLap).toBe(true);
    expect(gates[0]!.closesLap).toBe(false);
  });

  it('puts every gate on the road centre, not the lane offset', () => {
    // H-2-0:F:0 has offset 1.8 to the right of +X travel, so the centre is 1.8 m to the left of the lane (z larger).
    const cp1 = result.route!.gates[0]!;
    // H-2-0 starts at x = 10.2 (junction pad), so s = 90 is x = 100.2 on the road centre.
    expect(cp1.x).toBeCloseTo(100.2, 1);
    expect(cp1.z).toBeCloseTo(-400, 6);
    expect(cp1.headingRadians).toBeCloseTo(Math.PI / 2, 6);
  });

  it('gives the AI a successor map that follows the route, with no wrap for a sprint', () => {
    const route = result.route!;
    expect(route.nextLaneId.get('H-0-0:F:0')).toBe('J-1-0:west>east:0');
    expect(route.nextLaneId.has(route.laneIds[route.laneIds.length - 1]!)).toBe(false);
  });

  it('places the grid on the first lane, and the marker outside the drivable boundary', () => {
    const route = result.route!;
    expect(route.grid.laneId).toBe('H-0-0:F:0');
    // The start anchor sits 65 m along the lane, so six grid rows (60 m back, 12 m apart) fit with the last row 5 m from the lane start.
    expect(route.grid.s).toBe(65);
    const marker = route.marker;
    // Marker is left of the eastbound lane, so z is larger than the road centre (-400) by at least 10.5 m.
    expect(Math.abs(marker.z - -400)).toBeGreaterThanOrEqual(10.5);
  });

  it('has a polyline with increasing route distance from 0 to the route length', () => {
    const { ds } = result.route!.polyline;
    expect(ds[0]).toBe(0);
    for (let i = 1; i < ds.length; i += 1) expect(ds[i]!).toBeGreaterThanOrEqual(ds[i - 1]!);
    expect(ds[ds.length - 1]!).toBeLessThanOrEqual(result.route!.totalMeters + 1e-6);
    expect(ds[ds.length - 1]!).toBeGreaterThan(result.route!.totalMeters - 10);
  });
});

describe('route validation: diagnostics for invalid events', () => {
  it('reports a missing lane by id', () => {
    const issues = buildRaceRoute(withEvent({ checkpoints: [{ id: 'cp-1', label: 'x', laneId: 'NOPE:F:0', s: 90 }] }), freshGraph()).issues;
    expect(issues.some((i) => i.code === 'anchor-missing-lane' && i.ids.includes('NOPE:F:0'))).toBe(true);
  });

  it('refuses a gate on a connector lane', () => {
    const issues = buildRaceRoute(withEvent({ checkpoints: [{ id: 'cp-1', label: 'x', laneId: 'J-1-0:west>east:0', s: 10 }] }), freshGraph()).issues;
    expect(issues.some((i) => i.code === 'anchor-not-segment' && i.ids.includes('cp-1'))).toBe(true);
  });

  it('refuses an anchor within the edge clearance of a lane end', () => {
    expect(codes(withEvent({ checkpoints: [{ id: 'cp-1', label: 'x', laneId: 'H-2-0:F:0', s: 1 }] }))).toContain('anchor-at-lane-end');
  });

  it('refuses an anchor beyond the end of its lane', () => {
    expect(codes(withEvent({ checkpoints: [{ id: 'cp-1', label: 'x', laneId: 'H-2-0:F:0', s: 500 }] }))).toContain('anchor-outside-lane');
  });

  it('refuses checkpoints out of travel order on the same lane (second one behind the first)', () => {
    const issues = buildRaceRoute(withEvent({
      checkpoints: [
        { id: 'cp-1', label: 'x', laneId: 'H-2-0:F:0', s: 120 },
        { id: 'cp-2', label: 'y', laneId: 'H-2-0:F:0', s: 60 },
      ],
    }), freshGraph()).issues;
    expect(issues.some((i) => i.code === 'order-not-increasing' && i.ids.includes('cp-2'))).toBe(true);
  });

  it('refuses a gate placed behind the start line on a sprint', () => {
    expect(codes(withEvent({ checkpoints: [{ id: 'cp-1', label: 'x', laneId: 'H-0-0:F:0', s: 20 }] }))).toContain('order-not-increasing');
  });

  it('refuses a route whose leg has no drivable path (a disconnected lane)', () => {
    const graph = freshGraph();
    const broken = graph.byId.get('H-2-0:F:0');
    expect(broken).toBeDefined();
    broken!.successorIds = [];
    expect(codes(SPRINT_EASTSIDE, graph)).toContain('leg-unreachable');
  });

  it('refuses a sprint with more than one lap', () => {
    expect(codes(withEvent({ laps: 2 }))).toContain('laps-invalid');
  });

  it('refuses a grid that does not fit behind the start on its lane', () => {
    expect(codes(withEvent({ start: { id: 'start', label: 'Start', laneId: 'H-0-0:F:0', s: 12 } }))).toContain('grid-does-not-fit');
  });

  it('refuses a marker on the road, and a marker that names a missing lane', () => {
    expect(codes(withEvent({ marker: { laneId: 'H-0-0:F:0', s: 40, sideOffsetMeters: -3 } }))).toContain('marker-too-close-to-road');
    expect(codes(withEvent({ marker: { laneId: 'GHOST:F:0', s: 40, sideOffsetMeters: -11.5 } }))).toContain('marker-missing-lane');
  });

  it('refuses a duplicate anchor id', () => {
    expect(codes(withEvent({ checkpoints: [{ id: 'start', label: 'x', laneId: 'H-2-0:F:0', s: 90 }] }))).toContain('anchor-duplicate-id');
  });

  it('returns no route for an invalid event, and never throws', () => {
    const result = buildRaceRoute(withEvent({ laps: 0 }), freshGraph());
    expect(result.valid).toBe(false);
    expect(result.route).toBeNull();
  });
});
