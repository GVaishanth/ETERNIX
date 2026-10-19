import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, twinLaneId } from '../traffic/laneGraph';
import { buildRaceRoute, type RaceRoute } from './raceRoute';
import { SPRINT_EASTSIDE } from './raceEvents';
import { buildGridSlots, gridOverlaps } from './grid';
import { trafficDimensions, findTrafficType } from '../traffic/trafficTypes';
import { RACE_CONFIG, RACE_GRID_LANES, RACE_MIN_RACERS } from '../config/raceConfig';

/*
 * The starting grid: ten cars in two lanes. Slot 0 is the front-left car, slot 1 the front-right, slot 2 the second row
 * left, and so on. Each row is one grid row further back than the row before it.
 */

const graph = buildLaneGraph(buildCityNetwork());
const route = buildRaceRoute(SPRINT_EASTSIDE, graph).route as RaceRoute;

describe('starting grid: two lanes, ten cars', () => {
  const slots = buildGridSlots(route, graph, RACE_MIN_RACERS);

  it('seats every car, in two columns of five rows', () => {
    expect(RACE_GRID_LANES).toBe(2);
    expect(slots).toHaveLength(RACE_MIN_RACERS);
    expect(slots.map((slot) => slot.row)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('places row 0 on the grid anchor and each later row one row spacing further back', () => {
    expect(slots[0]!.s).toBe(route.grid.s);
    expect(slots[2]!.s).toBe(route.grid.s - RACE_CONFIG.gridRowSpacingMeters);
    expect(slots[8]!.s).toBe(route.grid.s - 4 * RACE_CONFIG.gridRowSpacingMeters);
  });

  it('uses the route forward lane for the left column, and its twin on the next forward lane for the right', () => {
    const left = route.grid.laneId;
    const right = twinLaneId(left, 1);
    slots.forEach((slot, index) => {
      expect(slot.laneId, `slot ${index}`).toBe(index % 2 === 0 ? left : right);
    });
    expect(graph.byId.has(right)).toBe(true);
  });

  it('keeps rows in travel order: each later row has a smaller route distance', () => {
    for (let row = 1; row < 5; row += 1) {
      expect(slots[2 * row]!.routeD).toBeLessThan(slots[2 * (row - 1)]!.routeD);
      expect(slots[2 * row + 1]!.routeD).toBeLessThan(slots[2 * (row - 1) + 1]!.routeD);
    }
    // The two cars in a row share a route distance: they stand side by side.
    expect(slots[0]!.routeD).toBe(slots[1]!.routeD);
  });

  it('does not overlap for the largest roster vehicle, with a clear margin', () => {
    const longest = Math.max(...['compact', 'sedan', 'suv', 'van'].map((id) => trafficDimensions(findTrafficType(id as 'compact')).lengthMeters));
    expect(gridOverlaps(slots, longest + 2, 2.5)).toEqual([]);
  });

  it('detects an overlap when rows are closer than a vehicle length', () => {
    // Put row 1 only 3 m behind row 0 (its heading is the same), which is closer than a 4.6 m car is long.
    const [first, , , , third] = slots;
    if (!first || !third) throw new Error('grid too short for the test');
    const tight = [first, { ...third, x: first.x - Math.sin(first.yawRadians) * 3, z: first.z - Math.cos(first.yawRadians) * 3 }];
    expect(gridOverlaps(tight, 4.6, 2)).not.toEqual([]);
  });
});
