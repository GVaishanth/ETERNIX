import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute, type RaceRoute } from './raceRoute';
import { SPRINT_EASTSIDE } from './raceEvents';
import { createRacerProgress, type RacerProgress } from './raceProgress';
import { rankRacers } from './standings';

const route = buildRaceRoute(SPRINT_EASTSIDE, buildLaneGraph(buildCityNetwork())).route as RaceRoute;

function racer(id: string, x: number, z: number, gates = 0, routeD = 0): RacerProgress {
  const r = createRacerProgress(id, 'opponent', id, x, z, routeD);
  r.gatesPassed = gates;
  r.routeD = routeD;
  // Leg progress is measured from the last gate. These racers have passed no gate yet, so it starts at 0.
  r.legRefD = 0;
  return r;
}

describe('standings', () => {
  it('ranks more gates passed ahead of any leg progress', () => {
    const a = racer('a', 0, 0, 1, 500);
    const b = racer('b', 0, 0, 0, 900);
    const order = rankRacers([b, a], route).map((r) => r.id);
    expect(order).toEqual(['a', 'b']);
  });

  it('ranks by leg progress when gates are equal', () => {
    const a = racer('a', 0, 0, 1, 500);
    const b = racer('b', 0, 0, 1, 700);
    expect(rankRacers([a, b], route).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('ranks finished racers by finish order, ahead of any unfinished racer', () => {
    const late = racer('late', 0, 0, 3, 1000);
    const first = racer('first', 0, 0, 3, 1000);
    first.finished = true;
    first.finishOrder = 1;
    const second = racer('second', 0, 0, 3, 1000);
    second.finished = true;
    second.finishOrder = 2;
    expect(rankRacers([late, second, first], route).map((r) => r.id)).toEqual(['first', 'second', 'late']);
  });

  it('breaks exact ties by the listed order, so the order is stable and matches the grid', () => {
    const b = racer('b', 0, 0, 1, 500);
    const a = racer('a', 0, 0, 1, 500);
    expect(rankRacers([b, a], route).map((r) => r.id)).toEqual(['b', 'a']);
    expect(rankRacers([a, b], route).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('does not rank by straight-line distance: a racer nearer the finish in the air still trails on the route', () => {
    // Same gates, but "air" is close to the finish. Leg progress is measured on the route, so this racer trails.
    const trailing = racer('trailing', route.gates[2]!.x, route.gates[2]!.z, 2, 100);
    const leading = racer('leading', 0, 0, 2, 600);
    expect(rankRacers([trailing, leading], route).map((r) => r.id)).toEqual(['leading', 'trailing']);
  });

  it('assigns 1-based positions', () => {
    const rows = rankRacers([racer('a', 0, 0, 0, 1), racer('b', 0, 0, 0, 2), racer('c', 0, 0, 0, 3)], route);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
  });
});
