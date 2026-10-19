/*
 * Career expansion (Division 1, championships, best times, police escape, migration). Pure rules first, then the
 * service on the real garage commit path. Every reward is checked to be paid once.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultGarage } from '../garage/garageModel';
import { createGarageService } from '../garage/garageService';
import { RACE_EVENTS } from '../race/raceEvents';
import { RACE_MIN_RACERS } from '../config/raceConfig';
import { SAVE_KEY, type StorageLike } from '../save/saveFile';
import { CAREER_CONFIG } from '../config/careerConfig';
import { CATALOGUE } from '../vehicles/catalogue';
import {
  CAREER_EVENTS,
  CAREER_RANKS,
  CHAMPIONSHIPS,
  DIVISIONS,
  MILESTONES,
  RIVALS,
  validateCareerCatalogue,
} from './careerCatalogue';
import { CAREER_RACE_EVENTS, CAREER_RACE_IDS, CAREER_WARMUP_RACE_ID } from './careerRaces';
import { createCareerService, ALL_RACE_IDS } from './careerService';
import {
  applyRaceOutcome,
  buildCareerView,
  createDefaultCareer,
  cupScoreKey,
  eventStatus,
  mainObjective,
  milestoneViews,
  normalizeCareer,
  pointsForPlace,
  recordPursuitEscape,
  startCareer,
  type CareerState,
  type OutcomeSummary,
  type ProfileState,
  type RaceOutcomeInput,
} from './careerModel';

const KNOWN = new Set<string>([...RACE_EVENTS.map((event) => event.id), ...CAREER_RACE_IDS]);
const CUP = 'street-origins-cup';

function eventById(id: string) {
  const event = CAREER_EVENTS.find((candidate) => candidate.id === id);
  if (!event) throw new Error(`test setup: no event ${id}`);
  return event;
}

function startedProfile(): ProfileState {
  const started = startCareer({ garage: createDefaultGarage(), career: createDefaultCareer() });
  if (!started.ok) throw new Error('test setup: career did not start');
  return started.profile;
}

let attempt = 0;
function run(profile: ProfileState, input: Omit<RaceOutcomeInput, 'sessionId' | 'attemptId'>): { profile: ProfileState; summary: OutcomeSummary | null } {
  attempt += 1;
  const result = applyRaceOutcome(profile, { ...input, sessionId: 'sessexpansion1', attemptId: attempt }, KNOWN);
  if (!result.ok) throw new Error(`test setup: race outcome refused: ${result.message}`);
  return { profile: result.profile, summary: result.summary };
}

function finish(profile: ProfileState, raceEventId: string, place: number, finishSeconds: number | null = 150): { profile: ProfileState; summary: OutcomeSummary | null } {
  return run(profile, { raceEventId, outcome: 'finished', place, finishSeconds, raceCredits: 0 });
}

const REFERENCES = {
  vehicleIds: new Set(CATALOGUE.map((vehicle) => vehicle.id)),
  raceEventIds: new Set([...CAREER_RACE_IDS, ...RACE_EVENTS.map((event) => event.id)]),
};

describe('catalogue: divisions and championships', () => {
  it('validates the real catalogue with no issues', () => {
    expect(validateCareerCatalogue(REFERENCES)).toEqual([]);
  });

  it('has five divisions in order: Divisions 1 and 2 open, the rest planned', () => {
    expect(DIVISIONS.map((division) => division.number)).toEqual([1, 2, 3, 4, 5]);
    expect(DIVISIONS.filter((division) => division.status === 'open').map((division) => division.id)).toEqual([DIV1(), 'division-2-urban-syndicate']);
    for (const division of DIVISIONS.filter((candidate) => candidate.status === 'planned')) {
      expect(division.eventIds, division.id).toEqual([]);
      expect(division.championshipIds, division.id).toEqual([]);
    }
  });

  it('puts every Division 1 event in that division, and no event in two divisions', () => {
    const division = DIVISIONS.find((candidate) => candidate.id === DIV1());
    expect(division?.eventIds).toEqual(['career-warmup', 'career-block-laps', 'career-checkpoint-run', 'career-clock-run', 'rival-mara-challenge']);
    const all = DIVISIONS.flatMap((candidate) => candidate.eventIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('gives every Division 1 event a race route in the career race list', () => {
    for (const eventId of division1Events()) {
      const event = CAREER_EVENTS.find((candidate) => candidate.id === eventId);
      expect(event, eventId).toBeDefined();
      expect(CAREER_RACE_IDS.has(event?.raceEventId ?? ''), eventId).toBe(true);
    }
  });

  it('defines the Street Origins Cup over three races scored by place', () => {
    const cup = CHAMPIONSHIPS.find((candidate) => candidate.id === 'street-origins-cup');
    expect(cup?.eventIds).toEqual(['career-warmup', 'career-block-laps', 'career-checkpoint-run']);
  });

  it('defines the Syndicate Cup over the three Division 2 races', () => {
    const cup = CHAMPIONSHIPS.find((candidate) => candidate.id === 'syndicate-cup');
    expect(cup?.eventIds).toEqual(['career-warehouse-circuit', 'career-seam-run', 'career-tight-corners']);
  });

  it('keeps Teo, Juno and Kai reachable from Mara, as before', () => {
    expect(RIVALS.map((rival) => rival.id)).toEqual(['mara-quill', 'teo-varga', 'juno-ashdown', 'kai-mensah', 'ren-adair']);
    expect(CAREER_EVENTS.find((event) => event.id === 'rival-teo-challenge')?.prerequisites).toEqual([
      { kind: 'rival-defeated', rivalId: 'mara-quill' },
      { kind: 'reputation', min: 40 },
    ]);
  });

  it('has the Shake the Tail milestone for one police escape', () => {
    const milestone = MILESTONES.find((candidate) => candidate.id === 'milestone-shake-the-tail');
    expect(milestone?.requirement).toEqual({ kind: 'pursuit-escapes', count: 1 });
  });
});

describe('catalogue: the validator rejects broken content', () => {
  const base = { ranks: CAREER_RANKS, events: CAREER_EVENTS, rivals: RIVALS, milestones: MILESTONES, championships: CHAMPIONSHIPS, divisions: DIVISIONS };

  function issuesWith(patch: Partial<typeof base>): string[] {
    return validateCareerCatalogue(REFERENCES, { ...base, ...patch });
  }

  it('flags a planned division that holds events', () => {
    const broken = DIVISIONS.map((division) => (division.number === 3 ? { ...division, eventIds: ['career-warmup'] } : division));
    expect(issuesWith({ divisions: broken }).some((line) => line.includes('planned division "division-3-highway-collective" must not have events'))).toBe(true);
  });

  it('flags an open division with no events', () => {
    const broken = DIVISIONS.map((division) => (division.number === 1 ? { ...division, eventIds: [] } : division));
    expect(issuesWith({ divisions: broken }).some((line) => line.includes('open division "division-1-street-origins" has no events'))).toBe(true);
  });

  it('flags an event that is in two divisions', () => {
    const broken = DIVISIONS.map((division) => (division.number === 2 ? { ...division, status: 'open' as const, eventIds: ['career-warmup'] } : division));
    expect(issuesWith({ divisions: broken }).some((line) => line.includes('is in two divisions'))).toBe(true);
  });

  it('flags a champion rival that does not exist', () => {
    const broken = DIVISIONS.map((division) => (division.number === 1 ? { ...division, championRivalId: 'nobody' } : division));
    expect(issuesWith({ divisions: broken }).some((line) => line.includes('unknown champion rival "nobody"'))).toBe(true);
  });

  it('flags a division number out of order', () => {
    const broken = DIVISIONS.map((division) => (division.number === 3 ? { ...division, number: 4 } : division));
    expect(issuesWith({ divisions: broken }).some((line) => line.includes('must be number 3'))).toBe(true);
  });

  it('flags an event that is in two championships', () => {
    const broken = [...CHAMPIONSHIPS, { id: 'second-cup', name: 'Second', summary: 'x', eventIds: ['career-warmup'], reward: { reputation: 0, credits: 0 } }];
    expect(issuesWith({ championships: broken }).some((line) => line.includes('is in two championships'))).toBe(true);
  });

  it('flags a time-attack event inside a championship', () => {
    const broken = [{ ...CHAMPIONSHIPS[0]!, eventIds: ['career-clock-run'] }];
    expect(issuesWith({ championships: broken }).some((line) => line.includes('must be a race scored by place'))).toBe(true);
  });

  it('flags a format that does not match the event kind', () => {
    const broken = CAREER_EVENTS.map((event) => (event.id === 'career-warmup' ? { ...event, format: 'rival' as const } : event));
    expect(issuesWith({ events: broken }).some((line) => line.includes('does not match kind'))).toBe(true);
  });
});

describe('best times', () => {
  it('records the first finish time and keeps only a faster one', () => {
    let profile = startedProfile();
    ({ profile } = finish(profile, 'career-warmup-race', 2, 150));
    expect(profile.career.bestTimes['career-warmup']).toBe(150);
    ({ profile } = finish(profile, 'career-warmup-race', 2, 160));
    expect(profile.career.bestTimes['career-warmup']).toBe(150);
    ({ profile } = finish(profile, 'career-warmup-race', 2, 140));
    expect(profile.career.bestTimes['career-warmup']).toBe(140);
  });

  it('does not record a time for a timeout or an abort', () => {
    let profile = startedProfile();
    ({ profile } = run(profile, { raceEventId: 'career-warmup-race', outcome: 'timeout', place: null, finishSeconds: 90, raceCredits: 0 }));
    ({ profile } = run(profile, { raceEventId: 'career-warmup-race', outcome: 'aborted', place: null, finishSeconds: 50, raceCredits: 0 }));
    expect(profile.career.bestTimes).toEqual({});
  });

  it('reports a new best time in the summary', () => {
    const profile = startedProfile();
    const first = finish(profile, 'career-warmup-race', 2, 150);
    expect(first.summary?.newBestTime).toBe(true);
    const slower = finish(first.profile, 'career-warmup-race', 2, 170);
    expect(slower.summary?.newBestTime).toBe(false);
  });

  it('shows the best time on the event row of the view', () => {
    let profile = startedProfile();
    ({ profile } = finish(profile, 'career-warmup-race', 2, 151.25));
    const row = buildCareerView(profile).events.find((event) => event.id === 'career-warmup');
    expect(row?.bestSeconds).toBe(151.25);
  });
});

describe('championship: points by place and the cup reward', () => {
  it('scores by place from the table, and a place past the table scores zero', () => {
    expect(pointsForPlace(1)).toBe(CAREER_CONFIG.championshipPointsByPlace[0]);
    expect(pointsForPlace(CAREER_CONFIG.championshipPointsByPlace.length + 1)).toBe(0);
    expect(pointsForPlace(0)).toBe(0);
    expect(pointsForPlace(1.5)).toBe(0);
  });

  it('keeps each event at its best points, so a worse replay does not lower it', () => {
    let profile = startedProfile();
    ({ profile } = finish(profile, 'career-warmup-race', 2));
    expect(profile.career.cupScores[cupScoreKey(CUP, 'career-warmup')]).toBe(pointsForPlace(2));
    ({ profile } = finish(profile, 'career-warmup-race', 4));
    expect(profile.career.cupScores[cupScoreKey(CUP, 'career-warmup')]).toBe(pointsForPlace(2));
    ({ profile } = finish(profile, 'career-warmup-race', 1));
    expect(profile.career.cupScores[cupScoreKey(CUP, 'career-warmup')]).toBe(pointsForPlace(1));
  });

  it('is not complete with a timeout in one of its races, and a timeout scores nothing', () => {
    let profile = startedProfile();
    ({ profile } = finish(profile, 'career-warmup-race', 1));
    ({ profile } = finish(profile, 'career-block-race', 1));
    ({ profile } = run(profile, { raceEventId: 'career-checkpoint-race', outcome: 'timeout', place: null, finishSeconds: null, raceCredits: 0 }));
    expect(profile.career.cupScores[cupScoreKey(CUP, 'career-checkpoint-run')]).toBeUndefined();
    expect(profile.career.grantedRewards).not.toContain(`championship:${CUP}:complete`);
  });

  it('pays the cup reward exactly once, when the third race is finished', () => {
    let profile = startedProfile();
    ({ profile } = finish(profile, 'career-warmup-race', 1));
    ({ profile } = finish(profile, 'career-block-race', 2));
    const before = profile.garage.credits;
    const last = finish(profile, 'career-checkpoint-race', 3);
    expect(last.summary?.championshipsWon).toEqual(['Street Origins Cup']);
    expect(last.summary?.championshipPoints).toBe(pointsForPlace(3));
    expect(last.profile.career.grantedRewards.filter((key) => key === `championship:${CUP}:complete`)).toHaveLength(1);
    // The cup pays 400 credits. Milestones paid in the same commit (three events completed) add to the balance too.
    expect(last.profile.garage.credits - before).toBeGreaterThanOrEqual(400);
    const replay = finish(last.profile, 'career-checkpoint-race', 1);
    expect(replay.summary?.championshipsWon).toEqual([]);
    expect(replay.profile.garage.credits).toBe(last.profile.garage.credits);
  });
});

describe('Division 1: completion and the next step', () => {
  function playDivisionOne(): ProfileState {
    let profile = startedProfile();
    ({ profile } = finish(profile, 'career-warmup-race', 2));
    ({ profile } = finish(profile, 'career-block-race', 1));
    ({ profile } = finish(profile, 'career-checkpoint-race', 3));
    ({ profile } = finish(profile, 'career-clock-race', 1));
    return profile;
  }

  it('Division 2 stays locked until Mara is beaten, then runs its races and pays its reward once', () => {
    // Before Mara is beaten, the first Division 2 event is locked (its prerequisites are not met).
    expect(eventStatus(eventById('career-warehouse-circuit'), startedProfile()).status).toBe('locked');

    let profile = playDivisionOne();
    ({ profile } = finish(profile, 'rival-mara-race', 1));
    expect(buildCareerView(profile).currentDivisionId).toBe('division-2-urban-syndicate');

    ({ profile } = finish(profile, 'career-warehouse-race', 1));
    ({ profile } = finish(profile, 'career-seam-race', 1));
    ({ profile } = finish(profile, 'career-tight-race', 1));
    expect(profile.career.grantedRewards).toContain('championship:syndicate-cup:complete');
    expect(profile.career.grantedRewards).not.toContain('division:division-2-urban-syndicate:complete');

    const win = finish(profile, 'rival-adair-race', 1);
    expect(win.summary?.rivalDefeated).toBe('Ren Adair');
    expect(win.summary?.divisionsCompleted).toEqual(['Urban Syndicate']);
    expect(win.profile.career.grantedRewards.filter((key) => key === 'division:division-2-urban-syndicate:complete')).toHaveLength(1);
    expect(buildCareerView(win.profile).currentDivisionId).toBeNull();
  });

  it('does not complete before the champion rival is defeated', () => {
    const profile = playDivisionOne();
    const view = buildCareerView(profile);
    const division = view.divisions.find((candidate) => candidate.id === DIV1());
    expect(division?.eventsDone).toBe(4);
    expect(division?.championshipsDone).toBe(1);
    expect(division?.championDefeated).toBe(false);
    expect(division?.complete).toBe(false);
    // Mara's challenge is the last open step: winning it is the defeat.
    expect(mainObjective(profile)).toBe('Street Origins: Mara Quill: Dock Run.');
  });

  it('completes after the champion is beaten, and pays the division reward once', () => {
    let profile = playDivisionOne();
    const beforeMara = profile.garage.credits;
    const win = finish(profile, 'rival-mara-race', 1);
    profile = win.profile;
    expect(win.summary?.rivalDefeated).toBe('Mara Quill');
    expect(win.summary?.divisionsCompleted).toEqual(['Street Origins']);
    // Mara's reward (400 credits) and the division reward (500 credits) are paid in this commit. Ranks and milestones can add more.
    expect(profile.garage.credits - beforeMara).toBeGreaterThanOrEqual(400 + 500);
    expect(profile.career.grantedRewards.filter((key) => key === `division:${DIV1()}:complete`)).toHaveLength(1);

    const replay = finish(profile, 'rival-mara-race', 1);
    expect(replay.summary?.divisionsCompleted).toEqual([]);
    expect(replay.profile.garage.credits).toBe(profile.garage.credits);
    expect(buildCareerView(replay.profile).divisions.find((candidate) => candidate.id === DIV1())?.complete).toBe(true);
  });

  it('moves the main objective on to Division 2 once Division 1 is complete', () => {
    const profile = playDivisionOne();
    const done = finish(profile, 'rival-mara-race', 1).profile;
    expect(mainObjective(done)).toBe('Urban Syndicate: Warehouse Circuit.');
    expect(buildCareerView(done).currentDivisionId).toBe('division-2-urban-syndicate');
  });

  it('shows the current division, and the planned divisions as not open', () => {
    const view = buildCareerView(startedProfile());
    expect(view.currentDivisionId).toBe(DIV1());
    expect(view.divisions.map((division) => division.status)).toEqual(['open', 'open', 'planned', 'planned', 'planned']);
    expect(view.divisions.slice(2).every((division) => division.eventsTotal === 0)).toBe(true);
  });

  it('shows the cup standings with points from each finish', () => {
    let profile = startedProfile();
    ({ profile } = finish(profile, 'career-warmup-race', 1));
    const cup = buildCareerView(profile).championships[0];
    expect(cup?.points).toBe(pointsForPlace(1));
    expect(cup?.events.find((event) => event.id === 'career-warmup')).toEqual({ id: 'career-warmup', title: 'Harbour Warm-Up', finished: true, points: pointsForPlace(1) });
    expect(cup?.complete).toBe(false);
  });

  it('pays the first clock-run finish reputation, then nothing more for a faster replay', () => {
    let profile = startedProfile();
    ({ profile } = finish(profile, 'career-warmup-race', 1));
    const first = finish(profile, 'career-clock-race', 1, 120);
    expect(first.summary?.reputationGained).toBe(15);
    const replay = finish(first.profile, 'career-clock-race', 1, 110);
    expect(replay.summary?.reputationGained).toBe(0);
    expect(replay.profile.career.bestTimes['career-clock-run']).toBe(110);
  });
});

describe('police escape milestone', () => {
  it('counts nothing before the career starts', () => {
    const profile: ProfileState = { garage: createDefaultGarage(), career: createDefaultCareer() };
    const result = recordPursuitEscape(profile);
    expect(result.profile.career.pursuitEscapes).toBe(0);
    expect(result.milestones).toEqual([]);
  });

  it('pays Shake the Tail once, and counts later escapes without paying again', () => {
    const started = startedProfile();
    const before = started.garage.credits;
    const first = recordPursuitEscape(started);
    expect(first.profile.career.pursuitEscapes).toBe(1);
    expect(first.milestones).toEqual(['Shake the Tail']);
    expect(first.profile.garage.credits - before).toBe(250);
    expect(first.profile.career.completedMilestones).toContain('milestone-shake-the-tail');

    const second = recordPursuitEscape(first.profile);
    expect(second.profile.career.pursuitEscapes).toBe(2);
    expect(second.milestones).toEqual([]);
    expect(second.profile.garage.credits).toBe(first.profile.garage.credits);
  });

  it('shows the escape progress on the milestone view', () => {
    const view = milestoneViews(recordPursuitEscape(startedProfile()).profile).find((candidate) => candidate.milestone.id === 'milestone-shake-the-tail');
    expect(view).toMatchObject({ done: true, current: 1, target: 1 });
  });
});

describe('save data: version 2, migration, and malformed input', () => {
  const v1: Record<string, unknown> = {
    version: 1,
    started: true,
    reputation: 40,
    completedEvents: ['career-warmup', 'rival-mara-challenge'],
    defeatedRivals: ['mara-quill'],
    completedMilestones: ['milestone-first-event'],
    grantedRewards: ['rank:rank-street-regular', 'objective:career-warmup:under-200s', 'rival:mara-quill:defeat'],
    processedAttempts: ['career-warmup-race#abc123.1'],
    trackedEventId: 'rival-teo-challenge',
  };

  it('migrates a version 1 career: existing progress is kept, new fields get safe defaults, and no repair is reported', () => {
    const report = normalizeCareer(v1);
    expect(report.repairs).toEqual([]);
    expect(report.state.version).toBe(2);
    expect(report.state.reputation).toBe(40);
    expect(report.state.completedEvents).toEqual(['career-warmup', 'rival-mara-challenge']);
    expect(report.state.defeatedRivals).toEqual(['mara-quill']);
    expect(report.state.bestTimes).toEqual({});
    expect(report.state.cupScores).toEqual({});
    expect(report.state.pursuitEscapes).toBe(0);
  });

  it('keeps processed attempt keys from a real finish across a reload', () => {
    const { profile } = finish(startedProfile(), 'career-warmup-race', 2);
    expect(profile.career.processedAttempts).toHaveLength(1);
    const report = normalizeCareer(JSON.parse(JSON.stringify(profile.career)));
    expect(report.state.processedAttempts).toEqual(profile.career.processedAttempts);
    expect(report.repairs).toEqual([]);
  });

  it('keeps the rival defeat reward key on load (it was dropped before this change)', () => {
    const report = normalizeCareer(v1);
    expect(report.state.grantedRewards).toContain('rival:mara-quill:defeat');
  });

  it('repairs malformed version 2 fields without resetting the career', () => {
    const report = normalizeCareer({
      ...v1,
      version: 2,
      bestTimes: { 'career-warmup': -1, 'no-such-event': 5, 'career-clock-run': 90 },
      cupScores: { [`${CUP}:career-warmup`]: 99, 'bogus:career-warmup': 1, [`${CUP}:career-clock-run`]: 2 },
      pursuitEscapes: -3,
    });
    expect(report.state.reputation).toBe(40);
    expect(report.state.bestTimes).toEqual({ 'career-clock-run': 90 });
    expect(report.state.cupScores).toEqual({});
    expect(report.state.pursuitEscapes).toBe(0);
    expect(report.repairs.length).toBeGreaterThanOrEqual(3);
  });

  it('treats a non-object best-time or cup field as empty, with a repair line', () => {
    const report = normalizeCareer({ ...v1, bestTimes: 'fast', cupScores: [1, 2] });
    expect(report.state.bestTimes).toEqual({});
    expect(report.state.cupScores).toEqual({});
    expect(report.repairs.some((line) => line.includes('best times were not an object'))).toBe(true);
    expect(report.repairs.some((line) => line.includes('championship scores were not an object'))).toBe(true);
  });

  it('keeps a valid v2 career unchanged on a second normalize', () => {
    const once = normalizeCareer(v1).state;
    const twice = normalizeCareer(once);
    expect(twice.repairs).toEqual([]);
    expect(twice.state).toEqual(once);
  });

  it('a default career has the new fields empty', () => {
    const career: CareerState = createDefaultCareer();
    expect(career.bestTimes).toEqual({});
    expect(career.cupScores).toEqual({});
    expect(career.pursuitEscapes).toBe(0);
  });
});

describe('service: an escape is saved and survives a reload', () => {
  class MemoryStorage implements StorageLike {
    readonly items = new Map<string, string>();
    getItem(key: string): string | null {
      return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      this.items.set(key, value);
    }
  }

  it('records the escape through the garage commit path and reloads it', () => {
    const storage = new MemoryStorage();
    const garage = createGarageService(storage, { now: () => 0 });
    const career = createCareerService(garage, ALL_RACE_IDS);
    expect(career.start().ok).toBe(true);
    expect(career.recordEscape().ok).toBe(true);
    expect(career.profile().career.pursuitEscapes).toBe(1);
    expect(storage.getItem(SAVE_KEY)).toContain('"pursuitEscapes":1');

    const reloaded = createGarageService(storage, { now: () => 0 });
    const reloadedCareer = createCareerService(reloaded, ALL_RACE_IDS);
    expect(reloadedCareer.profile().career.pursuitEscapes).toBe(1);
    expect(reloadedCareer.profile().career.completedMilestones).toContain('milestone-shake-the-tail');
  });

  it('has the warm-up race id that the cup and the rival chain both use', () => {
    expect(CAREER_RACE_EVENTS.map((event) => event.id)).toContain(CAREER_WARMUP_RACE_ID);
  });
});

describe('race definitions for the new events', () => {
  it('the checkpoint run has a time limit and a ten-racer field', () => {
    const race = CAREER_RACE_EVENTS.find((event) => event.id === 'career-checkpoint-race');
    expect(race?.timeLimitSeconds).toBe(240);
    expect(race?.opponentCount).toBe(RACE_MIN_RACERS - 1);
  });

  it('the clock run has no opponents and no time limit', () => {
    const race = CAREER_RACE_EVENTS.find((event) => event.id === 'career-clock-race');
    expect(race?.opponentCount).toBe(0);
    expect(race?.timeLimitSeconds).toBeNull();
  });

  it('the block laps race has a ten-racer field', () => {
    const race = CAREER_RACE_EVENTS.find((event) => event.id === 'career-block-race');
    expect(race?.opponentCount).toBe(RACE_MIN_RACERS - 1);
  });

  it('every career race has its own marker, so no two career events share a beacon', () => {
    const markers = CAREER_RACE_EVENTS.map((event) => `${event.marker.laneId}@${event.marker.s}`);
    expect(new Set(markers).size).toBe(markers.length);
  });
});

function DIV1(): string {
  return DIVISIONS[0]!.id;
}

function division1Events(): string[] {
  return [...(DIVISIONS.find((division) => division.id === DIV1())?.eventIds ?? [])];
}
