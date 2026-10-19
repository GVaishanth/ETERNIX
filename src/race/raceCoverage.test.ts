/*
 * Route coverage and Division 1/2 difficulty (route rewrite). The career races drive many more of the city's streets
 * than the first routes did, every designed street is driven in order, and Division 2 rivals are harder than Division 1
 * rivals without a speed cap above the fastest car (300 km/h).
 */
import { describe, expect, it } from 'vitest';
import { CAREER_RACE_EVENTS } from '../career/careerRaces';
import { RACE_CONFIG } from '../config/raceConfig';
import { buildLaneGraph, type LaneGraph } from '../traffic/laneGraph';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { buildRaceRoute } from './raceRoute';
import { eventRivalPaceMps, rivalSpeedCapMps } from './pace';
import type { RaceEventDefinition } from './raceTypes';

const graph: LaneGraph = buildLaneGraph(buildLoopCityNetwork());

const DIVISION_1_RACE_IDS = ['career-warmup-race', 'career-block-race', 'career-checkpoint-race', 'career-clock-race', 'rival-mara-race'];
const DIVISION_2_RACE_IDS = ['career-warehouse-race', 'career-seam-race', 'career-tight-race', 'rival-adair-race'];

/** The fastest car's top speed, m/s (300 km/h). */
const TOP_SPEED_CAP_MPS = 300 / 3.6;

/** Street lanes only (H- and V-). Junction connectors are not streets. */
const isStreetLane = (laneId: string): boolean => /^(H|V)-/.test(laneId);
const streetOf = (laneId: string): string => laneId.split(':')[0] ?? laneId;

function raceOf(id: string): RaceEventDefinition {
  const event = CAREER_RACE_EVENTS.find((candidate) => candidate.id === id);
  if (!event) throw new Error(`no race ${id}`);
  return event;
}

/** The distinct streets driven by a set of races. */
function streetsDriven(ids: readonly string[]): Set<string> {
  const streets = new Set<string>();
  for (const id of ids) {
    const result = buildRaceRoute(raceOf(id), graph);
    if (!result.route) throw new Error(`route ${id} is invalid`);
    for (const laneId of result.route.laneIds) if (isStreetLane(laneId)) streets.add(streetOf(laneId));
  }
  return streets;
}

describe('race routes: designed streets are driven in order', () => {
  const withVia = CAREER_RACE_EVENTS.filter((event) => (event.legVia?.length ?? 0) > 0);

  it('the nine Division 1 and Division 2 races have a via list, and no other race does', () => {
    const designed = [...DIVISION_1_RACE_IDS, ...DIVISION_2_RACE_IDS].sort();
    expect(withVia.map((event) => event.id).sort()).toEqual(designed);
  });

  it.each(withVia.map((event) => event.id))('%s drives each via street, in order', (id) => {
    const event = raceOf(id);
    const result = buildRaceRoute(event, graph);
    if (!result.route) throw new Error(`route ${id} is invalid`);
    const wanted = (event.legVia ?? []).flat().map((anchor) => anchor.laneId);
    let next = 0;
    for (const laneId of result.route.laneIds) {
      if (next < wanted.length && laneId === wanted[next]) next += 1;
    }
    expect(next, `${id}: ${wanted.length - next} via streets are not driven in order`).toBe(wanted.length);
  });
});

describe('race routes: coverage of the city streets', () => {
  it('Division 1 drives at least 65 streets, Division 2 at least 45', () => {
    expect(streetsDriven(DIVISION_1_RACE_IDS).size).toBeGreaterThanOrEqual(65);
    expect(streetsDriven(DIVISION_2_RACE_IDS).size).toBeGreaterThanOrEqual(45);
  });

  it('the career races together drive at least 110 streets (39 before the rewrite)', () => {
    expect(streetsDriven([...DIVISION_1_RACE_IDS, ...DIVISION_2_RACE_IDS]).size).toBeGreaterThanOrEqual(110);
  });
});

describe('Division 2 rivals are harder than Division 1 rivals', () => {
  it('every Division 2 race is on the hardest difficulty', () => {
    for (const id of DIVISION_2_RACE_IDS) expect(raceOf(id).difficulty, id).toBe(3);
  });

  it('no rival is capped above the fastest car at any grid place', () => {
    for (const id of [...DIVISION_1_RACE_IDS, ...DIVISION_2_RACE_IDS]) {
      const event = raceOf(id);
      if (event.opponentCount === 0) continue;
      for (let place = 1; place <= RACE_CONFIG.placePaceFactor.length; place += 1) {
        expect(rivalSpeedCapMps(eventRivalPaceMps(event), place), `${id} at place ${place}`).toBeLessThanOrEqual(TOP_SPEED_CAP_MPS + 1e-9);
      }
    }
  });

  it('the slowest Division 2 rival pace is above the fastest Division 1 rival pace', () => {
    const division1 = DIVISION_1_RACE_IDS.map((id) => raceOf(id)).filter((event) => event.opponentCount > 0);
    const division2 = DIVISION_2_RACE_IDS.map((id) => raceOf(id));
    const fastest1 = Math.max(...division1.map((event) => eventRivalPaceMps(event)));
    const slowest2 = Math.min(...division2.map((event) => eventRivalPaceMps(event)));
    expect(slowest2).toBeGreaterThan(fastest1);
  });
});
