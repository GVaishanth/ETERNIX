/*
 * Automated tests for the career model (Part 9): initialization, normalization, ranks and their boundaries, unlocks and
 * their reasons, race outcomes (wins, losses, retries, replays, aborts), rivals, the leaderboard, milestones, and the
 * one-time rules. Pure data in, pure data out: no storage and no React.
 */
import { describe, expect, it } from 'vitest';
import { CAREER_CONFIG } from '../config/careerConfig';
import { createDefaultGarage, ownedVehicleIds } from '../garage/garageModel';
import { RACE_EVENTS } from '../race/raceEvents';
import { vehicleDefinition } from '../vehicles/catalogue';
import { CAREER_RANKS, RIVALS, careerEventById } from './careerCatalogue';
import type { CareerEventDefinition } from './careerTypes';
import { CAREER_RACE_IDS } from './careerRaces';
import {
  applyRaceOutcome,
  buildCareerView,
  careerRaceBlock,
  createDefaultCareer,
  eventStatus,
  leaderboard,
  milestoneViews,
  normalizeCareer,
  nextRivalTarget,
  prerequisiteReasons,
  rankFor,
  rankProgress,
  settleCareer,
  startCareer,
  trackEvent,
  type ProfileState,
  type RaceOutcome,
} from './careerModel';

/** The catalogue event for an id. A missing id is a test bug, so it fails loudly. */
function eventById(id: string): CareerEventDefinition {
  const event = careerEventById(id);
  if (!event) throw new Error(`test: no career event ${id}`);
  return event;
}

const KNOWN_RACE_IDS: ReadonlySet<string> = new Set([...RACE_EVENTS.map((event) => event.id), ...CAREER_RACE_IDS]);

function newProfile(): ProfileState {
  return { garage: createDefaultGarage(), career: createDefaultCareer() };
}

function startedProfile(): ProfileState {
  const result = startCareer(newProfile());
  if (!result.ok) throw new Error(`test setup: ${result.message}`);
  return result.profile;
}

interface Attempt {
  readonly raceEventId: string;
  readonly attemptId: number;
  readonly outcome: RaceOutcome;
  readonly place?: number | null;
  readonly finishSeconds?: number | null;
  readonly raceCredits?: number;
}

/** Applies one attempt and returns the new profile. Fails the test if the rule refuses it. */
function run(profile: ProfileState, attempt: Attempt, sessionId = 'sess1') {
  const result = applyRaceOutcome(
    profile,
    {
      raceEventId: attempt.raceEventId,
      sessionId,
      attemptId: attempt.attemptId,
      outcome: attempt.outcome,
      place: attempt.place ?? (attempt.outcome === 'finished' ? 1 : null),
      finishSeconds: attempt.finishSeconds ?? (attempt.outcome === 'finished' ? 100 : null),
      raceCredits: attempt.raceCredits ?? 0,
    },
    KNOWN_RACE_IDS,
  );
  if (!result.ok) throw new Error(`test setup: ${result.message}`);
  return { profile: result.profile, summary: result.summary, changed: result.changed };
}

/** The profile after the warm-up is finished. */
function afterWarmup(): ProfileState {
  return run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 3, finishSeconds: 300 }).profile;
}

/** The profile after Mara Quill is beaten (warm-up and the first rival win). */
function afterMara(): ProfileState {
  const warm = afterWarmup();
  return run(warm, { raceEventId: 'rival-mara-race', attemptId: 2, outcome: 'finished', place: 1, raceCredits: 300 }).profile;
}

