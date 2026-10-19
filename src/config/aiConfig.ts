/**
 * Opponent AI tuning (Part 4). Every AI number lives here. The controller produces the same input fields as the player
 * (steer, throttle, brake). It does not do racing, overtaking, rubber-banding, or police behaviour.
 * Units: SI. Meters, seconds, m/s, m/s^2.
 */
export const AI_CONFIG = {
  /** Look-ahead distance for pure pursuit: base plus a speed term, meters. */
  lookaheadBaseMeters: 4,
  lookaheadPerSpeedSeconds: 0.45,
  /** Lateral acceleration the AI allows itself in a curve, m/s^2. Sets the curve speed. */
  curveLateralAccelMps2: 3.2,
  /** Distance ahead on the route to check for curvature and obstacles, meters. */
  sensingDistanceMeters: 45,
  /** Arc length over which curvature is measured along the route, meters. */
  curvatureArcMeters: 4,
  /** Lateral half width of the obstacle corridor on the route, meters. */
  obstacleCorridorHalfWidthMeters: 2.0,
  /** Gap at which the AI stops for an obstacle, meters, measured from its nose. */
  stopGapMeters: 6,
  /** Comfortable deceleration used to plan braking for an obstacle, m/s^2. */
  obstacleBrakeMps2: 3,
  /** Lateral error at which the AI slows to recover, and the error at which it gives up and stops, meters. */
  recoverLateralMeters: 1.2,
  lostLateralMeters: 4,
  /** Speed while lost, m/s. Low enough to re-acquire the route, not a permanent stop. */
  lostCrawlMps: 3,
  /** Speed controller gains. Throttle and brake are 0..1. */
  throttleGainPerMps: 0.25,
  brakeGainPerMps: 0.4,
  /** Throttle that holds a steady speed on the flat road, 0..1. */
  holdThrottle: 0.3,
  /** Start-up and speed-hold deadband, m/s. Stops the controller chattering between throttle and brake. */
  speedDeadbandMps: 0.3,
  /**
   * A race opponent (not recyclable) stopped behind an obstacle for this long ignores obstacles for the release window.
   * The queue clears by driving on, not by teleporting. Race opponents must not stay parked on the route.
   */
  raceReleaseStallSeconds: 6,
  raceReleaseWindowSeconds: 4,
  /**
   * An opponent stopped for this long is recycled to its spawn, as traffic is after its stall time. The spawn must be
   * clear of other cars and at least this far from the player. If it is not clear, the recycle waits and retries.
   */
  recycleClearanceMeters: 60,
} as const;

export type AiConfig = typeof AI_CONFIG;
