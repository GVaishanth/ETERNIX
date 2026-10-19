/*
 * Automated integration checks (Part 9): a career rival race runs through the existing race director, names its rival,
 * reports one official result per attempt, and the career hub gate refuses the hub while a race or pursuit is on.
 */
import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, type LaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute, type RaceRoute } from '../race/raceRoute';
import { RaceDirector, type RaceResult } from '../race/raceDirector';
import { RewardLedger } from '../race/rewards';
import { CAREER_RACE_EVENTS } from './careerRaces';
import { evaluateCareerHubGate } from './careerHubGate';

const graph: LaneGraph = buildLaneGraph(buildCityNetwork());

function directorFor(raceId: string, onResult: ((result: RaceResult) => void) | null = null) {
  const event = CAREER_RACE_EVENTS.find((candidate) => candidate.id === raceId);
  if (!event) throw new Error(`no career race ${raceId}`);
  const route = buildRaceRoute(event, graph).route as RaceRoute;
  return { event, director: new RaceDirector(event, route, graph, new RewardLedger(), event.opponentCount, onResult) };
}

describe('career rival races in the existing race director', () => {
  it('the rival race names its rival in the standings', () => {
    const { director } = directorFor('rival-mara-race');
    expect(director.openApproach()).toBe(true);
    expect(director.start()).toBe(true);
    director.refreshStandings();
    const names = director.standings.map((row) => row.name);
    expect(names).toContain('Mara Quill');
    expect(names).toContain('You');
  });

  it('a free-roam race keeps its generic opponent label', () => {
    const event = CAREER_RACE_EVENTS.find((candidate) => candidate.id === 'career-warmup-race');
    if (!event) throw new Error('no warm-up race');
    const route = buildRaceRoute(event, graph).route as RaceRoute;
    const director = new RaceDirector({ ...event, opponents: undefined }, route, graph, new RewardLedger(), 1);
    expect(director.openApproach()).toBe(true);
    expect(director.start()).toBe(true);
    director.refreshStandings();
    expect(director.standings.map((row) => row.name)).toContain('Rival A');
  });

  it('an aborted attempt reports exactly one official result, with no reward', () => {
    const results: RaceResult[] = [];
    const { director } = directorFor('rival-mara-race', (result) => results.push(result));
    expect(director.openApproach()).toBe(true);
    expect(director.start()).toBe(true);
    // An abort is a result only once the race is running. During the countdown a cancel produces no result.
    for (let step = 0; step < 60 * 10 && director.state !== 'RACING'; step += 1) director.update(1 / 60);
    expect(director.state).toBe('RACING');
    expect(director.abort()).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0]?.outcome).toBe('aborted');
    expect(results[0]?.reward).toBeNull();
    expect(results[0]?.eventId).toBe('rival-mara-race');
  });
});

describe('career hub gate', () => {
  it('opens when no race is running and no pursuit is on', () => {
    expect(evaluateCareerHubGate({ racePhase: 'FREE_ROAM', pursuitState: 'INACTIVE' })).toEqual({ allowed: true });
    expect(evaluateCareerHubGate({ racePhase: 'EVENT_APPROACH', pursuitState: 'INACTIVE' })).toEqual({ allowed: true });
    expect(evaluateCareerHubGate({ racePhase: 'FINISHED', pursuitState: 'INACTIVE' })).toEqual({ allowed: true });
  });

  it('refuses while a race is on, with a reason', () => {
    for (const racePhase of ['COUNTDOWN', 'RACING', 'PAUSED'] as const) {
      const decision = evaluateCareerHubGate({ racePhase, pursuitState: 'INACTIVE' });
      expect(decision.allowed, racePhase).toBe(false);
      if (!decision.allowed) expect(decision.reason).toMatch(/race/);
    }
  });

  it('refuses while a pursuit is on, with a reason', () => {
    const decision = evaluateCareerHubGate({ racePhase: 'FREE_ROAM', pursuitState: 'PURSUING' });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toMatch(/police/);
  });
});