describe('initialization', () => {
  it('a new profile is not started, and every event is locked with a reason', () => {
    const profile = newProfile();
    expect(profile.career.started).toBe(false);
    const view = buildCareerView(profile);
    expect(view.started).toBe(false);
    expect(view.events.every((event) => event.status === 'locked')).toBe(true);
    expect(view.events[0]?.reasons[0]).toMatch(/Start your career/);
    expect(view.target).toBeNull();
  });

  it('starting the career sets reputation to the configured start and tracks the first event', () => {
    const result = startCareer(newProfile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.career.started).toBe(true);
    expect(result.profile.career.reputation).toBe(CAREER_CONFIG.startingReputation);
    expect(result.profile.career.trackedEventId).toBe('career-warmup');
  });

  it('refuses a second start and keeps every existing progress value', () => {
    const progressed = afterWarmup();
    const again = startCareer(progressed);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('already-started');
    expect(progressed.career.reputation).toBe(10);
    expect(progressed.career.completedEvents).toContain('career-warmup');
  });

  it('tracking an event before the career starts is refused', () => {
    const result = trackEvent(newProfile(), 'career-warmup');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not-started');
  });
});

describe('normalizeCareer', () => {
  it('a clean default career reports no repairs', () => {
    const report = normalizeCareer(createDefaultCareer());
    expect(report.repairs).toEqual([]);
    expect(report.state).toEqual(createDefaultCareer());
  });

  it('a value that is not an object resets to a new career and says so', () => {
    for (const raw of [null, 'x', 5, [], undefined]) {
      const report = normalizeCareer(raw);
      expect(report.state.started).toBe(false);
      expect(report.repairs.length).toBeGreaterThan(0);
    }
  });

  it('clamps reputation into range and never produces a negative value', () => {
    expect(normalizeCareer({ reputation: -5 }).state.reputation).toBe(0);
    expect(normalizeCareer({ reputation: 1e9 }).state.reputation).toBe(CAREER_CONFIG.reputationMax);
    expect(normalizeCareer({ reputation: 12.7 }).state.reputation).toBe(12);
    expect(normalizeCareer({ reputation: Number.NaN }).state.reputation).toBe(0);
    expect(normalizeCareer({ reputation: 'lots' }).repairs.join(' ')).toMatch(/reputation/);
  });

  it('drops unknown and duplicate event ids and reports them', () => {
    const report = normalizeCareer({ completedEvents: ['career-warmup', 'career-warmup', 'not-an-event'] });
    expect(report.state.completedEvents).toEqual(['career-warmup']);
    expect(report.repairs.join(' ')).toMatch(/2 unknown or duplicate/);
  });

  it('drops unknown rivals and milestones, and clears an unknown tracked event', () => {
    const report = normalizeCareer({ started: true, defeatedRivals: ['mara-quill', 'ghost'], completedMilestones: ['nope'], trackedEventId: 'ghost-event' });
    expect(report.state.defeatedRivals).toEqual(['mara-quill']);
    expect(report.state.completedMilestones).toEqual([]);
    expect(report.state.trackedEventId).toBeNull();
    expect(report.repairs.length).toBe(3);
  });

  it('drops malformed reward and attempt keys', () => {
    const report = normalizeCareer({ grantedRewards: ['rank:rank-road-name', 'bad key!', 42], processedAttempts: ['career-warmup-race#sess1.1', 'no-hash'] });
    expect(report.state.grantedRewards).toEqual(['rank:rank-road-name']);
    expect(report.state.processedAttempts).toEqual(['career-warmup-race#sess1.1']);
  });

  it('keeps only the newest processed attempts, up to the configured limit', () => {
    const many = Array.from({ length: CAREER_CONFIG.processedAttemptLimit + 25 }, (_, index) => `career-warmup-race#sess1.${index}`);
    const report = normalizeCareer({ processedAttempts: many });
    expect(report.state.processedAttempts.length).toBe(CAREER_CONFIG.processedAttemptLimit);
    expect(report.state.processedAttempts[report.state.processedAttempts.length - 1]).toBe(`career-warmup-race#sess1.${many.length - 1}`);
  });
});

