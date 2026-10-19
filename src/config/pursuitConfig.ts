/**
 * Police pursuit tuning (Part 7). Every pursuit number lives here. Units: SI. Meters, seconds, m/s.
 *
 * The rules these numbers feed are documented in PROJECT_CONTEXT.md section 20. Changing a value here changes behaviour
 * only, never the structure: states, transitions, and the unit pool are fixed in code.
 */

/** One pursuit heat level. Levels are data: a stronger response is more units, a higher cap, and a longer search. */
export interface PursuitHeatLevelConfig {
  /** Level number, 1..5, shown to the player. */
  level: number;
  /** Heat at which this level begins. Level 1 starts at 0. */
  heatThreshold: number;
  /** Most pursuing units at this level (chase and intercept). Never above the unit pool size. */
  maxUnits: number;
  /** Speed cap for pursuing units at this level, m/s. Kept below typical player speed, so escape is possible. */
  speedCapMps: number;
  /** Seconds between deploying one more unit while more are wanted. */
  deployIntervalSeconds: number;
  /** Seconds a search lasts after sight is lost, before the search is called off into cooldown. */
  searchSeconds: number;
}

export const PURSUIT_CONFIG = {
  /** Police units in the pool. A fixed size: units are reused, never created during play. */
  unitPoolSize: 4,
  /** Patrol units that drive the city from the start. They are the units that witness offences. */
  patrolUnits: 2,
  /** Patrols are placed this far (route distance, meters) from the player's start at the start of a session. */
  patrolSpawnMinMeters: 150,
  patrolSpawnMaxMeters: 320,

  /** Sight: a unit sees the player inside this radius and cone (half angle from the unit's heading). No occlusion. */
  sight: {
    radiusMeters: 70,
    halfAngleDegrees: 65,
  },

  /** Offence triggers, from the built-in detectors. */
  trigger: {
    /** Speeding: the player must be over the lane limit by this factor, for `speedingSeconds`, in view of a patrol. */
    speedingFactor: 1.4,
    speedingSeconds: 2,
    /** A player collision with traffic, witnessed by a patrol in view, is an offence. */
    collisionWitnessed: true,
    /** How often the player's lane is looked up for the speeding rule, seconds. Bounded, not every step. */
    laneLookupSeconds: 0.25,
  },

  /** Detection: a witnessing unit must keep the player in view for this long before a response starts. */
  detectionSeconds: 1.5,
  /** Initiation: the primary unit is assigned and drives toward the player, for this long, before the pursuit runs. */
  initiationSeconds: 2,

  /** Lost sight: time with no unit seeing the player before the pursuit moves to searching. */
  lostSightSeconds: 2,
  /** Escape: time out of sight, AND distance to the nearest pursuing unit, both required to start cooldown. */
  escape: {
    outOfSightSeconds: 5,
    separationMeters: 140,
  },
  /** Cooldown: after escape, the pursuit cools down for this long. Any sight during it reacquires the pursuit. */
  cooldownSeconds: 8,

  /** Heat: a session's heat. Resets to 0 when the session ends. It is pursuit intensity only, not progression. */
  heat: {
    maxHeat: 100,
    /** Added once when a session starts (detection). */
    detectionPoints: 10,
    /** Added per second while the pursuit is running (PURSUING, ESCALATING, or SEARCHING). */
    pursuitPerSecond: 1,
    /** Added for a further witnessed offence during a session. Rate limited by eventMinIntervalSeconds. */
    repeatOffencePoints: 5,
    eventMinIntervalSeconds: 4,
    /** Removed per second, only in COOLDOWN. Heat never drops at once, for example on a corner. */
    cooldownDecayPerSecond: 4,
  },

  /** Heat levels, in order. Five levels. Thresholds must rise. Validated by the tests. */
  heatLevels: [
    { level: 1, heatThreshold: 0, maxUnits: 1, speedCapMps: 26, deployIntervalSeconds: 0, searchSeconds: 14 },
    { level: 2, heatThreshold: 20, maxUnits: 2, speedCapMps: 29, deployIntervalSeconds: 6, searchSeconds: 16 },
    { level: 3, heatThreshold: 40, maxUnits: 2, speedCapMps: 32, deployIntervalSeconds: 6, searchSeconds: 18 },
    { level: 4, heatThreshold: 65, maxUnits: 3, speedCapMps: 36, deployIntervalSeconds: 5, searchSeconds: 20 },
    { level: 5, heatThreshold: 85, maxUnits: 4, speedCapMps: 40, deployIntervalSeconds: 5, searchSeconds: 24 },
  ] as readonly PursuitHeatLevelConfig[],

  /** Routing. Police follow the road graph. Replanning is bounded: on a timer, or when the target moves far. */
  routing: {
    replanSeconds: 2,
    /** The chase target is replanned when the player has moved this far from the last planned target, meters. */
    replanTargetMoveMeters: 25,
    /** Intercept units aim this far ahead of the player along the player's lane chain, meters. */
    interceptAheadMeters: 180,
    /** A police route pays this many extra meters to change lane. Keeps routes on one lane unless a change saves more. */
    laneChangeCostMeters: 30,
    /**
     * Chase units aim this far behind the player's centre, so they come up on the tail and tag it, instead of driving
     * at the centre and being pushed aside. Meters.
     */
    chaseBehindMeters: 2,
    /** Lane heading must agree with the unit's heading within this angle to count as its lane, degrees. */
    laneHeadingToleranceDegrees: 60,
    /** Maximum lateral distance from a lane for a lane to be considered at all, meters. */
    laneSearchMaxMeters: 12,
  },

  /** Deployment: where a new unit appears. Never ahead of the player, never overlapping a body. */
  deploy: {
    minDistanceMeters: 80,
    maxDistanceMeters: 170,
    /** Idealised distance to prefer among valid candidates, meters. */
    preferredDistanceMeters: 120,
    /** Candidates within this half angle ahead of the player's heading are never used. Degrees. */
    forbiddenAheadDegrees: 45,
    /** Candidates outside this half angle are preferred (they are out of view). Degrees. */
    preferredOutOfViewDegrees: 70,
    /** Clearance kept between a deployed unit and any other body, meters. */
    clearanceMeters: 6,
    /** Spacing of candidate points along a lane, meters. */
    sampleStepMeters: 5,
    /** How often a postponed deployment is retried, seconds. */
    retrySeconds: 0.5,
  },

  /** Stuck handling: a unit that stops making progress is replanned, then removed. A pursuit never waits on it. */
  stuck: {
    speedMps: 0.5,
    replanAfterSeconds: 6,
    removeAfterSeconds: 12,
    /** With no active pursuing unit for this long, the pursuit moves to cooldown. */
    noUnitSeconds: 10,
  },

  /**
   * Capture (BUSTED). A pursuing unit in contact range while the player is nearly stopped. When the pursuit ends busted,
   * the car goes back to the spawn (as R does), the police return to patrol, and the player loses a share of their
   * credits.
   */
  /**
   * A ram: a pursuing unit that touches the player locks the player's driving input (no throttle, steering, or brake
   * release) and the car brakes to a stop. The lockout is 1.5 s. It does not end the capture. Seconds.
   *
   * Cooldown: after a lockout starts, further rams are ignored for lockoutSeconds + cooldownSeconds. A unit that stays in
   * contact with a stopped car therefore cannot hold the player's input locked forever. The player always gets free
   * driving time between locks.
   */
  ram: {
    lockoutSeconds: 1.5,
    cooldownSeconds: 4,
  },

  capture: {
    rangeMeters: 7,
    playerSpeedMaxMps: 3,
    holdSeconds: 2.5,
    /** How long BUSTED is shown before the session ends, and the reset and fine happen, seconds. */
    bustedShowSeconds: 3,
    /** Share of the player's credits lost when busted, percent. Rounded to whole credits. */
    bustFinePercent: 40,
  },

  /**
   * How pursuing units drive. Normal AI cars keep the traffic rules: they stop behind traffic, corner at the traffic
   * curve limit, and crawl or ease off when they lose the line. Pursuing units do not keep those rules. Contacts still
   * push bodies apart, so nothing passes through a car. Patrols keep the traffic rules.
   */
  drive: {
    /** A pursuing unit ignores obstacles on its route (traffic and other units), not only the player. */
    respectObstacles: false,
    /** Lateral acceleration a pursuing unit takes corners at, m/s^2. Traffic uses AI_CONFIG (3.2). */
    curveLateralAccelMps2: 5,
    /** A pursuing unit keeps its speed when it loses the line, instead of crawling. */
    easeWhenLost: false,
  },

  /** Notices stay on the HUD for this long, seconds. */
  noticeSeconds: 3,

  /** Unit tuning. Police use the shared vehicle model, so these are only AI choices. */
  unit: {
    /** Patrols drive at the lane limit, as traffic does. Pursuing units never go below this cap, m/s. */
    minCapMps: 10,
    /** Spawn speed of a deployed unit, m/s. */
    deploySpeedMps: 8,
    /**
     * Pursuing units drive at this multiple of the heat level's speed cap. It applies to pursuing units only: patrols
     * and traffic keep their normal speeds, and the cap is only set on a unit that is in a pursuit.
     */
    pursuitSpeedMultiplier: 2.5,
  },
} as const;

export type PursuitConfig = typeof PURSUIT_CONFIG;
