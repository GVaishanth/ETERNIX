import { NETWORK_BOUNDARY_HALF_WIDTH_METERS } from './roadConfig';

/*
 * Race tuning (Part 6). Seconds and metres. Every race number lives here, and nothing else in the race code uses a literal.
 */

export const RACE_CONFIG = {
  /** Entering this distance of an event marker opens its approach card. */
  approachRadiusMeters: 18,
  /** Leaving this distance closes the card, and re-arms a dismissed marker. Larger than the entry radius (hysteresis). */
  exitRadiusMeters: 30,
  /** Each countdown number (3, 2, 1) lasts this long. GO starts the race. */
  countdownStepSeconds: 1,
  /** GO stays on screen this long after the race starts. Display only. */
  goDisplaySeconds: 1,
  /**
   * Checkpoint and finish gates span this half width across the road centre. It equals the drivable boundary (road plus
   * shoulders), so every position a car can reach crosses the gate. A narrower gate let a car pressed to the outer edge
   * pass a line without registering it, silently (J3).
   */
  gateHalfWidthMeters: NETWORK_BOUNDARY_HALF_WIDTH_METERS,
  /** Distance along the route between grid rows. Row 0 sits on the start anchor, each later row is this far back. */
  gridRowSpacingMeters: 12,
  /** How long a notification stays on the HUD. */
  notificationSeconds: 2.5,
  /** Standings are recomputed every this many fixed steps (6 steps = 10 Hz at 60 Hz). */
  standingsIntervalSteps: 6,
  /** Nearest-point search on a route polyline is limited to this window around the last known position. */
  progressWindowMeters: 60,
  /** When no polyline point is this close, the racer is off the route and its leg progress holds its last value. */
  progressLostMeters: 25,
  /** A centre-point move larger than this in one fixed step is a relocation (recovery, DEV reset), not driving. */
  maxStepDisplacementMeters: 8,
  /**
   * Reward multiplier by final place, 1st to 6th. A place past the list uses the last value. Places 5 and 6 pay nothing:
   * only the top four are paid, so the larger field does not add credits for the back of the pack.
   */
  placeRewardMultiplier: [1, 0.6, 0.35, 0.2, 0, 0] as readonly number[],
  /**
   * Pace by the grid place a rival starts in (1 = front, last = RACE_MIN_RACERS). The rival's speed cap is its event
   * pace (opponentTopSpeedMps times the difficulty factor) times this factor, set once at the start. The cars behind
   * the player are the faster ones, so a player who starts 7th of 10 is chased, and the cars ahead are the ones to
   * pass. A place past the list uses the last value.
   */
  placePaceFactor: [0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 1, 1.03, 1.06, 1.08] as readonly number[],
  /**
   * Race rivals drive at this multiple of their pace. It applies to race rivals during a race only. Traffic and the
   * player are not affected.
   */
  aiSpeedMultiplier: 2.5,
  /** A route anchor must be at least this far from either end of its lane (keeps gates off the junction pads). */
  anchorEdgeClearanceMeters: 5,
  /** A roadside marker must stand at least this far from the road centre (outside the drivable boundary). */
  markerMinSideOffsetMeters: 10.5,
  /**
   * Overtaking. A rival held up by a rival ahead on its own lane, closer than `gapMeters`, may change to the neighbouring
   * lane (the other lane index of the same road). It does so only when that lane is clear: no rival and not the player
   * within `clearAheadMeters` ahead or `clearBehindMeters` behind the rival's place. A rival waits `cooldownSeconds`
   * between changes.
   */
  overtake: {
    gapMeters: 25,
    clearAheadMeters: 25,
    clearBehindMeters: 8,
    playerClearanceMeters: 4,
    cooldownSeconds: 4,
  },
} as const;

/**
 * Racers in every race, including the player. Every race has exactly this many cars. A race with a different count is
 * not valid.
 */
export const RACE_MIN_RACERS = 10;

/** Lanes the starting grid uses: both forward lanes of the race's road, side by side. */
export const RACE_GRID_LANES = 2;

/** The player's place on the grid, 1-based. The player starts 7th, with the faster rivals behind. */
export const RACE_PLAYER_GRID_POSITION = 7;

/**
 * Maximum opponents in any race. Sizes the opponent visual pool, so it never grows during play. It is the field minus
 * the player, so every race has exactly this many rivals.
 */
export const RACE_OPPONENT_CAPACITY = RACE_MIN_RACERS - 1;

/**
 * Opponent difficulty. The opponent's target speed is the event's opponent top speed times this factor. Lower factors
 * leave the player more room to win. Nothing else differs between levels: the same AI and the same vehicle model.
 */
export const RACE_DIFFICULTY_SPEED_FACTOR: Readonly<Record<1 | 2 | 3, number>> = {
  1: 0.8,
  2: 0.9,
  3: 1,
};
