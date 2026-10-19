/*
 * Career model (Part 9). Pure: no storage, no React, no Three.js. It holds the career state shape, its normalizer, the
 * rank and unlock rules, the leaderboard, the milestones, and the one rule that applies a race outcome to the profile.
 *
 * Everything is derived from the canonical progress (completed events, defeated rivals, reputation, owned vehicles)
 * rather than stored: rank, unlock status, the leaderboard, and the rival target. Only facts that cannot be derived are
 * saved: which events are completed, which rivals are defeated, which milestones and one-time rewards are granted, which
 * race attempts were processed, and the tracked event.
 */
import { CAREER_CONFIG } from '../config/careerConfig';
import { earnCredits, ownedVehicleIds, type GarageState } from '../garage/garageModel';
import { vehicleDefinition } from '../vehicles/catalogue';
import {
  CAREER_EVENT_IDS,
  CAREER_EVENTS,
  CAREER_RANKS,
  CHAMPIONSHIPS,
  DIVISIONS,
  INTRODUCTION_TEXT,
  MILESTONES,
  MILESTONE_IDS,
  RIVALS,
  RIVAL_IDS,
  careerEventById,
  careerEventForRace,
  championshipForEvent,
  divisionForEvent,
  rivalById,
} from './careerCatalogue';
import { CAREER_RACE_EVENTS } from './careerRaces';
import type {
  CareerEventDefinition,
  ChampionshipDefinition,
  DivisionDefinition,
  DivisionStatus,
  MilestoneDefinition,
  Prerequisite,
  RankDefinition,
  RivalDefinition,
} from './careerTypes';

/** Version of the career data inside the save. Bump it, and add a migration branch, if the shape changes. */
export const CAREER_DATA_VERSION = 2;

export interface CareerState {
  readonly version: typeof CAREER_DATA_VERSION;
  /** False until the player starts a career. Nothing in the career progresses before that. */
  readonly started: boolean;
  readonly reputation: number;
  /** Career event ids completed at least once. Each is listed once. */
  readonly completedEvents: readonly string[];
  /** Rival ids defeated at least once. Each is listed once. */
  readonly defeatedRivals: readonly string[];
  /** Milestone ids completed. A milestone pays its reward on the first completion only. */
  readonly completedMilestones: readonly string[];
  /** One-time reward keys already paid: `rank:<id>` and `objective:<eventId>:<objectiveId>`. */
  readonly grantedRewards: readonly string[];
  /**
   * Race attempt keys (`<raceEventId>#<sessionId>.<attemptId>`) already processed. The session id is unique per page
   * load, so attempt numbers restarting after a reload can never match an older attempt. Bounded by
   * CAREER_CONFIG.processedAttemptLimit.
   */
  readonly processedAttempts: readonly string[];
  /** The event the player chose in the hub, or null. */
  readonly trackedEventId: string | null;
  /** Best finish time per career event, in seconds. Only finished attempts count. Lower is better. */
  readonly bestTimes: Readonly<Record<string, number>>;
  /**
   * Championship scores, keyed `<championshipId>:<eventId>`. A key present means the event has a finish recorded in
   * that cup. The value is the best points for that event (zero when the finish was past the scoring places).
   */
  readonly cupScores: Readonly<Record<string, number>>;
  /** Pursuits the player escaped (the police gave up) since the career started. */
  readonly pursuitEscapes: number;
}

/** Garage and career together: the unit that one save write commits. */
export interface ProfileState {
  readonly garage: GarageState;
  readonly career: CareerState;
}

export function createDefaultCareer(): CareerState {
  return {
    version: CAREER_DATA_VERSION,
    started: false,
    reputation: CAREER_CONFIG.startingReputation,
    completedEvents: [],
    defeatedRivals: [],
    completedMilestones: [],
    grantedRewards: [],
    processedAttempts: [],
    trackedEventId: null,
    bestTimes: {},
    cupScores: {},
    pursuitEscapes: 0,
  };
}

/** The key that stores one event's championship score. */
export function cupScoreKey(championshipId: string, eventId: string): string {
  return `${championshipId}:${eventId}`;
}

/** Every valid cup score key, built from the catalogue: an event is only scored inside its own cup. */
const CUP_SCORE_KEYS: ReadonlySet<string> = new Set(
  CHAMPIONSHIPS.flatMap((cup) => cup.eventIds.map((eventId) => cupScoreKey(cup.id, eventId))),
);

/** Points for a place, from 1 upward. Places past the scoring list score zero. */
export function pointsForPlace(place: number): number {
  if (!Number.isInteger(place) || place < 1) return 0;
  return CAREER_CONFIG.championshipPointsByPlace[place - 1] ?? 0;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Normalization                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface CareerNormalizeReport {
  readonly state: CareerState;
  /** One line per repair. Empty for a clean load. */
  readonly repairs: readonly string[];
}

const REWARD_KEY_PATTERN = /^(rank|objective|rival|division|championship):[a-z0-9:-]{1,80}$/;
const ATTEMPT_KEY_PATTERN = /^[a-z0-9-]{1,80}#[a-z0-9]{1,24}\.\d{1,9}$/;

/** Keeps unique strings that pass `accept`. Reports how many were dropped, so the player sees a repair line. */
function uniqueStrings(raw: unknown, accept: (value: string) => boolean): { values: string[]; dropped: number; malformed: boolean } {
  if (!Array.isArray(raw)) return { values: [], dropped: 0, malformed: raw !== undefined };
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of raw) {
    if (typeof item !== 'string' || !accept(item) || seen.has(item)) {
      dropped += 1;
      continue;
    }
    seen.add(item);
  }
  return { values: [...seen], dropped, malformed: false };
}

/**
 * Turns any loaded career value into a valid state. Never throws. Bad values fall back to safe defaults, and each fix
 * is reported. A value that is not an object at all is reported too, and the caller decides how to back it up.
 */
