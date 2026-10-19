/*
 * World streaming tuning (open-world phase). Every streaming number lives here. Units: metres, metres per second,
 * seconds. Defaults are conservative. They are not profiled values: the phase report says what was measured.
 */
export const WORLD_STREAMING_CONFIG = {
  /**
   * Streams the city in chunks. False renders the whole city at once, which is the pre-streaming path and the fallback
   * while the streamed path is unverified in the browser.
   */
  enabled: true,
  /** Chunk edge length. Chunks are square and aligned to the origin, so chunk (kx, kz) starts at (400 kx, 400 kz). */
  chunkSizeMeters: 400,
  /** Chunks within this distance of the player are wanted, at rest. */
  loadRadiusMeters: 520,
  /** Extra load radius per second of travel at the current speed. Looks ahead to roads the car will reach soon. */
  speedLookaheadSeconds: 8,
  /** Upper limit on the load radius at high speed. */
  maxLoadRadiusMeters: 1000,
  /** Hysteresis. A loaded chunk is kept until it is this much farther than the load radius. */
  keepMarginMeters: 180,
  /** Chunks within this distance have full detail (roads and scenery). Farther chunks keep roads only. */
  sceneryRadiusMeters: 460,
  /** Hysteresis on the scenery radius, so a chunk does not flip detail at the edge. */
  sceneryMarginMeters: 80,
  /** Hard cap on chunks that are loaded or loading at once. Chunks beyond it wait in the queue. */
  maxActiveChunks: 40,
  /** Chunks that may be in the LOADING state at once. */
  maxConcurrentLoads: 2,
  /** Chunks that may start loading in one update. */
  maxStartsPerUpdate: 2,
  /** Starts allowed in the update after a teleport, so the area around the new position fills quickly. */
  teleportStartsPerUpdate: 6,
  /** Priority bias toward the direction of travel. 0 is distance only. Chunks ahead of the car get lower priority. */
  forwardPriorityBias: 0.6,
  /** A jump in position larger than this, between two updates, counts as a teleport. */
  teleportDistanceMeters: 150,
  /** Times a failed chunk is retried before it is left in FAILED. */
  maxRetries: 2,
  /**
   * Cell size of the boundary bucket grid (roadBoundary.ts). Queries scan rings of cells until no unscanned shape can be
   * nearer, so the answer is the same as a linear scan, at a cost that does not grow with the whole map.
   */
  boundaryIndexCellMeters: 50,
  /**
   * Gap probe (Stage C). The strip ahead of the car that must be built. A gap is a chunk on this strip that is not active.
   * The probe is for diagnostics and tests. It does not change what loads.
   */
  gapLookaheadMeters: 80,
  gapLateralMeters: 15,
  gapStepMeters: 20,
} as const;

export type WorldStreamingConfig = typeof WORLD_STREAMING_CONFIG;
