import { describe, expect, it } from 'vitest';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildCityNetwork, buildLoopCityNetwork } from '../world/city/cityNetwork';
import { CIRCUIT_BLOCK, SPRINT_EASTSIDE } from '../race/raceEvents';
import { buildRaceRoute, type RaceRoute } from '../race/raceRoute';
import { RaceVisualPool, type RaceView } from './raceVisuals';

/*
 * Race markers and the next-gate bar are drawn at the image nearest the car (Stage D, races and navigation). A car one
 * period away from a marker must see it at its own image; a finite world must not move anything.
 */

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
const loopGraph = buildLaneGraph(buildLoopCityNetwork());
const finiteGraph = buildLaneGraph(buildCityNetwork());

function routeOf(graph: typeof loopGraph, event: typeof SPRINT_EASTSIDE): RaceRoute {
  const result = buildRaceRoute(event, graph);
  if (!result.route) throw new Error(`route ${event.id} invalid`);
  return result.route;
}

/** A controller that is free roaming, with the first gate of the route as the next gate. */
function freeRoam(route: RaceRoute) {
  return {
    phase: 'FREE_ROAM' as const,
    activeIndex: (): number => -1,
    nextGatePose: (out: { x: number; z: number; yaw: number }): boolean => {
      const gate = route.gates[0];
      if (!gate) return false;
      out.x = gate.x;
      out.z = gate.z;
      out.yaw = gate.headingRadians;
      return true;
    },
  };
}

function markerOf(pool: RaceVisualPool, eventId: string) {
  const marker = pool.root.getObjectByName(`RaceMarker-${eventId}`);
  if (!marker) throw new Error(`no marker for ${eventId}`);
  return marker;
}

describe('race markers and the next-gate bar across the seam', () => {
  const routes = [routeOf(loopGraph, SPRINT_EASTSIDE), routeOf(loopGraph, CIRCUIT_BLOCK)];

  it('draws a marker at the image nearest the car: one period east of the base marker, when the car is there', () => {
    const pool = new RaceVisualPool(routes);
    for (const route of routes) {
      const view: RaceView = { x: route.marker.x + PERIOD, z: route.marker.z, period: PERIOD };
      pool.sync(freeRoam(route), view);
      const marker = markerOf(pool, route.eventId);
      expect(marker.position.x).toBeCloseTo(route.marker.x + PERIOD, 9);
      expect(marker.position.z).toBeCloseTo(route.marker.z, 9);
    }
    pool.dispose();
  });

  it('keeps the marker at its base position when the car is in the base domain', () => {
    const pool = new RaceVisualPool(routes);
    for (const route of routes) {
      pool.sync(freeRoam(route), { x: route.marker.x, z: route.marker.z, period: PERIOD });
      const marker = markerOf(pool, route.eventId);
      expect(marker.position.x).toBeCloseTo(route.marker.x, 9);
      expect(marker.position.z).toBeCloseTo(route.marker.z, 9);
    }
    pool.dispose();
  });

  it('draws the next-gate bar at the image nearest the car, one period away on both axes', () => {
    const route = routes[0]!;
    const pool = new RaceVisualPool([route]);
    const gate = route.gates[0]!;
    pool.sync(freeRoam(route), { x: gate.x - PERIOD, z: gate.z + PERIOD, period: PERIOD });
    const bar = pool.root.getObjectByName('RaceNextGate');
    expect(bar).toBeDefined();
    expect(bar!.position.x).toBeCloseTo(gate.x - PERIOD, 9);
    expect(bar!.position.z).toBeCloseTo(gate.z + PERIOD, 9);
    pool.dispose();
  });

  it('a finite world never shifts a marker, even for a view far away', () => {
    const route = routeOf(finiteGraph, SPRINT_EASTSIDE);
    const pool = new RaceVisualPool([route]);
    pool.sync(freeRoam(route), { x: route.marker.x + 5000, z: route.marker.z, period: null });
    const marker = markerOf(pool, route.eventId);
    expect(marker.position.x).toBeCloseTo(route.marker.x, 9);
    pool.dispose();
  });
});
