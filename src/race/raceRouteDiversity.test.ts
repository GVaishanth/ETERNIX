/*
 * Every race has its own path. Two races that drive the same streets are a regression: the player meets the same
 * course again under a different name. This test builds every race on the looping world (the default world) and checks
 * that no two races share an ordered lane path, that no two share more than half their lanes, and that no two races
 * start from the same lane (their beacons would stand in the same place).
 */
import { describe, expect, it } from 'vitest';
import { buildLaneGraph, type LaneGraph } from '../traffic/laneGraph';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { CAREER_RACE_EVENTS } from '../career/careerRaces';
import { buildRaceRoute } from './raceRoute';
import { LOOP_RACE_EVENTS, RACE_EVENTS } from './raceEvents';
import type { RaceEventDefinition } from './raceTypes';

/** Largest share of lanes two races may have in common. Above this, they count as the same course. */
const MAX_SHARED_LANE_SHARE = 0.5;

const graph: LaneGraph = buildLaneGraph(buildLoopCityNetwork());
const events: readonly RaceEventDefinition[] = [...RACE_EVENTS, ...LOOP_RACE_EVENTS, ...CAREER_RACE_EVENTS];

function lanesOf(event: RaceEventDefinition): string[] {
  const result = buildRaceRoute(event, graph);
  expect(result.issues.map((issue) => issue.message), event.id).toEqual([]);
  if (!result.route) throw new Error(`no route for ${event.id}`);
  return [...result.route.laneIds];
}

/** Share of lanes in common: shared lanes over all lanes either race uses (Jaccard index). */
function sharedShare(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const lane of setA) if (setB.has(lane)) shared += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : shared / union;
}

describe('race paths are distinct', () => {
  const paths = new Map<string, string[]>(events.map((event) => [event.id, lanesOf(event)]));

  it('every race in the game is valid on the looping world', () => {
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(paths.get(event.id)?.length ?? 0, event.id).toBeGreaterThan(0);
  });

  it('no two races follow the same ordered lane path', () => {
    const seen = new Map<string, string>();
    for (const event of events) {
      const key = (paths.get(event.id) ?? []).join('|');
      const other = seen.get(key);
      expect(other, `${event.id} repeats the path of ${other}`).toBeUndefined();
      seen.set(key, event.id);
    }
  });

  it('no two races share more than half of their lanes', () => {
    const worst: Array<{ a: string; b: string; share: number }> = [];
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        const a = events[i]!;
        const b = events[j]!;
        const share = sharedShare(paths.get(a.id) ?? [], paths.get(b.id) ?? []);
        if (share > MAX_SHARED_LANE_SHARE) worst.push({ a: a.id, b: b.id, share });
      }
    }
    expect(worst).toEqual([]);
  });

  it('no two races start from the same lane, so their beacons never stand in the same place', () => {
    const startLanes = new Map<string, string>();
    for (const event of events) {
      const other = startLanes.get(event.start.laneId);
      expect(other, `${event.id} starts on the lane of ${other}`).toBeUndefined();
      startLanes.set(event.start.laneId, event.id);
    }
  });

  it('keeps the free-roam races on their own distinct routes', () => {
    const free = RACE_EVENTS.map((event) => event.id);
    expect(free).toEqual(['sprint-eastside', 'circuit-block']);
  });
});
