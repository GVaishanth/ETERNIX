/*
 * Career catalogue (Part 9): the immutable progression content. Original names, text, and numbers. No geometry here.
 * Race routes for career events are in careerRaces.ts, linked by stable race event id.
 *
 * Progression chain (the first complete loop):
 *   warm-up race  ->  Mara Quill (rival, ladder 5)  ->  Teo Varga (4)  ->  Juno Ashdown (3)  ->  Kai Mensah (2)
 *   Division 2 (Urban Syndicate) closes with Ren Adair (ladder 1, the top), who is beaten last.
 * Every step needs the one before it (see prerequisites). Milestones and ranks are separate from that chain.
 *
 * validateCareerCatalogue() checks references, unique ids, ladder positions, rank order, and prerequisite cycles. The
 * tests run it on this data together with the vehicle catalogue and the race routes.
 */
import { CAREER_MAX_RANKS } from '../config/careerConfig';
import type {
  CareerEventDefinition,
  ChampionshipDefinition,
  DivisionDefinition,
  MilestoneDefinition,
  Prerequisite,
  RankDefinition,
  RivalDefinition,
} from './careerTypes';

export const INTRODUCTION_TEXT =
  'Your career runs on reputation. Finish and win races to earn it. Reputation unlocks events and rivals, and it sets your rank. ' +
  'Credits still buy cars and upgrades. Rivals are beaten one at a time, from the bottom of the ladder up.';

/** Ranks in ascending order. The first rank starts at 0 reputation, so every value is reached by growth. */
export const CAREER_RANKS: readonly RankDefinition[] = [
  { id: 'rank-newcomer', name: 'Newcomer', minReputation: 0, creditReward: 0 },
  { id: 'rank-street-regular', name: 'Street Regular', minReputation: 40, creditReward: 200 },
  { id: 'rank-road-name', name: 'Road Name', minReputation: 120, creditReward: 300 },
  { id: 'rank-night-contender', name: 'Night Contender', minReputation: 240, creditReward: 400 },
  { id: 'rank-city-legend', name: 'City Legend', minReputation: 380, creditReward: 600 },
];

export const RIVALS: readonly RivalDefinition[] = [
  {
    id: 'mara-quill',
    name: 'Mara Quill',
    ladderPosition: 5,
    biography: 'Learned to drive on the wet dock roads, where the lines fade by midnight. Quick away from the lights, and careful after that.',
    drivingStyle: 'Strong off the line, eases off on long bends.',
    preferredEventType: 'sprint',
    vehicleId: 'tarn-roadster',
    challengeEventIds: ['rival-mara-challenge'],
    defeatReward: { reputation: 40, credits: 400 },
  },
  {
    id: 'teo-varga',
    name: 'Teo Varga',
    ladderPosition: 4,
    biography: 'Runs the same block every night and knows every kerb on it. Patient, and hard to pass on a corner.',
    drivingStyle: 'Consistent on laps. Holds a line through the corners.',
    preferredEventType: 'circuit',
    vehicleId: 'bastion-sedan',
    challengeEventIds: ['rival-teo-challenge'],
    defeatReward: { reputation: 70, credits: 600 },
  },
  {
    id: 'juno-ashdown',
    name: 'Juno Ashdown',
    ladderPosition: 3,
    biography: 'Fast on the open avenues and quick to notice a gap. Has never been beaten to a finish line she could see.',
    drivingStyle: 'Fast on straights. Brakes late and rarely early.',
    preferredEventType: 'sprint',
    vehicleId: 'volt-e',
    challengeEventIds: ['rival-juno-challenge'],
    defeatReward: { reputation: 120, credits: 900 },
  },
  {
    id: 'kai-mensah',
    name: 'Kai Mensah',
    ladderPosition: 2,
    biography: 'The name second on the board, under the Syndicate boss. Races for the city, not for money, and says little before the start.',
    drivingStyle: 'Fastest car on the ladder. Strong on every type of road.',
    preferredEventType: 'circuit',
    vehicleId: 'halcyon-gt',
    challengeEventIds: ['rival-kai-challenge'],
    defeatReward: { reputation: 150, credits: 1500 },
  },
  {
    id: 'ren-adair',
    name: 'Ren Adair',
    ladderPosition: 1,
    biography: 'Runs the Urban Syndicate from a garage nobody has seen inside. Never races for the prize, only for the corner nobody else will take.',
    drivingStyle: 'Brakes at the last marker and takes the tightest line. Hard to pass through the corners.',
    preferredEventType: 'circuit',
    vehicleId: 'phantom-lx',
    challengeEventIds: ['rival-adair-challenge'],
    defeatReward: { reputation: 200, credits: 1800 },
  },
];

