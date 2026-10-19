/*
 * Race definitions for career events (Part 9). These are data, built on the existing Sprint and Circuit routes. Each
 * career race has its own marker, so a free-roam race and a career race never share a marker and can never be
 * confused. The shared race code runs them with no career-specific branch.
 *
 * Opponent pace is set in opponentTopSpeedMps, scaled by difficulty (RACE_DIFFICULTY_SPEED_FACTOR). The rival's
 * vehicle in the catalogue is presentation only. Rivals drive the shared AI, not that vehicle's handling.
 */
import * as LAYOUT from '../race/routeLayouts';
import { routeMarker, type RouteLayout } from '../race/routeLayouts';
import { RACE_MIN_RACERS } from '../config/raceConfig';
import type { RaceEventDefinition } from '../race/raceTypes';
import type { TrafficTypeId } from '../traffic/trafficTypes';
import { CAREER_EVENTS, RIVALS, rivalById } from './careerCatalogue';

export const CAREER_WARMUP_RACE_ID = 'career-warmup-race';

/** The Clock Run's id. It is the one career race with no rivals: a solo time trial, which the full-field rule does not apply to. */
export const CAREER_CLOCK_RACE_ID = 'career-clock-race';

/** Rivals in every career race other than the Clock Run: the named rival or first challenger, plus generic racers. */
const RACE_MIN_OPPONENTS = RACE_MIN_RACERS - 1;

/**
 * Race ids for the rival challenges, keyed by rival id. Each career race has its own path (routeLayouts.ts). The path
 * is what makes two races different, so no two career races share one.
 */
const RIVAL_RACE_IDS: Readonly<Record<string, string>> = {
  'mara-quill': 'rival-mara-race',
  'teo-varga': 'rival-teo-race',
  'juno-ashdown': 'rival-juno-race',
  'kai-mensah': 'rival-kai-race',
  'ren-adair': 'rival-adair-race',
};

/** The rival's car as a traffic shape, for the AI model. Presentation only. */
const RIVAL_BODY: Readonly<Record<string, TrafficTypeId>> = {
  'mara-quill': 'compact',
  'teo-varga': 'sedan',
  'juno-ashdown': 'suv',
  'kai-mensah': 'sedan',
  'ren-adair': 'sedan',
};

interface RivalRaceTuning {
  readonly difficulty: 1 | 2 | 3;
  readonly opponentTopSpeedMps: number;
  readonly rewardCredits: number;
  /** The race's own path. The marker is placed on its start line. */
  readonly route: RouteLayout;
  /** Traffic keeps running on the route for this race (Division 2). */
  readonly trafficOnRoute?: boolean;
}

/** Tuning for each rival's race. The first rival is the easiest, so a new player can win it. */
const RIVAL_TUNING: Readonly<Record<string, RivalRaceTuning>> = {
  'mara-quill': { difficulty: 1, opponentTopSpeedMps: 23, rewardCredits: 300, route: LAYOUT.LAYOUT_MARA },
  'teo-varga': { difficulty: 2, opponentTopSpeedMps: 23, rewardCredits: 400, route: LAYOUT.LAYOUT_TEO_COMMERCIAL },
  'juno-ashdown': { difficulty: 2, opponentTopSpeedMps: 28, rewardCredits: 350, route: LAYOUT.LAYOUT_JUNO_HIGHWAY },
  'kai-mensah': { difficulty: 3, opponentTopSpeedMps: 30, rewardCredits: 500, route: LAYOUT.LAYOUT_KAI_DOWNTOWN },
  // Ren's cap at the back of the grid (30.8 x 1.08 x 2.5) stays under the 300 km/h top speed of the fastest car.
  'ren-adair': { difficulty: 3, opponentTopSpeedMps: 30.8, rewardCredits: 800, route: LAYOUT.LAYOUT_REN_TOWER, trafficOnRoute: true },
};

function warmupRace(): RaceEventDefinition {
  const event = CAREER_EVENTS.find((candidate) => candidate.id === 'career-warmup');
  return {
    ...LAYOUT.LAYOUT_WARMUP,
    id: CAREER_WARMUP_RACE_ID,
    name: event?.title ?? 'Harbour Warm-Up',
    summary: event?.summary ?? 'A short run across the south edge of the city.',
    difficulty: 1,
    opponentCount: RACE_MIN_OPPONENTS,
    opponents: [{ name: 'Pier Racer', typeId: 'compact' }],
    opponentTopSpeedMps: 21,
    rewardCredits: 150,
    marker: routeMarker(LAYOUT.LAYOUT_WARMUP),
  };
}

function rivalRace(rivalId: string): RaceEventDefinition {
  const rival = rivalById(rivalId);
  const tuning = RIVAL_TUNING[rivalId];
  const raceId = RIVAL_RACE_IDS[rivalId];
  const challenge = CAREER_EVENTS.find((event) => event.rivalId === rivalId);
  if (!rival || !tuning || !raceId || !challenge) throw new Error(`career race: no rival definition for "${rivalId}"`);
  return {
    ...tuning.route,
    id: raceId,
    name: challenge.title,
    summary: `${rival.name} is on the line. ${challenge.summary}`,
    difficulty: tuning.difficulty,
    opponentCount: RACE_MIN_OPPONENTS,
    opponents: [{ name: rival.name, typeId: RIVAL_BODY[rivalId] ?? 'sedan' }],
    opponentTopSpeedMps: tuning.opponentTopSpeedMps,
    rewardCredits: tuning.rewardCredits,
    marker: routeMarker(tuning.route),
    ...(tuning.trafficOnRoute ? { trafficOnRoute: true } : {}),
  };
}

