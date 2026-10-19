/*
 * Shared pursuit types (Part 7). Pure data. No Three.js and no React.
 */

/**
 * The pursuit states. One session at a time. INACTIVE is the only state with no session. BUSTED is the capture state:
 * it is shown briefly, then the session ends.
 */
export type PursuitState =
  | 'INACTIVE'
  | 'DETECTION'
  | 'INITIATING'
  | 'PURSUING'
  | 'ESCALATING'
  | 'SEARCHING'
  | 'COOLDOWN'
  | 'BUSTED';

/** What a unit is doing. Roles are derived from the session state each step, by the controller. */
export type UnitRole = 'patrol' | 'chase' | 'intercept' | 'search';

/**
 * An offence that starts or feeds a pursuit. The built-in detectors report these. Later systems can report the same
 * kinds through the trigger interface. Adding a kind here is a code change, by design.
 */
export type OffenceKind = 'speeding' | 'collision';

/** Why a session ended. Set once, when the session returns to INACTIVE. */
export type PursuitEndReason = 'cooldown' | 'busted' | 'aborted-reset' | 'cancelled' | 'no-units';

/** What the HUD and the DEV diagnostics read. Plain values, copied from the session each publish. */
export interface PursuitSnapshot {
  state: PursuitState;
  /** Heat level, 1..5. Meaningful while a session exists. */
  level: number;
  heat: number;
  maxHeat: number;
  /** Units taking part in the pursuit (chase, intercept, or search). */
  pursuingUnits: number;
  /** Units driving the city on patrol. */
  patrolUnits: number;
  /** Units in the pool that are not active. */
  idleUnits: number;
  poolSize: number;
  /** Seconds since the session's detection started, or 0 with no session. */
  detectionAgeSeconds: number;
  /** Seconds with no unit seeing the player, during a session. */
  lostSightSeconds: number;
  /** Escape progress, 0..1: out-of-sight time and separation, both required. */
  escapeProgress: number;
  /** Seconds left of the search, and of the cooldown. Zero outside those states. */
  searchSecondsLeft: number;
  cooldownSecondsLeft: number;
  /** Last known position of the player, or null. */
  lastKnown: { x: number; z: number } | null;
  /** Capture progress, 0..1. */
  captureProgress: number;
  /** The reason the last session ended, or null. */
  lastEndReason: PursuitEndReason | null;
  /** Number of sessions that have started since the game started. Diagnostics only. */
  sessionsStarted: number;
  /** The newest notice, shown for a short time, or null. Every notice comes from a state change. */
  notice: { text: string; id: number } | null;
}

export const EMPTY_PURSUIT_SNAPSHOT: PursuitSnapshot = {
  state: 'INACTIVE',
  level: 1,
  heat: 0,
  maxHeat: 100,
  pursuingUnits: 0,
  patrolUnits: 0,
  idleUnits: 0,
  poolSize: 0,
  detectionAgeSeconds: 0,
  lostSightSeconds: 0,
  escapeProgress: 0,
  searchSecondsLeft: 0,
  cooldownSecondsLeft: 0,
  lastKnown: null,
  captureProgress: 0,
  lastEndReason: null,
  sessionsStarted: 0,
  notice: null,
};
