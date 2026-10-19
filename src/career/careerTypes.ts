/*
 * Career definitions (Part 9). Immutable data types only. Nothing here is player progress. Progress lives in
 * CareerState (careerModel.ts), keyed by these stable ids. Display names are never used as keys.
 */
/**
 * One condition an event or rival needs. An event lists its conditions; all of them must hold (AND). Combinations
 * are a list, not nested logic, so the evaluator stays flat.
 */
export type Prerequisite =
  | { readonly kind: 'reputation'; readonly min: number }
  | { readonly kind: 'event-completed'; readonly eventId: string }
  | { readonly kind: 'rival-defeated'; readonly rivalId: string }
  | { readonly kind: 'vehicle-owned'; readonly vehicleId: string };

/** How an event is completed. 'finish' needs any finish; 'win' needs first place. */
export type CompletionRule = 'finish' | 'win';

/**
 * An optional objective. It is met by a finish within `maxSeconds`. It pays `reputationReward` once, the first time it
 * is met. It never blocks progression: nothing requires it.
 */
export interface CareerObjective {
  readonly id: string;
  readonly label: string;
  readonly maxSeconds: number;
  readonly reputationReward: number;
}

export type CareerEventKind = 'race' | 'rival';

/**
 * The format of a career event. Presentation and rules for the hub; the race engine runs it through the base route
 * and the event's options. 'checkpoint' is a sprint with a time limit. 'time-attack' is a solo sprint with a best time.
 */
export type CareerEventFormat = 'sprint' | 'circuit' | 'checkpoint' | 'time-attack' | 'rival';

export interface CareerEventDefinition {
  /** Stable id. Saved in the career progress. */
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly kind: CareerEventKind;
  /** Plain-language place name for the player, shown with the marker. Not an id. */
  readonly areaLabel: string;
  /** The race route this event runs. Must be a RaceEventDefinition id in careerRaces.ts. */
  readonly raceEventId: string;
  /** Rival events name the rival who is challenged. Race events have null. */
  readonly rivalId: string | null;
  readonly format: CareerEventFormat;
  readonly completion: CompletionRule;
  /** Reputation paid the first time the event is completed. Replays pay none (see replay policy). */
  readonly reputationReward: number;
  readonly prerequisites: readonly Prerequisite[];
  readonly objective: CareerObjective | null;
}

export interface RivalDefinition {
  /** Stable id. */
  readonly id: string;
  readonly name: string;
  /** 1 is the top of the ladder, the strongest rival. Positions are unique. */
  readonly ladderPosition: number;
  readonly biography: string;
  /** Presentation text. It describes the intended pace. The AI has no separate style parameters. */
  readonly drivingStyle: string;
  readonly preferredEventType: 'sprint' | 'circuit';
  /** A vehicle from the catalogue, named on the leaderboard. Presentation only: the rival drives the shared AI. */
  readonly vehicleId: string;
  readonly challengeEventIds: readonly string[];
  /** Paid once, on the first defeat. Reputation and credits both go through the progression service. */
  readonly defeatReward: { readonly reputation: number; readonly credits: number };
}

/**
 * A championship: a fixed set of events scored by place. The cup is complete when every event has a finish recorded.
 * Points come from CAREER_CONFIG.championshipPointsByPlace. The reward is paid once, on completion.
 */
export interface ChampionshipDefinition {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly eventIds: readonly string[];
  readonly reward: { readonly reputation: number; readonly credits: number };
}

export type DivisionStatus = 'open' | 'planned';

/**
 * A progression division. Divisions are categories of the one campaign, not separate modes. A 'planned' division has
 * no events in this build: it is shown with its intro and requirement, and it cannot be entered.
 */
export interface DivisionDefinition {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly intro: string;
  readonly status: DivisionStatus;
  /** Plain-language requirement, shown before the player commits. Text only; the checks live in the event prerequisites. */
  readonly requirementText: string;
  readonly eventIds: readonly string[];
  readonly championshipIds: readonly string[];
  /** The rival who closes the division, or null. Must be defeated for the division to complete. */
  readonly championRivalId: string | null;
  readonly completionReward: { readonly reputation: number; readonly credits: number };
  /** Text only. Shown in the career hub once this division is complete, as a hook into the next one. Optional. */
  readonly lead?: string;
  /**
   * When true, the division's races leave the map and the world once the division is complete. Optional, default off.
   * Division 1 sets it. Completed events stay completed, so later divisions do not depend on the removed races.
   */
  readonly retireRacesOnComplete?: boolean;
}

export interface RankDefinition {
  readonly id: string;
  readonly name: string;
  /** Reputation needed to reach this rank. The first rank is 0. */
  readonly minReputation: number;
  /** Credits paid once when the rank is first reached. */
  readonly creditReward: number;
}

export type MilestoneRequirement =
  | { readonly kind: 'career-events-completed'; readonly count: number }
  | { readonly kind: 'rivals-defeated'; readonly count: number }
  | { readonly kind: 'reputation'; readonly min: number }
  | { readonly kind: 'vehicles-owned'; readonly count: number }
  | { readonly kind: 'pursuit-escapes'; readonly count: number };

export interface MilestoneDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirement: MilestoneRequirement;
  /** Credits paid once. Milestones pay credits only, so a milestone cannot start a chain of other rewards. */
  readonly creditReward: number;
}