const CAREER_EVENTS_BASE: readonly CareerEventDefinition[] = [
  {
    id: 'career-warmup',
    title: 'Harbour Warm-Up',
    summary: 'A single run from the south-west street to the south-east corner. Finish to earn your first reputation.',
    kind: 'race',
    format: 'sprint',
    areaLabel: 'Harbour Front',
    raceEventId: 'career-warmup-race',
    rivalId: null,
    completion: 'finish',
    reputationReward: 10,
    prerequisites: [],
    objective: { id: 'under-200s', label: 'Finish under 200 seconds', maxSeconds: 200, reputationReward: 5 },
  },
  {
    id: 'rival-mara-challenge',
    title: 'Mara Quill: Dock Run',
    summary: 'Beat Mara Quill to the finish line on the dock run.',
    kind: 'rival',
    format: 'rival',
    areaLabel: 'Westgate Row',
    raceEventId: 'rival-mara-race',
    rivalId: 'mara-quill',
    completion: 'win',
    reputationReward: 0,
    prerequisites: [{ kind: 'event-completed', eventId: 'career-warmup' }],
    objective: null,
  },
  {
    id: 'rival-teo-challenge',
    title: 'Teo Varga: Block Laps',
    summary: 'Two laps of the commercial block against Teo Varga. Win the race to take his place on the board.',
    kind: 'rival',
    format: 'rival',
    areaLabel: 'Commercial Row',
    raceEventId: 'rival-teo-race',
    rivalId: 'teo-varga',
    completion: 'win',
    reputationReward: 0,
    prerequisites: [
      { kind: 'rival-defeated', rivalId: 'mara-quill' },
      { kind: 'reputation', min: 40 },
    ],
    objective: null,
  },
  {
    id: 'rival-juno-challenge',
    title: 'Juno Ashdown: Avenue Sprint',
    summary: 'A fast run down the avenues. Juno Ashdown has not lost a finish in the city yet.',
    kind: 'rival',
    format: 'rival',
    areaLabel: 'Highway North',
    raceEventId: 'rival-juno-race',
    rivalId: 'juno-ashdown',
    completion: 'win',
    reputationReward: 0,
    prerequisites: [
      { kind: 'rival-defeated', rivalId: 'teo-varga' },
      { kind: 'reputation', min: 120 },
    ],
    objective: null,
  },
  {
    id: 'rival-kai-challenge',
    title: 'Kai Mensah: Top Lap',
    summary: 'Two laps of the downtown block with the name second on the board. Win and the ladder is yours.',
    kind: 'rival',
    format: 'rival',
    areaLabel: 'Downtown Block',
    raceEventId: 'rival-kai-race',
    rivalId: 'kai-mensah',
    completion: 'win',
    reputationReward: 0,
    prerequisites: [
      { kind: 'rival-defeated', rivalId: 'juno-ashdown' },
      { kind: 'reputation', min: 240 },
    ],
    objective: null,
  },
];

/**
 * Division 1 events (Street Origins). Each is a race on an existing base or a checkpoint or time-attack variant. The
 * routes are in careerRaces.ts. The three events after the warm-up open once the warm-up is finished.
 */