describe('ranks', () => {
  it.each([
    [0, 'Newcomer'],
    [39, 'Newcomer'],
    [40, 'Street Regular'],
    [119, 'Street Regular'],
    [120, 'Road Name'],
    [239, 'Road Name'],
    [240, 'Night Contender'],
    [379, 'Night Contender'],
    [380, 'City Legend'],
    [CAREER_CONFIG.reputationMax, 'City Legend'],
  ])('reputation %i is rank %s', (reputation, name) => {
    expect(rankFor(reputation).name).toBe(name);
  });

  it('progress toward the next rank is a fraction of the rank span', () => {
    const start = rankProgress(40);
    expect(start.rank.name).toBe('Street Regular');
    expect(start.fraction).toBe(0);
    expect(start.reputationToNext).toBe(80);
    const middle = rankProgress(80);
    expect(middle.fraction).toBeCloseTo(0.5, 6);
  });

  it('the top rank shows full progress and no next rank', () => {
    const top = rankProgress(CAREER_RANKS[CAREER_RANKS.length - 1]?.minReputation ?? 0);
    expect(top.next).toBeNull();
    expect(top.fraction).toBe(1);
    expect(top.reputationToNext).toBeNull();
  });
});

describe('prerequisites and unlocks', () => {
  it('after starting, only the warm-up is unlocked; the first rival is locked with the event it needs', () => {
    const profile = startedProfile();
    expect(eventStatus(eventById('career-warmup'), profile).status).toBe('available');
    const mara = eventStatus(eventById('rival-mara-challenge'), profile);
    expect(mara.status).toBe('locked');
    expect(mara.reasons).toEqual(['Complete Harbour Warm-Up first.']);
  });

  it('a locked rival lists every unmet condition, each as a specific reason', () => {
    const profile = startedProfile();
    const teo = eventStatus(eventById('rival-teo-challenge'), profile);
    expect(teo.status).toBe('locked');
    expect(teo.reasons).toEqual(['Beat Mara Quill first.', 'Needs 40 reputation (you have 0).']);
  });

  it('vehicle ownership is a prerequisite with a reason naming the car', () => {
    const profile = newProfile();
    const reasons = prerequisiteReasons([{ kind: 'vehicle-owned', vehicleId: 'bastion-sedan' }], profile);
    expect(reasons).toEqual([`Own the ${vehicleDefinition('bastion-sedan')?.name ?? 'bastion-sedan'} first.`]);
  });

  it('the rival is unlocked once its prerequisites hold, and is then available', () => {
    const profile = afterMara();
    expect(eventStatus(eventById('rival-teo-challenge'), profile)).toEqual({ status: 'available', reasons: [] });
  });

  it('a free-roam race is never blocked by the career', () => {
    expect(careerRaceBlock('sprint-eastside', newProfile())).toBeNull();
    expect(careerRaceBlock('circuit-block', newProfile())).toBeNull();
  });

  it('a locked career race is blocked and the block gives the reason', () => {
    expect(careerRaceBlock('rival-mara-race', startedProfile())).toBe('Complete Harbour Warm-Up first.');
    expect(careerRaceBlock('rival-mara-race', afterWarmup())).toBeNull();
  });
});

