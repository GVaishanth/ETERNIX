/*
 * Navigation shows the shortest route by distance. The fewest-lanes search (findLanePath) can pick a long lane over a
 * short detour, so navigation uses findShortestLanePath, which weighs each lane by its length. These tests check the
 * weighting on a small graph where the two answers differ, and that on the real city the shortest route is never
 * longer than the fewest-lanes one.
 */
import { describe, expect, it } from 'vitest';
import { findLanePath, findShortestLanePath } from '../traffic/lanePlanner';
import type { LaneGraph, LanePath } from '../traffic/laneGraph';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { routeMeters } from './navigationPath';

function lane(id: string, lengthMeters: number, successorIds: string[]): LanePath {
  return { id, lengthMeters, successorIds } as unknown as LanePath;
}

function graphOf(lanes: LanePath[]): LaneGraph {
  return { lanes, byId: new Map(lanes.map((item) => [item.id, item])) };
}

describe('shortest route by distance', () => {
  // A -> X -> B is three lanes, one of them 1000 m long. A -> C -> D -> B is four lanes of 10 m each. The fewest-lanes
  // search takes X (3 lanes); the shortest route is the 30 m detour through C and D.
  const small = graphOf([
    lane('A', 10, ['C', 'X']),
    lane('B', 10, []),
    lane('C', 10, ['D']),
    lane('D', 10, ['B']),
    lane('X', 1000, ['B']),
  ]);

  it('takes the short detour, where the fewest-lanes search takes the long lane', () => {
    expect(findLanePath(small, 'A', 'B')).toEqual(['A', 'X', 'B']);
    expect(findShortestLanePath(small, 'A', 'B')).toEqual(['A', 'C', 'D', 'B']);
  });

  it('returns null when there is no route, and the start itself for a zero-length route', () => {
    expect(findShortestLanePath(small, 'B', 'A')).toBeNull();
    expect(findShortestLanePath(small, 'A', 'A')).toEqual(['A']);
  });

  it('is deterministic: the same inputs give the same route', () => {
    expect(findShortestLanePath(small, 'A', 'B')).toEqual(findShortestLanePath(small, 'A', 'B'));
  });
});

describe('shortest route on the city', () => {
  const graph = buildLaneGraph(buildLoopCityNetwork());
  const ids = graph.lanes.map((item) => item.id);

  it('is never longer than the fewest-lanes route, for sampled pairs of lanes', () => {
    // Pairs are made reachable by walking successor edges from a start lane, so every sample has a route.
    let compared = 0;
    for (let i = 0; i < ids.length; i += Math.max(1, Math.floor(ids.length / 25))) {
      const from = ids[i];
      if (from === undefined) continue;
      let to = from;
      for (let step = 0; step < 15; step += 1) to = graph.byId.get(to)?.successorIds[(i + step) % 2] ?? graph.byId.get(to)?.successorIds[0] ?? to;
      const fewest = findLanePath(graph, from, to);
      const shortest = findShortestLanePath(graph, from, to);
      expect(fewest, `${from} -> ${to}`).not.toBeNull();
      expect(shortest, `${from} -> ${to}`).not.toBeNull();
      compared += 1;
      const metres = (path: string[]) => path.reduce((sum, id) => sum + (graph.byId.get(id)?.lengthMeters ?? 0), 0);
      expect(metres(shortest ?? []), `${from} -> ${to}`).toBeLessThanOrEqual(metres(fewest ?? []) + 1e-6);
      // Every step follows a successor edge, so the route is drivable.
      for (let k = 1; k < (shortest ?? []).length; k += 1) {
        expect(graph.byId.get((shortest ?? [])[k - 1] ?? '')?.successorIds).toContain((shortest ?? [])[k]);
      }
    }
    expect(compared).toBeGreaterThan(5);
  });

  it('measures a route in metres from the car point to the goal point', () => {
    const from = ids[0];
    const route = from ? findShortestLanePath(graph, from, from) : null;
    expect(route).toEqual([from]);
    const lane0 = graph.byId.get(from ?? '');
    expect(lane0).toBeDefined();
    const metres = routeMeters(graph, [from ?? ''], { laneId: from ?? '', s: 2, distance: 0 }, { kind: 'career', label: '', laneId: from ?? '', s: 10, x: 0, z: 0 });
    expect(metres).toBe(8);
  });
});