/** Division 1 races that are not rival challenges. Each has its own marker, so no two career events share a beacon. */
function blockLapsRace(): RaceEventDefinition {
  return {
    ...LAYOUT.LAYOUT_BLOCK_WEST,
    id: 'career-block-race',
    name: 'Block Laps',
    summary: 'Two laps of a residential block on the west side, with one local racer.',
    difficulty: 1,
    opponentCount: RACE_MIN_OPPONENTS,
    opponents: [{ name: 'Northline Regular', typeId: 'compact' }],
    opponentTopSpeedMps: 21,
    rewardCredits: 200,
    marker: routeMarker(LAYOUT.LAYOUT_BLOCK_WEST),
  };
}

/**
 * The checkpoint challenge: the Eastside route with a time limit. A timeout ends the attempt as a failure, so the limit is
 * part of the event, enforced by the shared race engine.
 */
function checkpointRace(): RaceEventDefinition {
  return {
    ...LAYOUT.LAYOUT_CHECKPOINT_WEST,
    id: 'career-checkpoint-race',
    name: 'Checkpoint Run',
    summary: 'Both checkpoints and the finish within 240 seconds, with one racer on the route.',
    difficulty: 2,
    opponentCount: RACE_MIN_OPPONENTS,
    opponents: [{ name: 'Market Racer', typeId: 'sedan' }],
    opponentTopSpeedMps: 23,
    timeLimitSeconds: 240,
    rewardCredits: 250,
    marker: routeMarker(LAYOUT.LAYOUT_CHECKPOINT_WEST),
  };
}

/**
 * The clock run: a countryside route alone. No opponents and no time limit. The finish time is what is recorded. Its
 * race credits are modest, so a replay cannot be a credit farm.
 */
function clockRace(): RaceEventDefinition {
  return {
    ...LAYOUT.LAYOUT_CLOCK_COUNTRY,
    id: CAREER_CLOCK_RACE_ID,
    name: 'Clock Run',
    summary: 'A countryside run in the south-east, driven alone against the clock.',
    difficulty: 1,
    opponentCount: 0,
    opponents: [],
    opponentTopSpeedMps: 0,
    timeLimitSeconds: null,
    rewardCredits: 100,
    marker: routeMarker(LAYOUT.LAYOUT_CLOCK_COUNTRY),
  };
}

/** Division 2 races (Urban Syndicate). Traffic keeps running on the route for each. Each has its own marker. */
function warehouseRace(): RaceEventDefinition {
  return {
    ...LAYOUT.LAYOUT_WAREHOUSE,
    id: 'career-warehouse-race',
    name: 'Warehouse Circuit',
    summary: 'Two laps of a hillside block with traffic on the road and one local racer.',
    difficulty: 3,
    opponentCount: RACE_MIN_OPPONENTS,
    opponents: [{ name: 'Freight Racer', typeId: 'sedan' }],
    opponentTopSpeedMps: 27,
    rewardCredits: 300,
    marker: routeMarker(LAYOUT.LAYOUT_WAREHOUSE),
    trafficOnRoute: true,
  };
}

function seamRace(): RaceEventDefinition {
  return {
    ...LAYOUT.LAYOUT_SEAM_RIDGE,
    id: 'career-seam-race',
    name: 'Seam Run',
    summary: 'One run along the Seam, with traffic on the road.',
    difficulty: 3,
    opponentCount: RACE_MIN_OPPONENTS,
    opponents: [{ name: 'Seam Courier', typeId: 'compact' }],
    opponentTopSpeedMps: 27,
    rewardCredits: 300,
    marker: routeMarker(LAYOUT.LAYOUT_SEAM_RIDGE),
    trafficOnRoute: true,
  };
}

/** Tight Corners: a switchback run with a 210 second limit, and traffic on the road. */
function tightCornersRace(): RaceEventDefinition {
  return {
    ...LAYOUT.LAYOUT_TIGHT_CORNERS,
    id: 'career-tight-race',
    name: 'Tight Corners',
    summary: 'Both checkpoints and the finish within 210 seconds, with traffic on the road.',
    difficulty: 3,
    opponentCount: RACE_MIN_OPPONENTS,
    opponents: [{ name: 'Corner Racer', typeId: 'sedan' }],
    opponentTopSpeedMps: 29,
    timeLimitSeconds: 210,
    rewardCredits: 350,
    marker: routeMarker(LAYOUT.LAYOUT_TIGHT_CORNERS),
    trafficOnRoute: true,
  };
}

/** Every career race, in catalogue order. The race controller builds these alongside the free-roam events. */
export const CAREER_RACE_EVENTS: readonly RaceEventDefinition[] = [
  warmupRace(),
  blockLapsRace(),
  checkpointRace(),
  clockRace(),
  warehouseRace(),
  seamRace(),
  tightCornersRace(),
  ...RIVALS.map((rival) => rivalRace(rival.id)),
];

/** Race event ids that belong to the career. Free-roam events are not in this set. */
export const CAREER_RACE_IDS: ReadonlySet<string> = new Set(CAREER_RACE_EVENTS.map((event) => event.id));
