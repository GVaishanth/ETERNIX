/**
 * Central traffic tuning (Part 4). Every traffic number lives here. Components and traffic modules must not hardcode them.
 *
 * Units: SI throughout. Meters, seconds, m/s, m/s^2.
 * Traffic is lane-locked and path-based: each vehicle moves along its lane path, and the Intelligent Driver Model (IDM)
 * sets its speed. Opponent AI is different: it drives the shared vehicle model through control inputs (see src/ai).
 */
export const TRAFFIC_CONFIG = {
  /** Fixed number of vehicle slots. Vehicles are recycled into these slots; the count never grows. */
  poolCapacity: 12,
  /** Vehicles farther than this (straight-line, meters) from the player are recycled. */
  activeRadiusMeters: 330,
  /** How far along the lane graph a vehicle looks for a leader, meters. */
  leaderLookaheadMeters: 160,
  /** Largest heading change a traffic vehicle may make per second when following its path, rad/s. */
  headingRateLimitRadPerSecond: 2.5,
  /** Distance between sample points on connector lanes, meters. Segment lanes reuse the centerline samples. */
  connectorSampleSpacingMeters: 1,
  /** Lane centre offset from the centerline, as a fraction of the lane width: 0.5 is the centre of the lane. */
  laneCentreFraction: 0.5,

  spawn: {
    /** Smallest longitudinal gap, meters, in front of the player when the player is faster than the traffic. */
    baseAheadGapMeters: 90,
    /** Reaction time the player must have at closing speed before a vehicle can appear ahead, seconds. */
    reactionSeconds: 2.5,
    /** Smallest gap behind the player, meters. */
    behindGapMeters: 45,
    /** Range of the forward view cone used to keep spawns out of the visible area, meters. */
    viewConeRangeMeters: 220,
    /** Half-angle of the forward view cone, degrees. Based on the player heading, not a fixed world direction. */
    viewConeHalfAngleDegrees: 55,
    /** Minimum clearance from the drivable boundary for every footprint corner, meters. */
    boundaryClearanceMeters: 0.3,
    /** Extra margin added to the footprints when checking for overlaps, meters. */
    overlapMarginMeters: 2,
    /** A junction is occupied while any vehicle is within its footprint plus this clearance, meters. */
    junctionClearanceMeters: 12,
    /** Half width of the lane corridor around the player. Gap rules apply only inside it, not to far-away side traffic. */
    corridorHalfWidthMeters: 9,
    /** Time between spawn retries for pending requests, seconds. Rejected requests wait instead of forcing a spawn. */
    retryIntervalSeconds: 0.5,
  },

  /**
   * Ambient traffic (Part 5). A seeded generator keeps the population near a target, placing new requests on lanes
   * 120 to 300 m from the player, outside its forward view where possible. Every request still goes through the normal
   * validated spawn, so a request that is unsafe is postponed, and after maxAttempts it is dropped and counted.
   */
  ambient: {
    /** Vehicles the generator tries to keep in the active radius, including scenario vehicles. */
    targetCount: 8,
    /** Time between generator decisions, seconds. */
    intervalSeconds: 2,
    minDistanceMeters: 120,
    maxDistanceMeters: 300,
    /** Lane candidates tried per decision. Bounded, so one decision costs a fixed amount of work. */
    candidatesPerDecision: 24,
    /** A request still rejected after this many spawn attempts is dropped. */
    maxAttempts: 20,
    /** Candidates whose forward component toward the player's heading exceeds this are skipped (outside the forward view). */
    maxForwardCosine: 0.2,
  },

  /** Following distance and acceleration when traffic is not specified by a type. */
  idm: {
    /** Exponent of the free-road term. Standard IDM value. */
    exponent: 4,
    /** Emergency deceleration limit, m/s^2. Applied when a leader closes faster than the comfortable limit. */
    emergencyDecelMps2: 9,
  },

  /** Obstacle response: how traffic reacts to the player's car, which is not on the traffic lanes. */
  obstacle: {
    /** Half width of the corridor around a lane in which the player counts as a leader, meters. */
    corridorHalfWidthMeters: 2.2,
    /** Speed below which a vehicle counts as stopped for the stall timer, m/s. */
    stoppedSpeedMps: 0.3,
    /** Time a traffic vehicle may stay stopped before it is recycled. Stops permanent queues, seconds. */
    stallRecycleSeconds: 20,
  },

  collision: {
    /** Largest push-out the player can receive in one fixed step, meters. Larger overlaps resolve over several steps. */
    maxPlayerPushPerStepMeters: 0.5,
    /** Gap left after a traffic-traffic correction, meters. Without it a correction lands exactly on contact. */
    separationMarginMeters: 0.05,
    /** Cell size of the spatial hash used for broad-phase checks, meters. */
    hashCellMeters: 8,
    /** Search radius for broad-phase candidates, meters. Larger than any pair of footprints can reach. */
    pairSearchRadiusMeters: 7,
    /** Event log size, events. Older events are dropped. */
    eventLogCapacity: 50,
  },
} as const;

export type TrafficConfig = typeof TRAFFIC_CONFIG;