const DIVISION_ONE_EVENTS: readonly CareerEventDefinition[] = [
  {
    id: 'career-block-laps',
    title: 'Block Laps',
    summary: 'Two laps of a residential block on the west side with one local racer. Each lap counts only after the start-finish line.',
    kind: 'race',
    format: 'circuit',
    areaLabel: 'Westgate Block',
    raceEventId: 'career-block-race',
    rivalId: null,
    completion: 'finish',
    reputationReward: 15,
    prerequisites: [{ kind: 'event-completed', eventId: 'career-warmup' }],
    objective: null,
  },
  {
    id: 'career-checkpoint-run',
    title: 'Checkpoint Run',
    summary: 'Reach both checkpoints and the finish within 240 seconds. Run out of time and the attempt is a timeout.',
    kind: 'race',
    format: 'checkpoint',
    areaLabel: 'West Edge',
    raceEventId: 'career-checkpoint-race',
    rivalId: null,
    completion: 'finish',
    reputationReward: 20,
    prerequisites: [{ kind: 'event-completed', eventId: 'career-warmup' }],
    objective: null,
  },
  {
    id: 'career-clock-run',
    title: 'Clock Run',
    summary: 'Run the south-east country road alone against the clock. Your best finish time is kept, and your first finish pays reputation.',
    kind: 'race',
    format: 'time-attack',
    areaLabel: 'North Country Road',
    raceEventId: 'career-clock-race',
    rivalId: null,
    completion: 'finish',
    reputationReward: 15,
    prerequisites: [{ kind: 'event-completed', eventId: 'career-warmup' }],
    objective: null,
  },
];

/**
 * Division 2 events (Urban Syndicate). Technical city races with traffic on the route (`trafficOnRoute` in careerRaces.ts).
 * The first opens once Mara Quill is beaten and the player has 120 reputation. The rest follow in order. Ren Adair
 * closes the division.
 */
const DIVISION_TWO_EVENTS: readonly CareerEventDefinition[] = [
  {
    id: 'career-warehouse-circuit',
    title: 'Warehouse Circuit',
    summary: 'Two laps of a hillside block with traffic on the road and one local racer. Keep the line through the tight bends.',
    kind: 'race',
    format: 'circuit',
    areaLabel: 'South Hillside Block',
    raceEventId: 'career-warehouse-race',
    rivalId: null,
    completion: 'finish',
    reputationReward: 20,
    prerequisites: [
      { kind: 'rival-defeated', rivalId: 'mara-quill' },
      { kind: 'reputation', min: 120 },
    ],
    objective: null,
  },
  {
    id: 'career-seam-run',
    title: 'Seam Run',
    summary: 'One run along the Seam, with traffic on the road. Finish to earn reputation.',
    kind: 'race',
    format: 'sprint',
    areaLabel: 'Seam Street',
    raceEventId: 'career-seam-race',
    rivalId: null,
    completion: 'finish',
    reputationReward: 20,
    prerequisites: [{ kind: 'event-completed', eventId: 'career-warehouse-circuit' }],
    objective: null,
  },
  {
    id: 'career-tight-corners',
    title: 'Tight Corners',
    summary: 'Both checkpoints and the finish within 210 seconds, with traffic on the road.',
    kind: 'race',
    format: 'checkpoint',
    areaLabel: 'Tight Corner Row',
    raceEventId: 'career-tight-race',
    rivalId: null,
    completion: 'finish',
    reputationReward: 25,
    prerequisites: [{ kind: 'event-completed', eventId: 'career-seam-run' }],
    objective: null,
  },
  {
    id: 'rival-adair-challenge',
    title: 'Ren Adair: Syndicate Circuit',
    summary: 'Two laps of the Syndicate quarter against Ren Adair, with traffic on the road. Win and the Syndicate is yours.',
    kind: 'rival',
    format: 'rival',
    areaLabel: 'Syndicate Quarter',
    raceEventId: 'rival-adair-race',
    rivalId: 'ren-adair',
    completion: 'win',
    reputationReward: 0,
    prerequisites: [{ kind: 'event-completed', eventId: 'career-tight-corners' }],
    objective: null,
  },
];

