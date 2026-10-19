/*
 * Race visibility: a career race is on the map and in the world only once it is unlocked, and a Division 1 race is
 * removed once Division 1 is complete. Free-roam races are never gated. The render pool and the minimap marks are
 * checked too, because they carry the same flags to the screen. Pure data in, pure data out, except the pool, which
 * is built with a plain controller stub.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultGarage } from '../garage/garageModel';
import { RACE_EVENTS } from '../race/raceEvents';
import type { RaceRoute } from '../race/raceRoute';
import { RaceVisualPool, type RaceMarkSource } from '../render/raceVisuals';
import { getRaceMarks, setRaceEventMarkers, setRaceEventVisibility } from '../ui/minimapRaceMarks';
import { CAREER_EVENTS, CHAMPIONSHIPS, DIVISIONS, careerEventById } from './careerCatalogue';
import { cupScoreKey, careerRaceBlock, careerRaceVisible, createDefaultCareer, eventStatus, startCareer, type ProfileState } from './careerModel';
import type { DivisionDefinition } from './careerTypes';

function newProfile(): ProfileState {
  return { garage: createDefaultGarage(), career: createDefaultCareer() };
}

function startedProfile(): ProfileState {
  const result = startCareer(newProfile());
  if (!result.ok) throw new Error(`test setup: ${result.message}`);
  return result.profile;
}

function division(id: string): DivisionDefinition {
  const found = DIVISIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`test: no division ${id}`);
  return found;
}

function raceIdOf(eventId: string): string {
  const event = careerEventById(eventId);
  if (!event) throw new Error(`test: no career event ${eventId}`);
  return event.raceEventId;
}

/** A profile where every Division 1 event and cup score is done, and the division's champion is defeated. */
function divisionOneComplete(): ProfileState {
  const base = startedProfile();
  const d1 = division('division-1-street-origins');
  const cupScores: Record<string, number> = { ...base.career.cupScores };
  for (const cupId of d1.championshipIds) {
    const cup = CHAMPIONSHIPS.find((candidate) => candidate.id === cupId);
    if (!cup) throw new Error(`test: no cup ${cupId}`);
    for (const eventId of cup.eventIds) cupScores[cupScoreKey(cupId, eventId)] = 1;
  }
  const defeated = d1.championRivalId ? [...base.career.defeatedRivals, d1.championRivalId] : [...base.career.defeatedRivals];
  return {
    ...base,
    career: { ...base.career, completedEvents: [...d1.eventIds], cupScores, defeatedRivals: defeated },
  };
}

describe('career race visibility', () => {
  it('hides a career race before the career starts, and shows free-roam races', () => {
    const profile = newProfile();
    expect(careerRaceVisible(raceIdOf('career-warmup'), profile)).toBe(false);
    for (const race of RACE_EVENTS) expect(careerRaceVisible(race.id, profile)).toBe(true);
  });

  it('shows only the unlocked career races, and reveals the next one when the previous is completed', () => {
    const profile = startedProfile();
    const warmup = raceIdOf('career-warmup');
    const blockLaps = raceIdOf('career-block-laps');
    expect(careerRaceVisible(warmup, profile)).toBe(true);
    expect(careerRaceVisible(blockLaps, profile)).toBe(false);

    const done = { ...profile, career: { ...profile.career, completedEvents: ['career-warmup'] } };
    expect(careerRaceVisible(warmup, done)).toBe(true); // completed stays shown
    expect(careerRaceVisible(blockLaps, done)).toBe(true);
  });

  it('keeps every Division 1 race visible until Division 1 is complete, then removes all of them', () => {
    const d1 = division('division-1-street-origins');
    expect(d1.retireRacesOnComplete).toBe(true);
    const finished = divisionOneComplete();
    const d1Races = d1.eventIds.map(raceIdOf);
    // Sanity: the fixture really completes Division 1 under the model's own rule.
    expect(d1.eventIds.every((eventId) => finished.career.completedEvents.includes(eventId))).toBe(true);
    for (const raceId of d1Races) expect(careerRaceVisible(raceId, finished)).toBe(false);

    const beforeComplete = { ...finished, career: { ...finished.career, defeatedRivals: [] } };
    for (const raceId of d1Races) expect(careerRaceVisible(raceId, beforeComplete)).toBe(true);
  });

  it('does not retire Division 2 races when Division 1 completes, and shows the ones that are unlocked', () => {
    const d2 = division('division-2-urban-syndicate');
    expect(d2.retireRacesOnComplete).toBeFalsy();
    // Warehouse Circuit needs reputation 120 as well as the defeated rival, so the fixture sets it here.
    const base = divisionOneComplete();
    const finished = { ...base, career: { ...base.career, reputation: 120 } };
    const unlocked = d2.eventIds.filter((eventId) => {
      const event = careerEventById(eventId);
      return event !== null && eventStatus(event, finished).status !== 'locked';
    });
    // The fixture must unlock at least one Division 2 race, or this test proves nothing.
    expect(unlocked.length).toBeGreaterThan(0);
    for (const eventId of unlocked) expect(careerRaceVisible(raceIdOf(eventId), finished)).toBe(true);
  });

  it('always shows free-roam races, even after every career race is retired', () => {
    const finished = divisionOneComplete();
    for (const race of RACE_EVENTS) expect(careerRaceVisible(race.id, finished)).toBe(true);
  });

  it('refuses a hidden race with a reason, and does not refuse a visible one', () => {
    const locked = startedProfile();
    const blockLaps = raceIdOf('career-block-laps');
    expect(careerRaceBlock(blockLaps, locked)).toMatch(/.+/);
    expect(careerRaceBlock(raceIdOf('career-warmup'), locked)).toBeNull();

    const retired = divisionOneComplete();
    expect(careerRaceBlock(raceIdOf('career-warmup'), retired)).toMatch(/retired/);
    expect(careerRaceBlock('no-such-free-roam-race', retired)).toBeNull();
  });

  it('gives every career event a race id that the visibility rule knows', () => {
    const profile = startedProfile();
    for (const event of CAREER_EVENTS) {
      expect(typeof careerRaceVisible(event.raceEventId, profile)).toBe('boolean');
    }
  });
});