describe('race outcomes: reputation and events', () => {
  it('refuses an unknown race id and grants nothing', () => {
    const profile = startedProfile();
    const result = applyRaceOutcome(profile, { raceEventId: 'made-up-race', sessionId: 'sess1', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 90, raceCredits: 500 }, KNOWN_RACE_IDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unknown-race');
    expect(profile.garage.credits).toBe(createDefaultGarage().credits);
  });

  it('refuses invalid numbers: a finish with no place, and a negative attempt id', () => {
    const profile = startedProfile();
    const noPlace = applyRaceOutcome(profile, { raceEventId: 'career-warmup-race', sessionId: 'sess1', attemptId: 1, outcome: 'finished', place: null, finishSeconds: 90, raceCredits: 0 }, KNOWN_RACE_IDS);
    expect(noPlace.ok).toBe(false);
    const negative = applyRaceOutcome(profile, { raceEventId: 'career-warmup-race', sessionId: 'sess1', attemptId: -1, outcome: 'aborted', place: null, finishSeconds: null, raceCredits: 0 }, KNOWN_RACE_IDS);
    expect(negative.ok).toBe(false);
  });

  it('finishing the warm-up completes it, pays 10 reputation, and pays the first milestone in credits only', () => {
    const before = startedProfile();
    const { profile, summary } = run(before, { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 3, finishSeconds: 300, raceCredits: 150 });
    expect(profile.career.completedEvents).toEqual(['career-warmup']);
    expect(profile.career.reputation).toBe(10);
    expect(summary?.completedEventTitle).toBe('Harbour Warm-Up');
    expect(summary?.reputationGained).toBe(10);
    expect(summary?.milestones).toEqual(['First Result']);
    expect(profile.garage.credits - before.garage.credits).toBe(150 + 100);
    expect(profile.career.completedMilestones).toContain('milestone-first-event');
  });

  it('the warm-up objective pays once when met under 200 seconds', () => {
    const { profile, summary } = run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 2, finishSeconds: 150 });
    expect(summary?.objectiveMet).toBe('Finish under 200 seconds');
    expect(profile.career.reputation).toBe(15);
  });

  it('the warm-up objective is not met over 200 seconds', () => {
    const { profile, summary } = run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 2, finishSeconds: 250 });
    expect(summary?.objectiveMet).toBeNull();
    expect(profile.career.reputation).toBe(10);
  });

  it('an identical attempt key changes nothing the second time', () => {
    const once = run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 7, outcome: 'finished', place: 1, finishSeconds: 150, raceCredits: 150 });
    const again = applyRaceOutcome(once.profile, { raceEventId: 'career-warmup-race', sessionId: 'sess1', attemptId: 7, outcome: 'finished', place: 1, finishSeconds: 150, raceCredits: 150 }, KNOWN_RACE_IDS);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.changed).toBe(false);
    expect(again.summary).toBeNull();
    expect(again.profile).toBe(once.profile);
  });

  it('the same attempt number in a new session is a new attempt, not a duplicate', () => {
    // Attempt numbers restart at 1 after a reload. A saved key from an older session must not block the new attempt.
    const earlier = run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'aborted' }, 'olds1');
    const later = run(earlier.profile, { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 120 }, 'news2');
    expect(later.changed).toBe(true);
    expect(later.profile.career.completedEvents).toEqual(['career-warmup']);
    expect(later.profile.career.processedAttempts.length).toBe(2);
  });

  it('a retry after an abort or timeout grants no reputation and no credits', () => {
    const first = run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'aborted', raceCredits: 0 });
    expect(first.profile.career.reputation).toBe(0);
    expect(first.profile.career.completedEvents).toEqual([]);
    const second = run(first.profile, { raceEventId: 'career-warmup-race', attemptId: 2, outcome: 'timeout', raceCredits: 0 });
    expect(second.profile.career.reputation).toBe(0);
    expect(second.profile.garage.credits).toBe(createDefaultGarage().credits);
  });

  it('a replay of a completed event pays race credits only, no reputation, and no objective again', () => {
    const done = run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 120 }).profile;
    const replayed = run(done, { raceEventId: 'career-warmup-race', attemptId: 2, outcome: 'finished', place: 1, finishSeconds: 110, raceCredits: 150 });
    expect(replayed.summary?.replay).toBe(true);
    expect(replayed.summary?.reputationGained).toBe(0);
    expect(replayed.profile.career.reputation).toBe(15);
    expect(replayed.summary?.creditsGained).toBe(150);
  });

  it('a free-roam race pays its credits and touches no career progress', () => {
    const profile = startedProfile();
    const { profile: next, summary } = run(profile, { raceEventId: 'sprint-eastside', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 100, raceCredits: 300 });
    expect(next.career.processedAttempts).toEqual(['sprint-eastside#sess1.1']);
    expect(next.career.completedEvents).toEqual([]);
    expect(next.career.reputation).toBe(0);
    expect(next.garage.credits - profile.garage.credits).toBe(300);
    expect(summary?.replay).toBe(false);
  });

  it('a career race result never changes progress while the career is not started', () => {
    const { profile } = run(newProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 100 });
    expect(profile.career.started).toBe(false);
    expect(profile.career.reputation).toBe(0);
    expect(profile.career.completedEvents).toEqual([]);
  });

  it('a locked career event grants no progress even if its result arrives', () => {
    const profile = startedProfile();
    const { profile: next } = run(profile, { raceEventId: 'rival-mara-race', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 90, raceCredits: 0 });
    expect(next.career.defeatedRivals).toEqual([]);
    expect(next.career.reputation).toBe(0);
  });
});

