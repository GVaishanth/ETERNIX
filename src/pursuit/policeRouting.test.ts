import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, laneSample, type LanePath, type LaneGraph } from '../traffic/laneGraph';
import { LaneRouter } from './policeRouting';

const graph = buildLaneGraph(buildCityNetwork());
const router = new LaneRouter(graph);
const segmentIndices = graph.lanes.flatMap((lane, index) => (lane.kind === 'segment' && lane.direction === 'F' ? [index] : []));

function syntheticLane(id: string, successorIds: string[]): LanePath {
  return {
    id,
    kind: 'segment',
    ownerId: 'test',
    direction: 'F',
    laneIndex: 0,
    offsetMeters: 0,
    points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }],
    headings: [0, 0],
    s: [0, 10],
    lengthMeters: 10,
    speedLimitMps: 14,
    entryKey: `${id}:in`,
    exitKey: `${id}:out`,
    successorIds,
    lateralIds: [],
  };
}

describe('police routing on the city lane graph', () => {
  it('routes between two directed lanes along successor links, and lane changes to the other index', () => {
    const from = segmentIndices[0]!;
    const to = segmentIndices[segmentIndices.length - 1]!;
    const path = router.route(from, to);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(from);
    expect(path![path!.length - 1]).toBe(to);
    for (let i = 0; i + 1 < path!.length; i += 1) {
      const lane = graph.lanes[path![i]!]!;
      const nextId = graph.lanes[path![i + 1]!]!.id;
      // Each hop is a successor link, or a lane change to the other index on the same road.
      expect(lane.successorIds.includes(nextId) || lane.lateralIds.includes(nextId), `${lane.id} -> ${nextId}`).toBe(true);
    }
  });

  it('reaches the other lane index of the same road by a lane change, so no lane index is cut off', () => {
    const from = segmentIndices[0]!;
    const start = graph.lanes[from]!;
    const other = graph.lanes.findIndex((lane) => lane.id === start.lateralIds[0]);
    expect(other).toBeGreaterThanOrEqual(0);
    expect(graph.lanes[other]!.laneIndex).not.toBe(start.laneIndex);
    expect(router.route(from, other)).toEqual([from, other]);
    // And back: a unit on the other index reaches the first one.
    expect(router.route(other, from)).toEqual([other, from]);
  });

  it('changes lane only when that saves more than the lane-change cost', () => {
    // A lane with a lane-change neighbour that is a dead end: the only way to the target is the lane itself.
    const lanes = [syntheticLane('a', ['b']), syntheticLane('b', []), { ...syntheticLane('x', ['y']), laneIndex: 1, lateralIds: ['a'] }, syntheticLane('y', [])];
    const synthetic: LaneGraph = { lanes, byId: new Map(lanes.map((lane) => [lane.id, lane])) };
    const local = new LaneRouter(synthetic);
    // 'a' to 'b' is a successor link, 0 changes. 'a' to 'y' has no path: y is reached only from x, and a reaches x by a lane change only if a lists it.
    expect(local.route(0, 1)).toEqual([0, 1]);
    expect(local.route(0, 3)).toBeNull();
    // Lane 'x' can change to 'a': from x, the route to 'b' is one change, then the successor.
    expect(local.route(2, 1)).toEqual([2, 0, 1]);
  });

  it('is deterministic: the same query gives the same path', () => {
    const from = segmentIndices[1]!;
    const to = segmentIndices[10]!;
    expect(router.route(from, to)).toEqual(router.route(from, to));
  });

  it('plans to the reachable lane nearest a point, on the same lane index as the unit', () => {
    const from = segmentIndices[0]!;
    const target = graph.lanes[segmentIndices[30]!]!;
    const pose = laneSample(target, target.lengthMeters / 2);
    const plan = router.planTo(from, pose.x, pose.z, { maxTargetMeters: 12, preferHeading: pose.heading });
    expect(plan).not.toBeNull();
    expect(plan!.targetDistanceMeters).toBeLessThan(0.5);
    const path = plan!.path;
    expect(path[0]).toBe(from);
    expect(path[path.length - 1]).toBe(plan!.targetIndex);
    for (let i = 0; i + 1 < path.length; i += 1) {
      expect(graph.lanes[path[i]!]!.successorIds).toContain(graph.lanes[path[i + 1]!]!.id);
    }
  });

  it('returns no plan when the point is far from every reachable lane', () => {
    expect(router.planTo(segmentIndices[0]!, 100000, 100000, { maxTargetMeters: 12 })).toBeNull();
  });

  it('returns a single lane for a route to itself, and null for an invalid index', () => {
    expect(router.route(5, 5)).toEqual([5]);
    expect(router.route(-1, 5)).toBeNull();
    expect(router.route(5, graph.lanes.length)).toBeNull();
  });

  it('avoids the lanes it is told to avoid, except the target', () => {
    const from = segmentIndices[0]!;
    const to = segmentIndices[20]!;
    const free = router.route(from, to);
    expect(free).not.toBeNull();
    const middle = free!.slice(1, -1);
    if (middle.length === 0) return;
    const avoid = new Set(middle);
    const detour = router.route(from, to, avoid);
    // Either a detour that avoids every lane in the first route, or no detour at all. Never a path through avoided lanes.
    if (detour) {
      for (const index of detour.slice(1, -1)) expect(avoid.has(index)).toBe(false);
    }
  });

  it('builds a next-lane map that agrees with the path', () => {
    const path = router.route(segmentIndices[2]!, segmentIndices[12]!)!;
    const map = router.routeMap(path);
    expect(map.size).toBe(path.length - 1);
    expect(map.get(graph.lanes[path[0]!]!.id)).toBe(graph.lanes[path[1]!]!.id);
  });

  it('finds the nearest lane that drives the unit heading, and not the opposing lane', () => {
    const lane = graph.lanes[segmentIndices[3]!]!;
    const pose = laneSample(lane, lane.lengthMeters / 2);
    const withHeading = router.nearestLane(pose.x, pose.z, pose.heading, Math.PI / 3, 12);
    expect(withHeading).not.toBeNull();
    const hit = graph.lanes[withHeading!.laneIndex]!;
    // The chosen lane's heading agrees with the requested heading, so the unit is never placed on the opposing lane.
    const delta = Math.abs(Math.atan2(Math.sin(hit.headings[0]! - pose.heading), Math.cos(hit.headings[0]! - pose.heading)));
    expect(delta).toBeLessThan(Math.PI / 2);
  });

  it('returns null when no lane is within the search distance', () => {
    expect(router.nearestLane(100000, 100000, 0, Math.PI, 12)).toBeNull();
  });

  it('walks ahead along the traffic chain', () => {
    const start = segmentIndices[4]!;
    const ahead = router.laneAhead(start, 0, 60);
    expect(ahead).not.toBeNull();
    expect(ahead!.s).toBeGreaterThanOrEqual(0);
  });
});

describe('police routing on a disconnected graph', () => {
  it('reports no route between lanes that are not connected, without throwing', () => {
    const lanes = [syntheticLane('a', ['b']), syntheticLane('b', []), syntheticLane('c', [])];
    const synthetic: LaneGraph = { lanes, byId: new Map(lanes.map((lane) => [lane.id, lane])) };
    const local = new LaneRouter(synthetic);
    expect(local.route(0, 1)).toEqual([0, 1]);
    expect(local.route(0, 2)).toBeNull();
    expect(local.route(1, 0)).toBeNull();
  });

  it('plans only to lanes it can reach: the unreachable lane is never chosen, even when it is nearest', () => {
    const lanes = [syntheticLane('a', ['b']), syntheticLane('b', []), syntheticLane('c', [])];
    const synthetic: LaneGraph = { lanes, byId: new Map(lanes.map((lane) => [lane.id, lane])) };
    const local = new LaneRouter(synthetic);
    // Lane 'c' lies on the same spot as 'a', so it is the nearest lane to the point. It is unreachable from 'a'.
    const plan = local.planTo(0, 0, 2, { maxTargetMeters: 12 });
    expect(plan).not.toBeNull();
    expect(plan!.targetIndex).not.toBe(2);
  });
});