export const CAREER_EVENTS: readonly CareerEventDefinition[] = [...CAREER_EVENTS_BASE, ...DIVISION_ONE_EVENTS, ...DIVISION_TWO_EVENTS];

/** Championships (cups). Each is a fixed set of events scored by place. See ChampionshipDefinition. */
export const CHAMPIONSHIPS: readonly ChampionshipDefinition[] = [
  {
    id: 'street-origins-cup',
    name: 'Street Origins Cup',
    summary: 'Three races: the warm-up, Block Laps, and the Checkpoint Run. Score by place in each. Finish all three to win the cup.',
    eventIds: ['career-warmup', 'career-block-laps', 'career-checkpoint-run'],
    reward: { reputation: 30, credits: 400 },
  },
  {
    id: 'syndicate-cup',
    name: 'Syndicate Cup',
    summary: 'Three races: the Warehouse Circuit, the Seam Run, and Tight Corners. Score by place in each. Finish all three to win the cup.',
    eventIds: ['career-warehouse-circuit', 'career-seam-run', 'career-tight-corners'],
    reward: { reputation: 40, credits: 600 },
  },
];

/**
 * The five divisions. Only Division 1 has content in this build, so only it is 'open'. The other four are 'planned':
 * they show their intro and requirement, and they have no events, so nothing in them can be entered.
 */
export const DIVISIONS: readonly DivisionDefinition[] = [
  {
    id: 'division-1-street-origins',
    number: 1,
    name: 'Street Origins',
    intro: 'Learn the city. Free roam, short sprints, a basic circuit, a timed run, and your first rival.',
    status: 'open',
    requirementText: 'Open from the start of the career.',
    eventIds: ['career-warmup', 'career-block-laps', 'career-checkpoint-run', 'career-clock-run', 'rival-mara-challenge'],
    championshipIds: ['street-origins-cup'],
    championRivalId: 'mara-quill',
    completionReward: { reputation: 50, credits: 500 },
    retireRacesOnComplete: true,
    lead: "Mara Quill leaves a folded note on your garage bench: 'The Urban Syndicate watched your last run. They want to meet you, and they don't race for trophies.' Division 2: Urban Syndicate is next.",
  },
  {
    id: 'division-2-urban-syndicate',
    number: 2,
    name: 'Urban Syndicate',
    intro: 'Technical city races, traffic on the route, tight corners, and rival crews.',
    status: 'open',
    requirementText: 'Opens after Division 1: beat Mara Quill and reach 120 reputation.',
    eventIds: ['career-warehouse-circuit', 'career-seam-run', 'career-tight-corners', 'rival-adair-challenge'],
    championshipIds: ['syndicate-cup'],
    championRivalId: 'ren-adair',
    completionReward: { reputation: 80, credits: 900 },
  },
  {
    id: 'division-3-highway-collective',
    number: 3,
    name: 'Highway Collective',
    intro: 'High-speed sprints, highway routes, longer events, and stronger opponents.',
    status: 'planned',
    requirementText: 'Not in this build. Its requirement is set when its events are built.',
    eventIds: [],
    championshipIds: [],
    championRivalId: null,
    completionReward: { reputation: 0, credits: 0 },
  },
  {
    id: 'division-4-apex-circle',
    number: 4,
    name: 'Apex Circle',
    intro: 'Technical circuits, mountain roads, high-performance cars, and elite rivals.',
    status: 'planned',
    requirementText: 'Not in this build. Its requirement is set when its events are built.',
    eventIds: [],
    championshipIds: [],
    championRivalId: null,
    completionReward: { reputation: 0, credits: 0 },
  },
  {
    id: 'division-5-crown-series',
    number: 5,
    name: 'Crown Series',
    intro: 'The final championship, the highest-ranked rival, and the career finale.',
    status: 'planned',
    requirementText: 'Not in this build. Its requirement is set when its events are built.',
    eventIds: [],
    championshipIds: [],
    championRivalId: null,
    completionReward: { reputation: 0, credits: 0 },
  },
];