describe('rivals', () => {
  it('losing to a rival does not defeat it, grants no defeat reward, and keeps the challenge open', () => {
    const profile = afterWarmup();
    const { profile: next, summary } = run(profile, { raceEventId: 'rival-mara-race', attemptId: 2, outcome: 'finished', place: 2, finishSeconds: 100, raceCredits: 0 });
    expect(next.career.defeatedRivals).toEqual([]);
    expect(next.career.reputation).toBe(profile.career.reputation);
    expect(summary?.rivalDefeated).toBeNull();
    expect(eventStatus(eventById('rival-mara-challenge'), next).status).toBe('available');
  });

  it('a retry after a loss can still win the rival, and that win defeats it once', () => {
    const lost = run(afterWarmup(), { raceEventId: 'rival-mara-race', attemptId: 2, outcome: 'finished', place: 2, finishSeconds: 100 }).profile;
    const won = run(lost, { raceEventId: 'rival-mara-race', attemptId: 3, outcome: 'finished', place: 1, finishSeconds: 95 });
    expect(won.profile.career.defeatedRivals).toEqual(['mara-quill']);
    expect(won.summary?.rivalDefeated).toBe('Mara Quill');
  });

  it('defeating a rival pays its reward once, and identifies the next rival', () => {
    const before = afterWarmup();
    const { profile, summary } = run(before, { raceEventId: 'rival-mara-race', attemptId: 2, outcome: 'finished', place: 1, finishSeconds: 95, raceCredits: 300 });
    expect(profile.career.defeatedRivals).toEqual(['mara-quill']);
    expect(profile.career.reputation).toBe(10 + 40);
    expect(summary?.nextRivalName).toBe('Teo Varga');
    // Race credits 300, defeat reward 400, and the Street Regular rank reward 200, all in one result.
    expect(profile.garage.credits - before.garage.credits).toBe(300 + 400 + 200);
    expect(summary?.rankUps).toEqual(['Street Regular']);
  });

  it('a replayed win over a defeated rival pays no defeat reward again', () => {
    const won = afterMara();
    const again = run(won, { raceEventId: 'rival-mara-race', attemptId: 9, outcome: 'finished', place: 1, finishSeconds: 90, raceCredits: 300 });
    expect(again.summary?.replay).toBe(true);
    expect(again.summary?.rivalDefeated).toBeNull();
    expect(again.profile.career.reputation).toBe(won.career.reputation);
    expect(again.profile.career.defeatedRivals).toEqual(['mara-quill']);
    expect(again.summary?.creditsGained).toBe(300);
  });

  it('the rank reward for Street Regular is paid once, at the first crossing', () => {
    const before = afterWarmup();
    const crossing = run(before, { raceEventId: 'rival-mara-race', attemptId: 2, outcome: 'finished', place: 1, finishSeconds: 95 });
    expect(crossing.summary?.rankUps).toEqual(['Street Regular']);
    expect(crossing.profile.career.grantedRewards).toContain('rank:rank-street-regular');
    const again = run(crossing.profile, { raceEventId: 'career-warmup-race', attemptId: 3, outcome: 'finished', place: 1, finishSeconds: 120 });
    expect(again.summary?.rankUps).toEqual([]);
  });

  it('the next rival target is the nearest undefeated rival on the ladder', () => {
    expect(nextRivalTarget(newProfile())?.id).toBe('mara-quill');
    expect(nextRivalTarget(afterMara())?.id).toBe('teo-varga');
  });

  it('the leaderboard puts standing rivals above the player and beaten rivals below', () => {
    const board = leaderboard(afterMara());
    const names = board.rows.map((row) => row.name);
    expect(names).toEqual(['Ren Adair', 'Kai Mensah', 'Juno Ashdown', 'Teo Varga', 'You', 'Mara Quill']);
    expect(board.playerPosition).toBe(5);
    expect(board.rows.find((row) => row.name === 'Teo Varga')?.isTarget).toBe(true);
    expect(board.rows.find((row) => row.name === 'Mara Quill')?.state).toBe('beaten');
  });

  it('the starting leaderboard lists every rival standing above the player, with Mara as the target', () => {
    const board = leaderboard(newProfile());
    expect(board.playerPosition).toBe(RIVALS.length + 1);
    expect(board.rows.find((row) => row.name === 'Mara Quill')?.isTarget).toBe(true);
  });

  it('the ladder chain defeats every ladder rival in order, leaves Ren Adair as the last target, and reaches City Legend', () => {
    let profile = afterMara();
    profile = run(profile, { raceEventId: 'rival-teo-race', attemptId: 3, outcome: 'finished', place: 1, finishSeconds: 200 }).profile;
    expect(eventStatus(eventById('rival-juno-challenge'), profile).status).toBe('available');
    profile = run(profile, { raceEventId: 'rival-juno-race', attemptId: 4, outcome: 'finished', place: 1, finishSeconds: 200 }).profile;
    expect(eventStatus(eventById('rival-kai-challenge'), profile).status).toBe('available');
    const last = run(profile, { raceEventId: 'rival-kai-race', attemptId: 5, outcome: 'finished', place: 1, finishSeconds: 300 });
    // Ren Adair closes Division 2, so the ladder ends with Ren Adair still standing.
    expect(last.profile.career.defeatedRivals.length).toBe(RIVALS.length - 1);
    expect(last.summary?.nextRivalName).toBe('Ren Adair');
    expect(nextRivalTarget(last.profile)?.id).toBe('ren-adair');
    expect(rankFor(last.profile.career.reputation).name).toBe('City Legend');
  });

  it('the chain reputation adds up exactly to each prerequisite, with no gap', () => {
    // 10 (warm-up) + 40 (Mara) = 50; + 70 (Teo) = 120; + 120 (Juno) = 240; the Kai prerequisite is 240. The chain is tight.
    let profile = afterMara();
    expect(profile.career.reputation).toBe(50);
    profile = run(profile, { raceEventId: 'rival-teo-race', attemptId: 3, outcome: 'finished', place: 1, finishSeconds: 200 }).profile;
    expect(profile.career.reputation).toBe(120);
    profile = run(profile, { raceEventId: 'rival-juno-race', attemptId: 4, outcome: 'finished', place: 1, finishSeconds: 200 }).profile;
    expect(profile.career.reputation).toBe(240);
  });
});

