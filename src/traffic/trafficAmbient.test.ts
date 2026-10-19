import { describe, expect, it } from 'vitest';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, laneSample } from './laneGraph';
import { AmbientTrafficGenerator } from './trafficAmbient';
import { findLanePath, findRouteThrough } from './lanePlanner';

/*
 * Ambient generator and lane planner (Part 5). The generator only proposes; these tests check its window, its bounds,
 * and its determinism. The planner is checked against a route the graph is known to contain.
 */

const graph = buildLaneGraph(buildCityNetwork());
const player = { x: -100, z: -1.8, yaw: Math.PI / 2, speed: 12 };

describe('ambient traffic generator', () => {
  it('proposes spawns between the configured distances, never ahead of the player', () => {
    const generator = new AmbientTrafficGenerator(graph, { seed: 42 });
    let proposals = 0;
    for (let k = 0; k < 400; k += 1) {
      const request = generator.next(player, 0, TRAFFIC_CONFIG.ambient.intervalSeconds);
      if (!request) continue;
      proposals += 1;
      const lane = graph.byId.get(request.laneId);
      expect(lane).toBeDefined();
      if (!lane) continue;
      const point = laneSample(lane, request.s);
      const dx = point.x - player.x;
      const dz = point.z - player.z;
      const distance = Math.hypot(dx, dz);
      expect(distance).toBeGreaterThanOrEqual(TRAFFIC_CONFIG.ambient.minDistanceMeters);
      expect(distance).toBeLessThanOrEqual(TRAFFIC_CONFIG.ambient.maxDistanceMeters);
      const cosine = (dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw)) / distance;
      expect(cosine).toBeLessThanOrEqual(TRAFFIC_CONFIG.ambient.maxForwardCosine + 1e-9);
      expect(request.s).toBeGreaterThan(0);
      expect(request.s).toBeLessThan(lane.lengthMeters);
      expect(request.cruiseSpeedMps).toBeLessThanOrEqual(lane.speedLimitMps + 1e-9);
    }
    expect(proposals).toBeGreaterThan(20);
  });

  it('is deterministic for a seed and stops proposing when the population reaches the target', () => {
    const a = new AmbientTrafficGenerator(graph, { seed: 7 });
    const b = new AmbientTrafficGenerator(graph, { seed: 7 });
    const seqA: string[] = [];
    const seqB: string[] = [];
    for (let k = 0; k < 200; k += 1) {
      seqA.push(JSON.stringify(a.next(player, 0, TRAFFIC_CONFIG.ambient.intervalSeconds)));
      seqB.push(JSON.stringify(b.next(player, 0, TRAFFIC_CONFIG.ambient.intervalSeconds)));
    }
    expect(seqA).toEqual(seqB);
    const full = new AmbientTrafficGenerator(graph, { seed: 7 });
    for (let k = 0; k < 50; k += 1) {
      expect(full.next(player, TRAFFIC_CONFIG.ambient.targetCount, TRAFFIC_CONFIG.ambient.intervalSeconds)).toBeNull();
    }
  });

  it('does nothing before a decision is due', () => {
    const generator = new AmbientTrafficGenerator(graph, { seed: 3 });
    expect(generator.next(player, 0, TRAFFIC_CONFIG.ambient.intervalSeconds / 4)).toBeNull();
  });
});

describe('lane planner', () => {
  it('finds a route between two lanes that follows successor edges', () => {
    const route = findLanePath(graph, 'H-0-2:F:0', 'V-4-1:F:0');
    expect(route).not.toBeNull();
    if (!route) return;
    expect(route[0]).toBe('H-0-2:F:0');
    expect(route[route.length - 1]).toBe('V-4-1:F:0');
    for (let k = 0; k + 1 < route.length; k += 1) {
      const lane = graph.byId.get(route[k] ?? '');
      expect(lane?.successorIds).toContain(route[k + 1]);
    }
  });

  it('returns null for unknown lanes and chains waypoints without repeating a lane', () => {
    expect(findLanePath(graph, 'nope', 'H-0-2:F:0')).toBeNull();
    const route = findRouteThrough(graph, ['H-0-2:F:0', 'H-2-0:F:0', 'V-4-1:F:0']);
    expect(route).not.toBeNull();
    if (!route) return;
    expect(new Set(route).size).toBe(route.length);
  });
});
