import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, nearestOnLane, type LaneGraph } from '../traffic/laneGraph';
import { LaneRouter } from './policeRouting';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';

/*
 * The heap search and the bounding-box skip must give the same answers as the plain algorithms they replaced. The
 * reference below is the original linear-scan Dijkstra and brute-force nearest lane, written out plainly. The sample is
 * deterministic (fixed-seed generator), so a failure reproduces.
 */

function referenceRoute(graph: LaneGraph, from: number, to: number): number[] | null {
  const count = graph.lanes.length;
  const indexById = new Map(graph.lanes.map((lane, index) => [lane.id, index] as const));
  // Edges: successor links cost nothing extra, lane changes cost the lane-change penalty.
  const edges = graph.lanes.map((lane) => [
    ...lane.successorIds.map((id) => ({ to: indexById.get(id), extra: 0 })),
    ...lane.lateralIds.map((id) => ({ to: indexById.get(id), extra: PURSUIT_CONFIG.routing.laneChangeCostMeters })),
  ].filter((edge): edge is { to: number; extra: number } => edge.to !== undefined));
  const dist = new Array<number>(count).fill(Number.POSITIVE_INFINITY);
  const done = new Array<boolean>(count).fill(false);
  const previous = new Array<number>(count).fill(-1);
  dist[from] = 0;
  for (;;) {
    let current = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < count; index += 1) {
      if (!done[index] && dist[index]! < best) {
        best = dist[index]!;
        current = index;
      }
    }
    if (current < 0 || current === to) break;
    done[current] = true;
    const step = best + graph.lanes[current]!.lengthMeters;
    for (const edge of edges[current] ?? []) {
      const next = edge.to;
      if (done[next]) continue;
      if (step + edge.extra < dist[next]!) {
        dist[next] = step + edge.extra;
        previous[next] = current;
      }
    }
  }
  if (!Number.isFinite(dist[to]!)) return null;
  const path: number[] = [];
  for (let at = to; at !== -1; at = previous[at]!) {
    path.push(at);
    if (at === from) break;
  }
  return path.reverse();
}

describe('police routing equivalence on the city graph', () => {
  const graph = buildLaneGraph(buildCityNetwork());
  const router = new LaneRouter(graph);

  it('gives the same lane chain as the reference search for 60 fixed-seed pairs', () => {
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const count = graph.lanes.length;
    let compared = 0;
    // The reference is O(V^2) over about 3,000 lanes, so the sample is kept small enough for the default test budget.
    for (let n = 0; n < 60; n += 1) {
      const from = Math.floor(next() * count);
      const to = Math.floor(next() * count);
      const fast = router.route(from, to, null);
      const slow = referenceRoute(graph, from, to);
      expect(fast, `route ${from} -> ${to}`).toEqual(slow);
      if (fast) compared += 1;
    }
    expect(compared).toBeGreaterThan(20);
  }, 30_000);

  it('finds the same nearest lane as a brute-force scan of every lane', () => {
    const points = [
      { x: -100, z: -1.8 },
      { x: 0, z: 0 },
      { x: 333, z: -287 },
      { x: -612, z: 412 },
    ];
    for (const point of points) {
      const hit = router.nearestLane(point.x, point.z, null, Math.PI, 1000);
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      graph.lanes.forEach((lane, index) => {
        const exact = nearestOnLane(lane, point.x, point.z);
        if (exact && exact.distance < bestDistance) {
          bestDistance = exact.distance;
          bestIndex = index;
        }
      });
      expect(hit?.distance ?? null).toBe(bestIndex >= 0 ? bestDistance : null);
    }
  });
});