export const MILESTONES: readonly MilestoneDefinition[] = [
  {
    id: 'milestone-first-event',
    title: 'First Result',
    description: 'Complete a career event.',
    requirement: { kind: 'career-events-completed', count: 1 },
    creditReward: 100,
  },
  {
    id: 'milestone-three-events',
    title: 'Three In',
    description: 'Complete three career events.',
    requirement: { kind: 'career-events-completed', count: 3 },
    creditReward: 300,
  },
  {
    id: 'milestone-two-rivals',
    title: 'Two Scalps',
    description: 'Defeat two rivals.',
    requirement: { kind: 'rivals-defeated', count: 2 },
    creditReward: 300,
  },
  {
    id: 'milestone-two-cars',
    title: 'Second Car',
    description: 'Own two vehicles in the garage.',
    requirement: { kind: 'vehicles-owned', count: 2 },
    creditReward: 250,
  },
  {
    id: 'milestone-reputation-200',
    title: 'Known Name',
    description: 'Reach 200 reputation.',
    requirement: { kind: 'reputation', min: 200 },
    creditReward: 200,
  },
  {
    id: 'milestone-shake-the-tail',
    title: 'Shake the Tail',
    description: 'Lose a police pursuit until the police give up.',
    requirement: { kind: 'pursuit-escapes', count: 1 },
    creditReward: 250,
  },
];

/** Lookups. Each returns null for an unknown id, so callers must handle the missing case. */
export function careerEventById(id: string): CareerEventDefinition | null {
  return CAREER_EVENTS.find((event) => event.id === id) ?? null;
}

export function careerEventForRace(raceEventId: string): CareerEventDefinition | null {
  return CAREER_EVENTS.find((event) => event.raceEventId === raceEventId) ?? null;
}

export function rivalById(id: string): RivalDefinition | null {
  return RIVALS.find((rival) => rival.id === id) ?? null;
}

export function milestoneById(id: string): MilestoneDefinition | null {
  return MILESTONES.find((milestone) => milestone.id === id) ?? null;
}

export function championshipById(id: string): ChampionshipDefinition | null {
  return CHAMPIONSHIPS.find((cup) => cup.id === id) ?? null;
}

export function divisionById(id: string): DivisionDefinition | null {
  return DIVISIONS.find((division) => division.id === id) ?? null;
}

/** The championship a career event belongs to, or null. An event is in at most one cup (validated). */
export function championshipForEvent(eventId: string): ChampionshipDefinition | null {
  return CHAMPIONSHIPS.find((cup) => cup.eventIds.includes(eventId)) ?? null;
}

/** The division an event belongs to, or null. An event is in at most one division (validated). */
export function divisionForEvent(eventId: string): DivisionDefinition | null {
  return DIVISIONS.find((division) => division.eventIds.includes(eventId)) ?? null;
}

export const CHAMPIONSHIP_IDS: ReadonlySet<string> = new Set(CHAMPIONSHIPS.map((cup) => cup.id));
export const DIVISION_IDS: ReadonlySet<string> = new Set(DIVISIONS.map((division) => division.id));

/**
 * The lead for the last completed open division that has one, or null. Shown in the hub once every open division is
 * complete. Text only: it changes no progress and unlocks nothing.
 */
export function completedDivisionLead(completedIds: readonly string[]): string | null {
  const done = DIVISIONS.filter((division) => division.status === 'open' && completedIds.includes(division.id) && division.lead);
  return done.length > 0 ? (done[done.length - 1]!.lead ?? null) : null;
}