describe('milestones', () => {
  it('a milestone pays credits once and never reputation', () => {
    const profile = afterWarmup();
    const settled = settleCareer(profile);
    expect(settled.awards.milestones).toEqual([]);
    const view = milestoneViews(profile).find((entry) => entry.milestone.id === 'milestone-first-event');
    expect(view?.done).toBe(true);
  });

  it('the first-event milestone shows as done once a career event is completed', () => {
    const view = milestoneViews(afterWarmup()).find((entry) => entry.milestone.id === 'milestone-first-event');
    expect(view?.current).toBe(1);
    expect(view?.target).toBe(1);
  });

  it('the two-rivals milestone pays once, on the second defeat', () => {
    const profile = afterMara();
    const teo = run(profile, { raceEventId: 'rival-teo-race', attemptId: 3, outcome: 'finished', place: 1, finishSeconds: 200 });
    // Three completed events is the third milestone, so it pays on the same result as the second defeat.
    expect(teo.summary?.milestones).toEqual(['Three In', 'Two Scalps']);
    const again = settleCareer(teo.profile);
    expect(again.awards.milestones).toEqual([]);
  });

  it('settling twice pays each reward once', () => {
    const profile = afterMara();
    const first = settleCareer(profile);
    const second = settleCareer(first.profile);
    expect(second.awards.credits).toBe(0);
    expect(second.profile.garage.credits).toBe(first.profile.garage.credits);
  });
});