export function normalizeCareer(raw: unknown): CareerNormalizeReport {
  const repairs: string[] = [];
  const base = createDefaultCareer();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { state: base, repairs: ['career data was not an object: reset to a new career'] };
  }
  const record = raw as Record<string, unknown>;

  let started = false;
  if (typeof record.started === 'boolean') started = record.started;
  else if (record.started !== undefined) repairs.push('career start flag was invalid: treated as not started');

  let reputation = base.reputation;
  if (typeof record.reputation === 'number' && Number.isFinite(record.reputation)) {
    reputation = Math.min(CAREER_CONFIG.reputationMax, Math.max(0, Math.floor(record.reputation)));
    if (reputation !== record.reputation) repairs.push('reputation was out of range: clamped');
  } else if (record.reputation !== undefined) {
    repairs.push('reputation was not a number: reset to the starting value');
  }

  const events = uniqueStrings(record.completedEvents, (id) => CAREER_EVENT_IDS.has(id));
  if (events.malformed) repairs.push('completed events were not a list: cleared');
  else if (events.dropped > 0) repairs.push(`${events.dropped} unknown or duplicate completed event(s) dropped`);

  const rivals = uniqueStrings(record.defeatedRivals, (id) => RIVAL_IDS.has(id));
  if (rivals.malformed) repairs.push('defeated rivals were not a list: cleared');
  else if (rivals.dropped > 0) repairs.push(`${rivals.dropped} unknown or duplicate rival(s) dropped`);

  const milestones = uniqueStrings(record.completedMilestones, (id) => MILESTONE_IDS.has(id));
  if (milestones.malformed) repairs.push('completed milestones were not a list: cleared');
  else if (milestones.dropped > 0) repairs.push(`${milestones.dropped} unknown or duplicate milestone(s) dropped`);

  const rewards = uniqueStrings(record.grantedRewards, (key) => REWARD_KEY_PATTERN.test(key));
  if (rewards.malformed) repairs.push('granted rewards were not a list: cleared');
  else if (rewards.dropped > 0) repairs.push(`${rewards.dropped} malformed reward key(s) dropped`);

  const attempts = uniqueStrings(record.processedAttempts, (key) => ATTEMPT_KEY_PATTERN.test(key));
  if (attempts.malformed) repairs.push('processed attempts were not a list: cleared');
  else if (attempts.dropped > 0) repairs.push(`${attempts.dropped} malformed attempt key(s) dropped`);
  const processed = attempts.values.slice(-CAREER_CONFIG.processedAttemptLimit);

  let trackedEventId: string | null = null;
  if (record.trackedEventId === null || record.trackedEventId === undefined) trackedEventId = null;
  else if (typeof record.trackedEventId === 'string' && CAREER_EVENT_IDS.has(record.trackedEventId)) trackedEventId = record.trackedEventId;
  else repairs.push('tracked event was unknown: cleared');

  // Version 2 fields. A version 1 save has none of them; a missing field takes its default and is not a repair.
  const bestTimes = normalizeBestTimes(record.bestTimes, repairs);
  const cupScores = normalizeCupScores(record.cupScores, repairs);
  let pursuitEscapes = 0;
  if (typeof record.pursuitEscapes === 'number' && Number.isInteger(record.pursuitEscapes) && record.pursuitEscapes >= 0) {
    pursuitEscapes = Math.min(CAREER_CONFIG.escapeCountMax, record.pursuitEscapes);
  } else if (record.pursuitEscapes !== undefined) {
    repairs.push('pursuit escape count was invalid: reset to zero');
  }

  return {
    state: {
      version: CAREER_DATA_VERSION,
      started,
      reputation,
      completedEvents: events.values,
      defeatedRivals: rivals.values,
      completedMilestones: milestones.values,
      grantedRewards: rewards.values,
      processedAttempts: processed,
      trackedEventId,
      bestTimes,
      cupScores,
      pursuitEscapes,
    },
    repairs,
  };
}

/** Best times: known event ids with a finite, positive, bounded number of seconds. Others are dropped and reported. */
function normalizeBestTimes(raw: unknown, repairs: string[]): Record<string, number> {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    repairs.push('best times were not an object: cleared');
    return {};
  }
  const out: Record<string, number> = {};
  let dropped = 0;
  for (const [id, value] of Object.entries(raw)) {
    if (!CAREER_EVENT_IDS.has(id) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > CAREER_CONFIG.bestTimeMaxSeconds) {
      dropped += 1;
      continue;
    }
    out[id] = roundSeconds(value);
  }
  if (dropped > 0) repairs.push(`${dropped} invalid best time(s) dropped`);
  return out;
}

/** Cup scores: only keys that name a cup and one of its events, with whole points inside the scoring table. */
function normalizeCupScores(raw: unknown, repairs: string[]): Record<string, number> {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    repairs.push('championship scores were not an object: cleared');
    return {};
  }
  const maxPoints = CAREER_CONFIG.championshipPointsByPlace[0] ?? 0;
  const out: Record<string, number> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!CUP_SCORE_KEYS.has(key) || typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maxPoints) {
      dropped += 1;
      continue;
    }
    out[key] = value;
  }
  if (dropped > 0) repairs.push(`${dropped} invalid championship score(s) dropped`);
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Ranks                                                                                                               */
/* ------------------------------------------------------------------------------------------------------------------ */

/** The highest rank the reputation reaches. CAREER_RANKS starts at 0, so there is always one. */
export function rankFor(reputation: number): RankDefinition {
  let current = CAREER_RANKS[0];
  for (const rank of CAREER_RANKS) if (reputation >= rank.minReputation) current = rank;
  if (!current) throw new Error('career: no rank table');
  return current;
}

export interface RankProgress {
  readonly rank: RankDefinition;
  /** The next rank, or null at the top. */
  readonly next: RankDefinition | null;
  /** Fraction of the way from this rank to the next, 0..1. 1 at the top rank. */
  readonly fraction: number;
  /** Reputation still needed for the next rank, or null at the top. */
  readonly reputationToNext: number | null;
}

