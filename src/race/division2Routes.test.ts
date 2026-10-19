/*
 * Division 2 (Urban Syndicate) race routes on the hillside district (Division 2 phase 5). Each of the four races is on
 * the loop, on the hill, within the grade limit, and keeps its traffic and time limit. Distinct paths are checked for
 * every race in raceRouteDiversity.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { divisionById } from '../career/careerCatalogue';
import { CAREER_RACE_EVENTS } from '../career/careerRaces';
import { buildLaneGraph, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { buildRaceRoute, type RaceRoute } from './raceRoute';
import type { RaceEventDefinition } from './raceTypes';

const GRADE_LIMIT = 0.08;
const graph: LaneGraph = buildLaneGraph(buildLoopCityNetwork());
const laneById = new Map<string, LanePath>(graph.lanes.map((lane) => [lane.id, lane]));

/** The Division 2 races, by their race ids. The rival race is the Syndicate's own challenge (Ren Adair). */
const DIVISION_2_RACE_IDS = ['career-warehouse-race', 'career-seam-race', 'career-tight-race', 'rival-adair-race'] as const;

function raceOf(id: string): RaceEventDefinition {
  const event = CAREER_RACE_EVENTS.find((candidate) => candidate.id === id);
  if (!event) throw new Error(`no race ${id}`);
  return event;
}

function routeOf(id: string): RaceRoute {
  const result = buildRaceRoute(raceOf(id), graph);
  if (!result.route) throw new Error(`route ${id} invalid`);
  return result.route;
}

/** Hillside lanes: the strip's streets (columns 6 and 7) and their junctions. */
const HILLSIDE_LANE = /^(H|V)-[67]-|^J-[67]-/;

describe('Division 2 races on the hillside district', () => {
  it('the division lists these races, and each one is a race in the game', () => {
    const division = divisionById('division-2-urban-syndicate');
    expect(division).not.toBeNull();
    expect(division?.eventIds.length).toBe(4);
    for (const id of DIVISION_2_RACE_IDS) expect(CAREER_RACE_EVENTS.some((event) => event.id === id), id).toBe(true);
  });

  it.each(DIVISION_2_RACE_IDS)('%s validates on the loop and starts on the hillside', (id) => {
    const route = routeOf(id);
    expect(route.laneIds.length).toBeGreaterThan(0);
    expect(raceOf(id).marker.laneId).toMatch(HILLSIDE_LANE);
    expect(route.laneIds.some((laneId) => HILLSIDE_LANE.test(laneId))).toBe(true);
  });

  it.each(DIVISION_2_RACE_IDS)('%s climbs the hill and stays within the 8 percent grade limit', (id) => {
    const route = routeOf(id);
    let highest = 0;
    let worstGrade = 0;
    for (const laneId of route.laneIds) {
      const lane = laneById.get(laneId);
      if (!lane) throw new Error(`lane ${laneId} is not in the graph`);
      for (let k = 0; k < lane.points.length; k += 1) {
        highest = Math.max(highest, lane.points[k]?.y ?? 0);
        if (k === 0) continue;
        const run = (lane.s[k] ?? 0) - (lane.s[k - 1] ?? 0);
        if (run > 0) worstGrade = Math.max(worstGrade, Math.abs((lane.points[k]?.y ?? 0) - (lane.points[k - 1]?.y ?? 0)) / run);
      }
    }
    // The ridge reaches 12 m. A route on the hill's rows climbs well above 3 m.
    expect(highest).toBeGreaterThan(3);
    expect(worstGrade).toBeLessThanOrEqual(GRADE_LIMIT + 1e-6);
  });

  it('keeps each race\'s traffic and time limit', () => {
    expect(raceOf('career-warehouse-race').trafficOnRoute).toBe(true);
    expect(raceOf('career-seam-race').trafficOnRoute).toBe(true);
    expect(raceOf('career-tight-race').trafficOnRoute).toBe(true);
    expect(raceOf('rival-adair-race').trafficOnRoute).toBe(true);
    expect(raceOf('career-tight-race').timeLimitSeconds).toBe(210);
    expect(raceOf('career-warehouse-race').timeLimitSeconds ?? null).toBeNull();
  });

  it('the Seam Run crosses the loop seam on the crest row, and the Circuit races are two laps', () => {
    const seam = routeOf('career-seam-race');
    expect(seam.laneIds).toContain('H-7-2:F:0');
    expect(seam.laneIds.some((laneId) => laneId.startsWith('J--4-2'))).toBe(true);
    expect(raceOf('career-warehouse-race').laps).toBe(2);
    expect(raceOf('rival-adair-race').laps).toBe(2);
  });
});