describe('garage and the economy', () => {
  it('a full chain never adds or buys a vehicle', () => {
    let profile = afterMara();
    profile = run(profile, { raceEventId: 'rival-teo-race', attemptId: 3, outcome: 'finished', place: 1, finishSeconds: 200 }).profile;
    const owned = ownedVehicleIds(createDefaultGarage());
    expect(ownedVehicleIds(profile.garage)).toEqual(owned);
  });

  it('career credits land in the one garage balance', () => {
    const before = startedProfile();
    const { profile } = run(before, { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 120, raceCredits: 150 });
    expect(profile.garage.credits).toBeGreaterThan(before.garage.credits);
    expect(Object.keys(profile.garage.vehicles)).toEqual(Object.keys(before.garage.vehicles));
  });

});

describe('view and tracking', () => {
  it('the hub view shows the rank, the next target, and the event status after the warm-up', () => {
    const view = buildCareerView(afterWarmup());
    expect(view.rank.name).toBe('Newcomer');
    expect(view.reputation).toBe(10);
    expect(view.nextRankName).toBe('Street Regular');
    expect(view.reputationToNext).toBe(30);
    expect(view.completedEventCount).toBe(1);
    // Warm-up completed, Mara Quill open, and the three Division 1 events (block laps, checkpoint, clock) opened by the warm-up.
    expect(view.unlockedEventCount).toBe(5);
    expect(view.target?.title).toBe('Mara Quill: Dock Run');
    expect(view.target?.explicit).toBe(false);
    expect(view.events.find((event) => event.id === 'career-warmup')?.status).toBe('completed');
  });

  it('a locked event cannot be tracked, and the reason is returned', () => {
    const result = trackEvent(startedProfile(), 'rival-teo-challenge');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('event-locked');
    expect(result.message).toMatch(/Beat Mara Quill first/);
  });

  it('an available event can be tracked, and clearing the target sets it to null', () => {
    const tracked = trackEvent(startedProfile(), 'career-warmup');
    expect(tracked.ok).toBe(true);
    const cleared = trackEvent(startedProfile(), null);
    expect(cleared.ok && cleared.profile.career.trackedEventId).toBeNull();
  });

  it('completing the tracked event clears the target', () => {
    const { profile } = run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 120 });
    expect(profile.career.trackedEventId).toBeNull();
  });

  it('a completed event can be tracked again as a replay', () => {
    const { profile } = run(startedProfile(), { raceEventId: 'career-warmup-race', attemptId: 1, outcome: 'finished', place: 1, finishSeconds: 120 });
    const result = trackEvent(profile, 'career-warmup');
    expect(result.ok).toBe(true);
  });
});


describe('career ranks: the boundaries from the configured table', () => {
  it('each rank starts exactly at its threshold, and one reputation below it is the rank before', () => {
    CAREER_RANKS.forEach((rank, index) => {
      expect(rankFor(rank.minReputation).id, `at ${rank.minReputation}`).toBe(rank.id);
      if (index > 0) {
        const below = CAREER_RANKS[index - 1];
        expect(rankFor(rank.minReputation - 1).id, `one below ${rank.minReputation}`).toBe(below?.id);
      }
    });
  });

  it('the first rank covers zero, and a huge reputation stays at the top rank', () => {
    expect(rankFor(0).id).toBe(CAREER_RANKS[0]?.id);
    expect(rankFor(Number.MAX_SAFE_INTEGER).id).toBe(CAREER_RANKS[CAREER_RANKS.length - 1]?.id);
  });
});