export function rankProgress(reputation: number): RankProgress {
  const rank = rankFor(reputation);
  const index = CAREER_RANKS.findIndex((candidate) => candidate.id === rank.id);
  const next = CAREER_RANKS[index + 1] ?? null;
  if (!next) return { rank, next: null, fraction: 1, reputationToNext: null };
  const span = next.minReputation - rank.minReputation;
  const into = reputation - rank.minReputation;
  return {
    rank,
    next,
    fraction: span > 0 ? Math.min(1, Math.max(0, into / span)) : 1,
    reputationToNext: Math.max(0, next.minReputation - reputation),
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Prerequisites and unlocks                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------ */

function vehicleName(vehicleId: string): string {
  return vehicleDefinition(vehicleId)?.name ?? vehicleId;
}

/** One reason per prerequisite that does not hold yet. An empty list means every condition is met. */
export function prerequisiteReasons(prerequisites: readonly Prerequisite[], profile: ProfileState): string[] {
  const reasons: string[] = [];
  const career = profile.career;
  for (const prerequisite of prerequisites) {
    switch (prerequisite.kind) {
      case 'reputation':
        if (career.reputation < prerequisite.min) {
          reasons.push(`Needs ${prerequisite.min} reputation (you have ${career.reputation}).`);
        }
        break;
      case 'event-completed':
        if (!career.completedEvents.includes(prerequisite.eventId)) {
          reasons.push(`Complete ${careerEventById(prerequisite.eventId)?.title ?? prerequisite.eventId} first.`);
        }
        break;
      case 'rival-defeated':
        if (!career.defeatedRivals.includes(prerequisite.rivalId)) {
          reasons.push(`Beat ${rivalById(prerequisite.rivalId)?.name ?? prerequisite.rivalId} first.`);
        }
        break;
      case 'vehicle-owned':
        if (!ownedVehicleIds(profile.garage).includes(prerequisite.vehicleId)) {
          reasons.push(`Own the ${vehicleName(prerequisite.vehicleId)} first.`);
        }
        break;
      default: {
        const unhandled: never = prerequisite;
        reasons.push(`Unknown condition ${JSON.stringify(unhandled)}.`);
      }
    }
  }
  return reasons;
}

export type EventStatus = 'locked' | 'available' | 'completed';

export interface EventView {
  readonly status: EventStatus;
  /** Why the event is locked. Empty when available or completed. */
  readonly reasons: readonly string[];
}

/** An event's status. Nothing is unlocked before the career starts. Completed events stay completed. */
export function eventStatus(event: CareerEventDefinition, profile: ProfileState): EventView {
  if (!profile.career.started) return { status: 'locked', reasons: ['Start your career in the career hub first.'] };
  if (profile.career.completedEvents.includes(event.id)) return { status: 'completed', reasons: [] };
  const reasons = prerequisiteReasons(event.prerequisites, profile);
  return { status: reasons.length === 0 ? 'available' : 'locked', reasons };
}

/**
 * Whether a race is on the map and in the world. Free-roam races are not career events, so they are always shown.
 * A career race is shown once it is unlocked (available or completed). It is hidden again once its division is
 * complete, if the division retires its races (Division 1). A locked race is never shown.
 */
export function careerRaceVisible(raceEventId: string, profile: ProfileState): boolean {
  const event = careerEventForRace(raceEventId);
  if (!event) return true;
  const division = divisionForEvent(event.id);
  if (division?.retireRacesOnComplete && divisionComplete(division, profile.career)) return false;
  return eventStatus(event, profile).status !== 'locked';
}

/**
 * The entry rule for a career race. Returns the reason an attempt cannot start, or null. Free-roam races are not career
 * events, so they always return null here. A career race that is not shown (locked or retired) is refused.
 */
export function careerRaceBlock(raceEventId: string, profile: ProfileState): string | null {
  const event = careerEventForRace(raceEventId);
  if (!event) return null;
  if (!careerRaceVisible(raceEventId, profile)) {
    const division = divisionForEvent(event.id);
    if (division?.retireRacesOnComplete && divisionComplete(division, profile.career)) return 'This division is complete, so its races have been retired.';
    const view = eventStatus(event, profile);
    return view.reasons.join(' ') || 'This race is not unlocked yet.';
  }
  const view = eventStatus(event, profile);
  return view.status === 'locked' ? view.reasons.join(' ') : null;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Rivals and the leaderboard                                                                                          */
/* ------------------------------------------------------------------------------------------------------------------ */

export type RivalState = 'beaten' | 'available' | 'locked';

export interface RivalView {
  readonly rival: RivalDefinition;
  readonly state: RivalState;
  readonly reasons: readonly string[];
  /** The challenge event used for the challenge, the first one listed. */
  readonly challenge: CareerEventDefinition | null;
}

export function rivalView(rival: RivalDefinition, profile: ProfileState): RivalView {
  const challenge = careerEventById(rival.challengeEventIds[0] ?? '') ?? null;
  if (profile.career.defeatedRivals.includes(rival.id)) return { rival, state: 'beaten', reasons: [], challenge };
  if (!challenge) return { rival, state: 'locked', reasons: ['No challenge is set up for this rival.'], challenge };
  const view = eventStatus(challenge, profile);
  return { rival, state: view.status === 'locked' ? 'locked' : 'available', reasons: [...view.reasons], challenge };
}

/**
 * The rival the player is working toward: the undefeated rival nearest to the player on the ladder (the highest ladder
 * position still standing). Null once every rival is beaten.
 */
export function nextRivalTarget(profile: ProfileState): RivalDefinition | null {
  let target: RivalDefinition | null = null;
  for (const rival of RIVALS) {
    if (profile.career.defeatedRivals.includes(rival.id)) continue;
    if (target === null || rival.ladderPosition > target.ladderPosition) target = rival;
  }
  return target;
}

export interface LeaderboardRow {
  readonly kind: 'rival' | 'player';
  /** 1 is the top. Rivals still standing rank above the player; beaten rivals rank below. */
  readonly position: number;
  readonly id: string;
  readonly name: string;
  readonly state: RivalState | 'player';
  readonly reasons: readonly string[];
  readonly isTarget: boolean;
  readonly vehicleName: string | null;
  readonly challengeEventId: string | null;
}

/**
 * The leaderboard, derived from the defeated rivals. Undefeated rivals are listed in ladder order above the player.
 * The player's place is one more than the number of rivals still standing. Beaten rivals sit below the player, in
 * ladder order. Nothing about the order is stored.
 */
export function leaderboard(profile: ProfileState): { rows: LeaderboardRow[]; playerPosition: number; totalRacers: number } {
  const standing = RIVALS.filter((rival) => !profile.career.defeatedRivals.includes(rival.id)).sort((a, b) => a.ladderPosition - b.ladderPosition);
  const beaten = RIVALS.filter((rival) => profile.career.defeatedRivals.includes(rival.id)).sort((a, b) => a.ladderPosition - b.ladderPosition);
  const target = nextRivalTarget(profile);
  const rowFor = (rival: RivalDefinition, position: number): LeaderboardRow => {
    const view = rivalView(rival, profile);
    return {
      kind: 'rival',
      position,
      id: rival.id,
      name: rival.name,
      state: view.state,
      reasons: view.reasons,
      isTarget: target !== null && target.id === rival.id && view.state !== 'beaten',
      vehicleName: vehicleName(rival.vehicleId),
      challengeEventId: view.challenge ? view.challenge.id : null,
    };
  };
  const rows: LeaderboardRow[] = standing.map((rival, index) => rowFor(rival, index + 1));
  const playerPosition = standing.length + 1;
  rows.push({
    kind: 'player',
    position: playerPosition,
    id: 'player',
    name: 'You',
    state: 'player',
    reasons: [],
    isTarget: false,
    vehicleName: null,
    challengeEventId: null,
  });
  beaten.forEach((rival, index) => rows.push(rowFor(rival, playerPosition + 1 + index)));
  return { rows, playerPosition, totalRacers: RIVALS.length + 1 };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Milestones                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface MilestoneView {
  readonly milestone: MilestoneDefinition;
  readonly done: boolean;
  readonly current: number;
  readonly target: number;
}

function milestoneCurrent(milestone: MilestoneDefinition, profile: ProfileState): number {
  const req = milestone.requirement;
  switch (req.kind) {
    case 'career-events-completed':
      return profile.career.completedEvents.length;
    case 'rivals-defeated':
      return profile.career.defeatedRivals.length;
    case 'reputation':
      return profile.career.reputation;
    case 'vehicles-owned':
      return ownedVehicleIds(profile.garage).length;
    case 'pursuit-escapes':
      return profile.career.pursuitEscapes;
    default: {
      const unhandled: never = req;
      throw new Error(`career: unhandled milestone requirement ${JSON.stringify(unhandled)}`);
    }
  }
}

function milestoneTarget(milestone: MilestoneDefinition): number {
  const req = milestone.requirement;
  return req.kind === 'reputation' ? req.min : req.count;
}

export function milestoneViews(profile: ProfileState): MilestoneView[] {
  return MILESTONES.map((milestone) => ({
    milestone,
    done: profile.career.completedMilestones.includes(milestone.id),
    current: milestoneCurrent(milestone, profile),
    target: milestoneTarget(milestone),
  }));
}

/**
 * Adds career credits to the garage balance through the one garage rule (earnCredits). Zero is a no-op. A non-positive
 * or non-integer amount means the catalogue is wrong, which validateCareerCatalogue tests catch, so it throws here.
 */
function addCareerCredits(garage: GarageState, amount: number, source: string): GarageState {
  if (amount === 0) return garage;
  const paid = earnCredits(garage, amount, source);
  if (!paid.ok) throw new Error(`career: reward from ${source} is invalid: ${paid.message}`);
  return paid.state;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Settling: rank rewards and milestones                                                                               */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface SettleAwards {
  /** Ranks reached for the first time by this settle, in ascending order. */
  readonly rankUps: readonly RankDefinition[];
  /** Milestones completed by this settle. */
  readonly milestones: readonly MilestoneDefinition[];
  /** Championships completed by this settle (their reward is paid once). */
  readonly championships: readonly ChampionshipDefinition[];
  /** Divisions completed by this settle (their reward is paid once). */
  readonly divisions: readonly DivisionDefinition[];
  /** Credits paid by these awards together. */
  readonly credits: number;
  /** Reputation paid by these awards together (championship and division rewards). */
  readonly reputation: number;
}

const NO_AWARDS: SettleAwards = { rankUps: [], milestones: [], championships: [], divisions: [], credits: 0, reputation: 0 };

/** True when every event in the championship has a finish recorded. */
export function championshipComplete(cup: ChampionshipDefinition, career: CareerState): boolean {
  return cup.eventIds.every((eventId) => career.cupScores[cupScoreKey(cup.id, eventId)] !== undefined);
}

/** True when every event, the championship, and the champion rival of a division are done. */
export function divisionComplete(division: DivisionDefinition, career: CareerState): boolean {
  if (division.status !== 'open') return false;
  const events = division.eventIds.every((eventId) => career.completedEvents.includes(eventId));
  const cups = division.championshipIds.every((cupId) => {
    const cup = CHAMPIONSHIPS.find((candidate) => candidate.id === cupId);
    return cup !== undefined && championshipComplete(cup, career);
  });
  const champion = division.championRivalId === null || career.defeatedRivals.includes(division.championRivalId);
  return events && cups && champion;
}

/**
 * Pays the rewards that are due and not yet granted: championships, divisions, ranks, then milestones. Runs after every
 * career or garage change inside the same commit, so the rewards land in the same save write as the change that earned
 * them. Each reward key is recorded before it is paid, so running settle twice pays nothing the second time. Does
 * nothing before the career starts. Championship and division rewards add reputation before the ranks are checked, so a
 * rank reached through them is paid in the same settle.
 */
export function settleCareer(profile: ProfileState): { profile: ProfileState; awards: SettleAwards } {
  if (!profile.career.started) return { profile, awards: NO_AWARDS };
  let career = profile.career;
  let garage = profile.garage;
  const rankUps: RankDefinition[] = [];
  const milestones: MilestoneDefinition[] = [];
  const championships: ChampionshipDefinition[] = [];
  const divisions: DivisionDefinition[] = [];
  let credits = 0;
  let reputation = 0;

  const payReputation = (amount: number) => {
    if (amount === 0) return;
    reputation += amount;
    career = { ...career, reputation: Math.min(CAREER_CONFIG.reputationMax, career.reputation + amount) };
  };

  for (const cup of CHAMPIONSHIPS) {
    const key = `championship:${cup.id}:complete`;
    if (career.grantedRewards.includes(key) || !championshipComplete(cup, career)) continue;
    career = { ...career, grantedRewards: [...career.grantedRewards, key] };
    championships.push(cup);
    credits += cup.reward.credits;
    payReputation(cup.reward.reputation);
  }

  for (const division of DIVISIONS) {
    const key = `division:${division.id}:complete`;
    if (career.grantedRewards.includes(key) || !divisionComplete(division, career)) continue;
    career = { ...career, grantedRewards: [...career.grantedRewards, key] };
    divisions.push(division);
    credits += division.completionReward.credits;
    payReputation(division.completionReward.reputation);
  }

  for (const rank of CAREER_RANKS) {
    if (rank.minReputation <= 0) continue;
    if (career.reputation < rank.minReputation) continue;
    const key = `rank:${rank.id}`;
    if (career.grantedRewards.includes(key)) continue;
    career = { ...career, grantedRewards: [...career.grantedRewards, key] };
    rankUps.push(rank);
    credits += rank.creditReward;
  }

  // Milestones are checked against the career after the rewards above. They pay credits only, so nothing cascades.
  const withRewards: ProfileState = { garage, career };
  for (const view of milestoneViews(withRewards)) {
    if (view.done || view.current < view.target) continue;
    career = { ...career, completedMilestones: [...career.completedMilestones, view.milestone.id] };
    milestones.push(view.milestone);
    credits += view.milestone.creditReward;
  }

  garage = addCareerCredits(garage, credits, 'career awards');
  return { profile: { garage, career }, awards: { rankUps, milestones, championships, divisions, credits, reputation } };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Starting and tracking                                                                                               */
/* ------------------------------------------------------------------------------------------------------------------ */

export type CareerTxFailure = 'already-started' | 'not-started' | 'unknown-event' | 'event-locked' | 'unknown-race' | 'invalid-input';

export type CareerTx<T> = { readonly ok: true; readonly profile: ProfileState; readonly message: string; readonly detail: T } | { readonly ok: false; readonly code: CareerTxFailure; readonly message: string };

/**
 * Starts a career. Refused when one already exists, so reopening the hub or starting twice never resets progress. The
 * first unlocked event becomes the tracked target.
 */
export function startCareer(profile: ProfileState): CareerTx<null> {
  if (profile.career.started) {
    return { ok: false, code: 'already-started', message: 'Your career has already started. Your progress is kept.' };
  }
  const started: ProfileState = {
    garage: profile.garage,
    career: { ...profile.career, started: true, reputation: CAREER_CONFIG.startingReputation, trackedEventId: null },
  };
  const first = CAREER_EVENTS.find((event) => eventStatus(event, started).status === 'available') ?? null;
  const career = { ...started.career, trackedEventId: first ? first.id : null };
  return { ok: true, profile: { garage: profile.garage, career }, message: 'Career started. Your first event is ready.', detail: null };
}

/** Chooses the event the player is heading for. Null clears it. Only available or completed events can be chosen. */
export function trackEvent(profile: ProfileState, eventId: string | null): CareerTx<null> {
  if (!profile.career.started) return { ok: false, code: 'not-started', message: 'Start your career first.' };
  if (eventId === null) {
    return { ok: true, profile: { garage: profile.garage, career: { ...profile.career, trackedEventId: null } }, message: 'Target cleared.', detail: null };
  }
  const event = careerEventById(eventId);
  if (!event) return { ok: false, code: 'unknown-event', message: 'That event does not exist.' };
  const view = eventStatus(event, profile);
  if (view.status === 'locked') return { ok: false, code: 'event-locked', message: view.reasons.join(' ') };
  return {
    ok: true,
    profile: { garage: profile.garage, career: { ...profile.career, trackedEventId: event.id } },
    message: `Target set: ${event.title}.`,
    detail: null,
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Race outcomes: the one rule                                                                                         */
/* ------------------------------------------------------------------------------------------------------------------ */

export type RaceOutcome = 'finished' | 'aborted' | 'timeout';

export interface RaceOutcomeInput {
  readonly raceEventId: string;
  /** Unique per page load (see newSessionId). Together with attemptId it identifies the attempt across reloads. */
  readonly sessionId: string;
  readonly attemptId: number;
  readonly outcome: RaceOutcome;
  /** Final place, 1-based. Required when the outcome is 'finished'. */
  readonly place: number | null;
  readonly finishSeconds: number | null;
  /** Credits the race paid into the garage balance, from the race's own reward. Zero when none. */
  readonly raceCredits: number;
}

export interface OutcomeSummary {
  readonly attemptKey: string;
  readonly raceEventId: string;
  readonly outcome: RaceOutcome;
  /** Credits added to the balance by this result: race reward, rival and rank rewards, and milestones together. */
  readonly creditsGained: number;
  readonly raceCredits: number;
  readonly reputationGained: number;
  /** Set when this result completed a career event for the first time. */
  readonly completedEventTitle: string | null;
  /** True when the career event was already completed before this attempt. Replays pay race credits only. */
  readonly replay: boolean;
  /** Set when this result defeated a rival for the first time. */
  readonly rivalDefeated: string | null;
  /** Set when this result met an objective for the first time. */
  readonly objectiveMet: string | null;
  readonly rankUps: readonly string[];
  readonly milestones: readonly string[];
  /** Next rival target after this result, or null when none is left. */
  readonly nextRivalName: string | null;
  /** True when this result set a new best time for its event. */
  readonly newBestTime: boolean;
  /** Championship points this result scored, and the cup it scored in. Null when the event is in no cup. */
  readonly championshipPoints: number | null;
  readonly championshipName: string | null;
  /** Championships and divisions completed by this result. */
  readonly championshipsWon: readonly string[];
  readonly divisionsCompleted: readonly string[];
}

export type OutcomeResult =
  | { readonly ok: true; readonly changed: boolean; readonly profile: ProfileState; readonly summary: OutcomeSummary | null }
  | { readonly ok: false; readonly code: 'unknown-race' | 'invalid-input'; readonly message: string };

function isWholeNonNegative(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Applies one finished or ended race attempt to the profile. This is the only rule that changes progress from a race.
 *
 * - Idempotent: an attempt key already processed changes nothing and returns no summary.
 * - Unknown race ids are refused, so an unknown id can never grant a reward.
 * - Race credits go to the garage balance. An aborted or timed-out race pays none.
 * - Career progress happens only for a career race, after the career is started, and only when the event is not locked.
 *   A free-roam race never touches it.
 * - A career event pays its reputation on the first completion only. A replay pays no reputation.
 * - A rival is defeated on a win, once. The defeat reward is paid once.
 * - An objective is met once per event and pays once.
 * - Rank and milestone rewards are settled in the same result, through settleCareer.
 */
/** A short id for one page load, so attempt keys from different sessions never match. Not secret; it only needs to be unique. */
export function newSessionId(): string {
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${Date.now().toString(36)}${random}`.slice(0, 24);
}

export function applyRaceOutcome(profile: ProfileState, input: RaceOutcomeInput, knownRaceIds: ReadonlySet<string>): OutcomeResult {
  if (!knownRaceIds.has(input.raceEventId)) {
    return { ok: false, code: 'unknown-race', message: `Unknown race "${input.raceEventId}". No reward was granted.` };
  }
  if (!isWholeNonNegative(input.attemptId) || !isWholeNonNegative(input.raceCredits)) {
    return { ok: false, code: 'invalid-input', message: 'The race result had invalid numbers.' };
  }
  if (input.outcome === 'finished' && (input.place === null || !Number.isInteger(input.place) || input.place < 1)) {
    return { ok: false, code: 'invalid-input', message: 'A finished race needs a place.' };
  }

  const attemptKey = `${input.raceEventId}#${input.sessionId}.${input.attemptId}`;
  if (profile.career.processedAttempts.includes(attemptKey)) {
    return { ok: true, changed: false, profile, summary: null };
  }

  // Race credits: the same garage balance as every other credit. The race's own ledger paid each attempt once.
  let garage = profile.garage;
  let creditsGained = 0;
  if (input.raceCredits > 0) {
    garage = addCareerCredits(garage, input.raceCredits, `race ${input.raceEventId}`);
    creditsGained += input.raceCredits;
  }

  let career = profile.career;
  const processed = [...career.processedAttempts, attemptKey].slice(-CAREER_CONFIG.processedAttemptLimit);
  career = { ...career, processedAttempts: processed };

  let reputationGained = 0;
  let completedEventTitle: string | null = null;
  let replay = false;
  let rivalDefeated: string | null = null;
  let objectiveMet: string | null = null;
  let newBestTime = false;
  let championshipPoints: number | null = null;
  let championshipName: string | null = null;
  const won = input.outcome === 'finished' && input.place === 1;

  // A career event that is still locked at result time grants no progress. The entry gate normally prevents that, and
  // this check makes the rule hold even if it were bypassed.
  const event = careerEventForRace(input.raceEventId);
  if (event && career.started && eventStatus(event, profile).status !== 'locked') {
    const wasCompleted = career.completedEvents.includes(event.id);
    replay = wasCompleted;
    const completedNow = event.completion === 'win' ? won : input.outcome === 'finished';

    if (completedNow && !wasCompleted) {
      career = { ...career, completedEvents: [...career.completedEvents, event.id] };
      reputationGained += event.reputationReward;
      completedEventTitle = event.title;
    }

    if (event.rivalId !== null && won) {
      const rival = rivalById(event.rivalId);
      if (rival && !career.defeatedRivals.includes(rival.id)) {
        career = {
          ...career,
          defeatedRivals: [...career.defeatedRivals, rival.id],
          grantedRewards: [...career.grantedRewards, `rival:${rival.id}:defeat`],
        };
        reputationGained += rival.defeatReward.reputation;
        garage = addCareerCredits(garage, rival.defeatReward.credits, `rival ${rival.id}`);
        creditsGained += rival.defeatReward.credits;
        rivalDefeated = rival.name;
      }
    }

    const objective = event.objective;
    if (objective && input.outcome === 'finished' && input.finishSeconds !== null && input.finishSeconds <= objective.maxSeconds) {
      const key = `objective:${event.id}:${objective.id}`;
      if (!career.grantedRewards.includes(key)) {
        career = { ...career, grantedRewards: [...career.grantedRewards, key] };
        reputationGained += objective.reputationReward;
        objectiveMet = objective.label;
      }
    }

    // A finished attempt sets a best time when it beats the saved one. Replays can set one too.
    if (input.outcome === 'finished' && input.finishSeconds !== null && Number.isFinite(input.finishSeconds)) {
      const seconds = roundSeconds(input.finishSeconds);
      const previous = career.bestTimes[event.id];
      if (seconds > 0 && seconds <= CAREER_CONFIG.bestTimeMaxSeconds && (previous === undefined || seconds < previous)) {
        career = { ...career, bestTimes: { ...career.bestTimes, [event.id]: seconds } };
        newBestTime = true;
      }
    }

    // A finish in a championship event scores by place. Each event keeps its best points, and a replay can raise them.
    const cup = championshipForEvent(event.id);
    if (cup && input.outcome === 'finished' && input.place !== null) {
      const points = pointsForPlace(input.place);
      const key = cupScoreKey(cup.id, event.id);
      const previous = career.cupScores[key];
      championshipPoints = points;
      championshipName = cup.name;
      if (previous === undefined || points > previous) {
        career = { ...career, cupScores: { ...career.cupScores, [key]: points } };
      }
    }

    // A tracked event that is now completed stops being the target, so the hub points at the next step.
    if (career.trackedEventId === event.id && career.completedEvents.includes(event.id)) {
      career = { ...career, trackedEventId: null };
    }
  }

  if (reputationGained > 0) {
    career = { ...career, reputation: Math.min(CAREER_CONFIG.reputationMax, career.reputation + reputationGained) };
  }

  const settled = settleCareer({ garage, career });
  creditsGained += settled.awards.credits;
  reputationGained += settled.awards.reputation;
  const nextTarget = nextRivalTarget(settled.profile);
  const summary: OutcomeSummary = {
    attemptKey,
    raceEventId: input.raceEventId,
    outcome: input.outcome,
    creditsGained,
    raceCredits: input.raceCredits,
    reputationGained,
    completedEventTitle,
    replay,
    rivalDefeated,
    objectiveMet,
    rankUps: settled.awards.rankUps.map((rank) => rank.name),
    milestones: settled.awards.milestones.map((milestone) => milestone.title),
    nextRivalName: nextTarget ? nextTarget.name : null,
    newBestTime,
    championshipPoints,
    championshipName,
    championshipsWon: settled.awards.championships.map((cup) => cup.name),
    divisionsCompleted: settled.awards.divisions.map((division) => division.name),
  };
  return { ok: true, changed: true, profile: settled.profile, summary };
}

/**
 * Records one pursuit escape: the police gave up after losing the player. Counts only once the career has started. It
 * never starts or changes a pursuit. The milestone is paid by the normal settle.
 */
export function recordPursuitEscape(profile: ProfileState): { profile: ProfileState; milestones: readonly string[] } {
  if (!profile.career.started) return { profile, milestones: [] };
  const career: CareerState = {
    ...profile.career,
    pursuitEscapes: Math.min(CAREER_CONFIG.escapeCountMax, profile.career.pursuitEscapes + 1),
  };
  const settled = settleCareer({ garage: profile.garage, career });
  return { profile: settled.profile, milestones: settled.awards.milestones.map((milestone) => milestone.title) };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* View model for the hub                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface CareerEventRow {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly kind: CareerEventDefinition['kind'];
  readonly format: CareerEventDefinition['format'];
  /** Best finish time in seconds, or null when none is recorded. */
  readonly bestSeconds: number | null;
  readonly areaLabel: string;
  readonly raceEventId: string;
  readonly status: EventStatus;
  readonly reasons: readonly string[];
  readonly reputationReward: number;
  /** Race credits for a win or finish, from the race definition. */
  readonly raceCredits: number;
  readonly completion: CareerEventDefinition['completion'];
  readonly objective: { readonly label: string; readonly met: boolean } | null;
  readonly isTracked: boolean;
  readonly rivalName: string | null;
}

export interface DivisionView {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly intro: string;
  readonly status: DivisionStatus;
  readonly requirementText: string;
  readonly eventsDone: number;
  readonly eventsTotal: number;
  readonly championshipsDone: number;
  readonly championshipsTotal: number;
  readonly championName: string | null;
  readonly championDefeated: boolean;
  readonly complete: boolean;
}

export interface ChampionshipView {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly events: readonly { readonly id: string; readonly title: string; readonly finished: boolean; readonly points: number | null }[];
  readonly points: number;
  readonly complete: boolean;
  readonly reward: ChampionshipDefinition['reward'];
}

export interface CareerView {
  readonly started: boolean;
  /** The division the player is working in: the first open division not yet complete, or null. */
  readonly currentDivisionId: string | null;
  readonly divisions: readonly DivisionView[];
  readonly championships: readonly ChampionshipView[];
  /** One plain sentence: the next step in the campaign. */
  readonly mainObjective: string;
  readonly pursuitEscapes: number;
  readonly introduction: string;
  readonly rank: { readonly id: string; readonly name: string; readonly index: number; readonly total: number };
  readonly reputation: number;
  readonly fraction: number;
  readonly nextRankName: string | null;
  readonly reputationToNext: number | null;
  readonly events: readonly CareerEventRow[];
  readonly leaderboard: ReturnType<typeof leaderboard>;
  /** The next step: the chosen event, or the suggested one when none is chosen (explicit = false). */
  readonly target: { readonly eventId: string; readonly title: string; readonly areaLabel: string; readonly explicit: boolean } | null;
  readonly milestones: readonly MilestoneView[];
  readonly completedEventCount: number;
  readonly defeatedCount: number;
  readonly totalRivals: number;
  readonly unlockedEventCount: number;
  readonly totalEvents: number;
  readonly nextRival: { readonly id: string; readonly name: string } | null;
}

/** The view the hub reads. It is derived, so the hub never holds career data of its own. */
/** The next step in the campaign, as one sentence. Derived from the state, so it cannot disagree with it. */
export function mainObjective(profile: ProfileState): string {
  if (!profile.career.started) return 'Start your career in the career hub.';
  const division = DIVISIONS.find((candidate) => candidate.status === 'open' && !divisionComplete(candidate, profile.career));
  if (!division) {
    return 'Every open division is complete. Other rivals on the ladder are still open.';
  }
  const nextEvent = division.eventIds.map((id) => careerEventById(id)).find((event) => event && !profile.career.completedEvents.includes(event.id));
  if (nextEvent) {
    const view = eventStatus(nextEvent, profile);
    return view.status === 'locked'
      ? `${division.name}: next is ${nextEvent.title}. ${view.reasons[0] ?? 'It is locked.'}`
      : `${division.name}: ${nextEvent.title}.`;
  }
  const cup = CHAMPIONSHIPS.find((candidate) => division.championshipIds.includes(candidate.id) && !championshipComplete(candidate, profile.career));
  if (cup) {
    const done = cup.eventIds.filter((eventId) => profile.career.cupScores[cupScoreKey(cup.id, eventId)] !== undefined).length;
    return `${division.name}: finish the ${cup.name} (${done} of ${cup.eventIds.length} races).`;
  }
  const champion = division.championRivalId ? rivalById(division.championRivalId) : null;
  return champion ? `${division.name}: defeat ${champion.name} to complete the division.` : `${division.name}: complete.`;
}

/**
 * The event the hub points at: the event the player chose, or else the first event that is available and not yet
 * completed. Null when there is no such event. Shared by the hub and the navigation route, so they cannot disagree.
 */
export function careerTargetEventId(profile: ProfileState): string | null {
  const tracked = profile.career.trackedEventId ? careerEventById(profile.career.trackedEventId) : null;
  const suggested = CAREER_EVENTS.find((event) => eventStatus(event, profile).status === 'available') ?? null;
  const chosen = tracked ?? suggested;
  return chosen ? chosen.id : null;
}

export function buildCareerView(profile: ProfileState): CareerView {
  const progress = rankProgress(profile.career.reputation);
  const rankIndex = CAREER_RANKS.findIndex((rank) => rank.id === progress.rank.id);
  const events: CareerEventRow[] = CAREER_EVENTS.map((event) => {
    const view = eventStatus(event, profile);
    const race = CAREER_RACE_EVENTS.find((candidate) => candidate.id === event.raceEventId);
    const rival = event.rivalId ? rivalById(event.rivalId) : null;
    return {
      id: event.id,
      title: event.title,
      summary: event.summary,
      kind: event.kind,
      format: event.format,
      bestSeconds: profile.career.bestTimes[event.id] ?? null,
      areaLabel: event.areaLabel,
      raceEventId: event.raceEventId,
      status: view.status,
      reasons: view.reasons,
      reputationReward: event.reputationReward,
      raceCredits: race ? race.rewardCredits : 0,
      completion: event.completion,
      objective: event.objective
        ? {
            label: event.objective.label,
            met: profile.career.grantedRewards.includes(`objective:${event.id}:${event.objective.id}`),
          }
        : null,
      isTracked: profile.career.trackedEventId === event.id,
      rivalName: rival ? rival.name : null,
    };
  });
  // The target is the event the player chose. If none is chosen, the hub suggests the first event that is available and
  // not yet completed, so there is always a visible next step while one exists.
  const tracked = profile.career.trackedEventId ? careerEventById(profile.career.trackedEventId) : null;
  const chosen = tracked ?? CAREER_EVENTS.find((event) => eventStatus(event, profile).status === 'available') ?? null;
  const target = chosen ? { eventId: chosen.id, title: chosen.title, areaLabel: chosen.areaLabel, explicit: tracked !== null } : null;
  const nextRival = nextRivalTarget(profile);
  const divisions: DivisionView[] = DIVISIONS.map((division) => {
    const eventsDone = division.eventIds.filter((id) => profile.career.completedEvents.includes(id)).length;
    const cupsDone = division.championshipIds.filter((cupId) => {
      const cup = CHAMPIONSHIPS.find((candidate) => candidate.id === cupId);
      return cup !== undefined && championshipComplete(cup, profile.career);
    }).length;
    const champion = division.championRivalId ? rivalById(division.championRivalId) : null;
    return {
      id: division.id,
      number: division.number,
      name: division.name,
      intro: division.intro,
      status: division.status,
      requirementText: division.requirementText,
      eventsDone,
      eventsTotal: division.eventIds.length,
      championshipsDone: cupsDone,
      championshipsTotal: division.championshipIds.length,
      championName: champion ? champion.name : null,
      championDefeated: champion ? profile.career.defeatedRivals.includes(champion.id) : false,
      complete: divisionComplete(division, profile.career),
    };
  });
  const currentDivision = DIVISIONS.find((division) => division.status === 'open' && !divisionComplete(division, profile.career)) ?? null;
  const championships: ChampionshipView[] = CHAMPIONSHIPS.map((cup) => ({
    id: cup.id,
    name: cup.name,
    summary: cup.summary,
    events: cup.eventIds.map((eventId) => {
      const event = careerEventById(eventId);
      const points = profile.career.cupScores[cupScoreKey(cup.id, eventId)];
      return {
        id: eventId,
        title: event ? event.title : eventId,
        finished: points !== undefined,
        points: points ?? null,
      };
    }),
    points: cup.eventIds.reduce((sum, eventId) => sum + (profile.career.cupScores[cupScoreKey(cup.id, eventId)] ?? 0), 0),
    complete: championshipComplete(cup, profile.career),
    reward: cup.reward,
  }));

  return {
    started: profile.career.started,
    currentDivisionId: currentDivision ? currentDivision.id : null,
    divisions,
    championships,
    mainObjective: mainObjective(profile),
    pursuitEscapes: profile.career.pursuitEscapes,
    introduction: profile.career.started ? '' : INTRODUCTION_TEXT,
    rank: { id: progress.rank.id, name: progress.rank.name, index: rankIndex, total: CAREER_RANKS.length },
    reputation: profile.career.reputation,
    fraction: progress.fraction,
    nextRankName: progress.next ? progress.next.name : null,
    reputationToNext: progress.reputationToNext,
    events,
    leaderboard: leaderboard(profile),
    target,
    milestones: milestoneViews(profile),
    completedEventCount: profile.career.completedEvents.length,
    defeatedCount: profile.career.defeatedRivals.length,
    totalRivals: RIVALS.length,
    unlockedEventCount: events.filter((event) => event.status !== 'locked').length,
    totalEvents: events.length,
    nextRival: nextRival ? { id: nextRival.id, name: nextRival.name } : null,
  };
}