/** Ids of the progression content, for normalization. Built once from the catalogue. */
export const CAREER_EVENT_IDS: ReadonlySet<string> = new Set(CAREER_EVENTS.map((event) => event.id));
export const RIVAL_IDS: ReadonlySet<string> = new Set(RIVALS.map((rival) => rival.id));
export const MILESTONE_IDS: ReadonlySet<string> = new Set(MILESTONES.map((milestone) => milestone.id));

export interface CareerReferenceContext {
  readonly vehicleIds: ReadonlySet<string>;
  readonly raceEventIds: ReadonlySet<string>;
}

/**
 * Checks the catalogue. Returns one line per problem, naming the ids involved. An empty list means valid. It does not
 * repair anything: a bad catalogue is a build error, and the tests fail on it.
 */
export function validateCareerCatalogue(
  ctx: CareerReferenceContext,
  data: {
    ranks: readonly RankDefinition[];
    events: readonly CareerEventDefinition[];
    rivals: readonly RivalDefinition[];
    milestones: readonly MilestoneDefinition[];
    championships?: readonly ChampionshipDefinition[];
    divisions?: readonly DivisionDefinition[];
  } = {
    ranks: CAREER_RANKS,
    events: CAREER_EVENTS,
    rivals: RIVALS,
    milestones: MILESTONES,
    championships: CHAMPIONSHIPS,
    divisions: DIVISIONS,
  },
): string[] {
  const championships = data.championships ?? CHAMPIONSHIPS;
  const divisions = data.divisions ?? DIVISIONS;
  const issues: string[] = [];
  const rivalIds = new Set(data.rivals.map((rival) => rival.id));
  const eventIds = new Set(data.events.map((event) => event.id));

  const unique = (label: string, ids: readonly string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push(`${label} id "${id}" is duplicated`);
      seen.add(id);
    }
  };
  unique('rank', data.ranks.map((rank) => rank.id));
  unique('event', data.events.map((event) => event.id));
  unique('rival', data.rivals.map((rival) => rival.id));
  unique('milestone', data.milestones.map((milestone) => milestone.id));

  // Ranks: count, ascending thresholds starting at 0, non-negative rewards.
  if (data.ranks.length === 0 || data.ranks.length > CAREER_MAX_RANKS) issues.push(`rank count ${data.ranks.length} is outside 1..${CAREER_MAX_RANKS}`);
  if (data.ranks[0] && data.ranks[0].minReputation !== 0) issues.push(`first rank "${data.ranks[0].id}" must start at 0 reputation`);
  data.ranks.forEach((rank, index) => {
    const previous = data.ranks[index - 1];
    if (previous && rank.minReputation <= previous.minReputation) issues.push(`rank "${rank.id}" must have a higher threshold than "${previous.id}"`);
    if (!(rank.creditReward >= 0) || !Number.isInteger(rank.creditReward)) issues.push(`rank "${rank.id}" credit reward must be a whole number, zero or more`);
  });

  // Rivals: unique ladder positions 1..N, challenge events exist and point back.
  const ladder = new Set<number>();
  for (const rival of data.rivals) {
    if (ladder.has(rival.ladderPosition)) issues.push(`rival "${rival.id}" repeats ladder position ${rival.ladderPosition}`);
    ladder.add(rival.ladderPosition);
    if (!ctx.vehicleIds.has(rival.vehicleId)) issues.push(`rival "${rival.id}" names unknown vehicle "${rival.vehicleId}"`);
    if (!(rival.defeatReward.reputation >= 0) || !(rival.defeatReward.credits >= 0)) issues.push(`rival "${rival.id}" reward must not be negative`);
    if (rival.challengeEventIds.length === 0) issues.push(`rival "${rival.id}" has no challenge event`);
    for (const eventId of rival.challengeEventIds) {
      const event = data.events.find((candidate) => candidate.id === eventId);
      if (!event) issues.push(`rival "${rival.id}" names unknown challenge event "${eventId}"`);
      else if (event.rivalId !== rival.id) issues.push(`challenge event "${eventId}" does not name rival "${rival.id}"`);
    }
  }
  for (let position = 1; position <= data.rivals.length; position += 1) {
    if (!ladder.has(position)) issues.push(`ladder position ${position} is missing: positions must be 1..${data.rivals.length}`);
  }

  // Events: race route exists, rival link is consistent, prerequisites refer to real ids, objectives are sane.
  for (const event of data.events) {
    if (!ctx.raceEventIds.has(event.raceEventId)) issues.push(`event "${event.id}" names unknown race "${event.raceEventId}"`);
    if (event.kind === 'rival') {
      if (event.rivalId === null || !rivalIds.has(event.rivalId)) issues.push(`rival event "${event.id}" names unknown rival "${String(event.rivalId)}"`);
      if (event.completion !== 'win') issues.push(`rival event "${event.id}" must be completed by a win`);
    } else if (event.rivalId !== null) {
      issues.push(`race event "${event.id}" must not name a rival`);
    }
    if (!(event.reputationReward >= 0) || !Number.isInteger(event.reputationReward)) issues.push(`event "${event.id}" reputation reward must be a whole number, zero or more`);
    if (event.objective && (!(event.objective.maxSeconds > 0) || !(event.objective.reputationReward >= 0))) {
      issues.push(`event "${event.id}" objective "${event.objective.id}" has invalid numbers`);
    }
    for (const prerequisite of event.prerequisites) {
      const problem = checkPrerequisiteIds(prerequisite, eventIds, rivalIds, ctx.vehicleIds);
      if (problem) issues.push(`event "${event.id}": ${problem}`);
    }
  }

  // Prerequisite cycles: an event that (directly or through others) needs itself can never unlock.
  const cycle = findPrerequisiteCycle(data.events);
  if (cycle) issues.push(`prerequisite cycle through event "${cycle}"`);

  // Format and kind must agree: a rival event has the 'rival' format, and no other event does.
  for (const event of data.events) {
    if ((event.kind === 'rival') !== (event.format === 'rival')) {
      issues.push(`event "${event.id}" has format "${event.format}" that does not match kind "${event.kind}"`);
    }
  }

  // Championships: unique ids, each event in at most one cup, events that exist and are races scored by place.
  unique2('championship', championships.map((cup) => cup.id), issues);
  const cupOwner = new Map<string, string>();
  for (const cup of championships) {
    if (cup.eventIds.length === 0) issues.push(`championship "${cup.id}" has no events`);
    for (const eventId of cup.eventIds) {
      const event = data.events.find((candidate) => candidate.id === eventId);
      if (!event) issues.push(`championship "${cup.id}" names unknown event "${eventId}"`);
      else if (event.kind === 'rival' || event.format === 'time-attack') {
        issues.push(`championship "${cup.id}" event "${eventId}" must be a race scored by place`);
      }
      const previous = cupOwner.get(eventId);
      if (previous !== undefined) issues.push(`event "${eventId}" is in two championships: "${previous}" and "${cup.id}"`);
      cupOwner.set(eventId, cup.id);
    }
    if (!isWholeNonNegative(cup.reward.reputation) || !isWholeNonNegative(cup.reward.credits)) {
      issues.push(`championship "${cup.id}" reward must be whole numbers, zero or more`);
    }
  }

  // Divisions: consecutive numbers, unique ids, known events and cups, open divisions have content, and each event in
  // at most one division.
  unique2('division', divisions.map((division) => division.id), issues);
  divisions.forEach((division, index) => {
    if (division.number !== index + 1) issues.push(`division "${division.id}" must be number ${index + 1}`);
    if (division.status !== 'open' && division.status !== 'planned') issues.push(`division "${division.id}" has an unknown status`);
    if (division.status === 'open' && division.eventIds.length === 0) issues.push(`open division "${division.id}" has no events`);
    if (division.status === 'planned' && (division.eventIds.length > 0 || division.championshipIds.length > 0)) {
      issues.push(`planned division "${division.id}" must not have events or championships`);
    }
    for (const eventId of division.eventIds) {
      if (!eventIds.has(eventId)) issues.push(`division "${division.id}" names unknown event "${eventId}"`);
    }
    for (const cupId of division.championshipIds) {
      if (!championships.some((cup) => cup.id === cupId)) issues.push(`division "${division.id}" names unknown championship "${cupId}"`);
    }
    if (division.championRivalId !== null && !rivalIds.has(division.championRivalId)) {
      issues.push(`division "${division.id}" names unknown champion rival "${division.championRivalId}"`);
    }
    if (!isWholeNonNegative(division.completionReward.reputation) || !isWholeNonNegative(division.completionReward.credits)) {
      issues.push(`division "${division.id}" reward must be whole numbers, zero or more`);
    }
  });
  const divisionOwner = new Map<string, string>();
  for (const division of divisions) {
    for (const eventId of division.eventIds) {
      const previous = divisionOwner.get(eventId);
      if (previous !== undefined) issues.push(`event "${eventId}" is in two divisions: "${previous}" and "${division.id}"`);
      divisionOwner.set(eventId, division.id);
    }
  }

  // Milestones: positive counts and thresholds, non-negative rewards.
  for (const milestone of data.milestones) {
    const req = milestone.requirement;
    const value = req.kind === 'reputation' ? req.min : req.count;
    if (!(value > 0)) issues.push(`milestone "${milestone.id}" needs a positive threshold`);
    if (!(milestone.creditReward >= 0) || !Number.isInteger(milestone.creditReward)) issues.push(`milestone "${milestone.id}" reward must be a whole number, zero or more`);
  }

  return issues;
}

