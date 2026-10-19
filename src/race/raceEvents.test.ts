import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildCityScenery, type CityScenery, type Footprint } from '../world/city/cityScenery';
import { buildLaneGraph, laneSample, type LaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute, type RaceRoute } from './raceRoute';
import { RACE_EVENTS, SPRINT_EASTSIDE } from './raceEvents';
import { buildGridSlots } from './grid';
import { rightFromYaw } from '../core/coordinates';

const graph: LaneGraph = buildLaneGraph(buildCityNetwork());
const scenery: CityScenery = buildCityScenery();

function insideFootprint(x: number, z: number, f: Footprint, margin: number): boolean {
  return x >= f.x0 - margin && x <= f.x1 + margin && z >= f.z0 - margin && z <= f.z1 + margin;
}

/** Every prop that could stand on a point: buildings, lamps, trees, signs. Returns the first clash, or null. */
function clashAt(x: number, z: number): string | null {
  for (const b of scenery.buildings) if (insideFootprint(x, z, b.footprint, 2)) return `building ${b.id}`;
  for (const l of scenery.lamps) if (Math.hypot(x - l.x, z - l.z) < 2) return `lamp ${l.id}`;
  for (const t of scenery.trees) if (Math.hypot(x - t.x, z - t.z) < t.crownRadius + 1) return `tree ${t.id}`;
  for (const s of scenery.signs) if (Math.hypot(x - s.x, z - s.z) < 1.5) return `sign ${s.id}`;
  return null;
}

describe('race events on the city', () => {
  it('every defined event validates against the city graph', () => {
    for (const event of RACE_EVENTS) {
      const result = buildRaceRoute(event, graph);
      expect(result.issues.map((i) => i.message), event.id).toEqual([]);
      expect(result.valid, event.id).toBe(true);
    }
  });

  it('the Eastside Sprint marker stands exactly its offset from the road centre', () => {
    const route = buildRaceRoute(SPRINT_EASTSIDE, graph).route as RaceRoute;
    const lane = graph.byId.get(SPRINT_EASTSIDE.marker.laneId)!;
    const pose = laneSample(lane, SPRINT_EASTSIDE.marker.s);
    const right = rightFromYaw(pose.heading);
    // Road centre is the lane centre moved back by the lane offset.
    const cx = pose.x - right.x * lane.offsetMeters;
    const cz = pose.z - right.z * lane.offsetMeters;
    const distance = Math.hypot(route.marker.x - cx, route.marker.z - cz);
    expect(distance).toBeCloseTo(Math.abs(SPRINT_EASTSIDE.marker.sideOffsetMeters), 6);
  });

  it('the Eastside Sprint marker is not inside a building, lamp, tree, or sign', () => {
    const route = buildRaceRoute(SPRINT_EASTSIDE, graph).route as RaceRoute;
    expect(clashAt(route.marker.x, route.marker.z)).toBeNull();
  });

  it('gates and grid rows are clear of buildings and street props', () => {
    const route = buildRaceRoute(SPRINT_EASTSIDE, graph).route as RaceRoute;
    for (const gate of route.gates) {
      // Gates are on the road, and street props stay outside the drivable boundary, so this should always be clear.
      expect(clashAt(gate.x, gate.z), `gate ${gate.id}`).toBeNull();
    }
    for (const slot of buildGridSlots(route, graph, SPRINT_EASTSIDE.opponentCount + 1)) {
      expect(clashAt(slot.x, slot.z), `grid row ${slot.row}`).toBeNull();
    }
  });
});