/** A route stub with the only fields the marker pool reads. */
function stubRoute(eventId: string, x: number): RaceRoute {
  return { eventId, marker: { x, z: 0, yawRadians: 0 } } as unknown as RaceRoute;
}

/** A controller stub that shows every route except the ones listed as hidden. */
function stubController(hidden: ReadonlySet<number>): RaceMarkSource {
  return {
    phase: 'FREE_ROAM',
    activeIndex: () => -1,
    nextGatePose: () => false,
    routeVisible: (index: number) => !hidden.has(index),
  };
}

describe('race beacons and minimap marks follow visibility', () => {
  it('hides a beacon and its minimap point, and keeps the indices stable', () => {
    const routes = [stubRoute('a', 10), stubRoute('b', 20), stubRoute('c', 30)];
    const pool = new RaceVisualPool(routes);
    pool.sync(stubController(new Set([1])), { x: 0, z: 0, period: null });

    // Markers are the first children of the root, in route order. The gate bar is the last child.
    const markers = pool.root.children.slice(0, routes.length);
    expect(markers.map((marker) => marker.visible)).toEqual([true, false, true]);

    const marks = getRaceMarks();
    expect(marks.eventVisible).toEqual([true, false, true]);
    expect(marks.eventMarkers.length).toBe(3);
    pool.dispose();
  });

  it('refreshes the visibility only every 20 frames, not every frame', () => {
    const routes = [stubRoute('a', 10), stubRoute('b', 20)];
    const pool = new RaceVisualPool(routes);
    const view = { x: 0, z: 0, period: null };
    const hidden = new Set([0]);
    pool.sync(stubController(hidden), view);
    expect(pool.root.children[0]?.visible).toBe(false);

    hidden.clear(); // the race unlocks...
    for (let frame = 0; frame < 19; frame += 1) pool.sync(stubController(hidden), view);
    expect(pool.root.children[0]?.visible).toBe(false); // not yet re-read

    pool.sync(stubController(hidden), view); // frame 20: re-read
    expect(pool.root.children[0]?.visible).toBe(true);
    expect(getRaceMarks().eventVisible[0]).toBe(true);
    pool.dispose();
  });

  it('skips a hidden point on the minimap, and the flag can be set back', () => {
    setRaceEventMarkers([{ x: 1, z: 1 }, { x: 2, z: 2 }]);
    setRaceEventVisibility(1, false);
    expect(getRaceMarks().eventVisible).toEqual([true, false]);
    setRaceEventVisibility(1, true);
    expect(getRaceMarks().eventVisible).toEqual([true, true]);
    setRaceEventMarkers([]);
  });
});