/** Reports duplicate ids in a catalogue list. */
function unique2(label: string, ids: readonly string[], issues: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issues.push(`${label} id "${id}" is duplicated`);
    seen.add(id);
  }
}

function isWholeNonNegative(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function checkPrerequisiteIds(
  prerequisite: Prerequisite,
  eventIds: ReadonlySet<string>,
  rivalIds: ReadonlySet<string>,
  vehicleIds: ReadonlySet<string>,
): string | null {
  switch (prerequisite.kind) {
    case 'reputation':
      return prerequisite.min >= 0 ? null : `reputation requirement ${prerequisite.min} is negative`;
    case 'event-completed':
      return eventIds.has(prerequisite.eventId) ? null : `needs unknown event "${prerequisite.eventId}"`;
    case 'rival-defeated':
      return rivalIds.has(prerequisite.rivalId) ? null : `needs unknown rival "${prerequisite.rivalId}"`;
    case 'vehicle-owned':
      return vehicleIds.has(prerequisite.vehicleId) ? null : `needs unknown vehicle "${prerequisite.vehicleId}"`;
    default: {
      const unhandled: never = prerequisite;
      return `unhandled prerequisite ${JSON.stringify(unhandled)}`;
    }
  }
}

/** Returns an event id that lies on a cycle of event-completed prerequisites, or null. Depth-first search. */
function findPrerequisiteCycle(events: readonly CareerEventDefinition[]): string | null {
  const edges = new Map<string, string[]>();
  for (const event of events) {
    edges.set(
      event.id,
      event.prerequisites.flatMap((prerequisite) => (prerequisite.kind === 'event-completed' ? [prerequisite.eventId] : [])),
    );
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): string | null => {
    const mark = state.get(id);
    if (mark === 'done') return null;
    if (mark === 'visiting') return id;
    state.set(id, 'visiting');
    for (const next of edges.get(id) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    state.set(id, 'done');
    return null;
  };
  for (const id of edges.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}
