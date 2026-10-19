/*
 * Race markers and the next-gate bar stand on the road (Division 2 phase 3). Before this, both sat at height zero, so on
 * the hillside they were buried in the ground or floated above it.
 */
import { describe, expect, it } from 'vitest';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { SPRINT_EASTSIDE } from '../race/raceEvents';
import { buildRaceRoute, type RaceRoute } from '../race/raceRoute';
import { roadElevationFor, type RoadElevation } from '../world/roadElevation';
import { RaceVisualPool, type RaceView } from './raceVisuals';

const loopGraph = buildLaneGraph(buildLoopCityNetwork());

function routeOn(): RaceRoute {
  const result = buildRaceRoute(SPRINT_EASTSIDE, loopGraph);
  if (!result.route) throw new Error('route invalid');
  return result.route;
}

/** A controller free roaming, with the first gate of the route as the next gate. */
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

/** A surface that rises with x, so each object's height is easy to predict. */
const slope: RoadElevation = {
  isFlat: false,
  surfaceAt: (x) => ({ heightMeters: 0.01 * x + 3, grade: 0.01 }),
};

describe('race markers and the gate stand on the road', () => {
  it('a marker takes the road height under it, not zero', () => {
    const route = routeOn();
    const pool = new RaceVisualPool([route], slope);
    const view: RaceView = { x: route.marker.x, z: route.marker.z, period: null };
    pool.sync(freeRoam(route), view);
    const marker = pool.root.getObjectByName(`RaceMarker-${route.eventId}`);
    expect(marker?.position.y).toBeCloseTo(0.01 * route.marker.x + 3, 9);
    pool.dispose();
  });

  it('the next-gate bar takes the road height under it', () => {
    const route = routeOn();
    const pool = new RaceVisualPool([route], slope);
    const gate = route.gates[0]!;
    pool.sync(freeRoam(route), { x: gate.x, z: gate.z, period: null });
    const bar = pool.root.getObjectByName('RaceNextGate');
    expect(bar?.position.y).toBeCloseTo(0.01 * gate.x + 3, 9);
    pool.dispose();
  });

  it('with no elevation (a flat city) the markers and the gate stay at height zero', () => {
    const route = routeOn();
    const pool = new RaceVisualPool([route]);
    const gate = route.gates[0]!;
    pool.sync(freeRoam(route), { x: gate.x, z: gate.z, period: null });
    expect(pool.root.getObjectByName(`RaceMarker-${route.eventId}`)?.position.y).toBe(0);
    expect(pool.root.getObjectByName('RaceNextGate')?.position.y).toBe(0);
    pool.dispose();
  });

  it('on the real loop, a marker sits at the height of the road under it', () => {
    const route = routeOn();
    const elevation = roadElevationFor(loopGraph);
    const pool = new RaceVisualPool([route], elevation);
    pool.sync(freeRoam(route), { x: route.marker.x, z: route.marker.z, period: null });
    const expected = elevation.surfaceAt(route.marker.x, route.marker.z, route.marker.yawRadians)?.heightMeters ?? 0;
    expect(pool.root.getObjectByName(`RaceMarker-${route.eventId}`)?.position.y).toBeCloseTo(expected, 9);
    pool.dispose();
  });
});
