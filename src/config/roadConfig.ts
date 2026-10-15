/**
 * Road network tuning (Part 3). Meters, seconds, and m/s. Every value that shapes the road, its markings,
 * its boundaries, or the test circuit lives here, so a change is made once.
 *
 * The legacy single straight road keeps its own values in worldConfig.ts. It is preserved as a reference asset.
 */
export const ROAD_NETWORK_CONFIG = {
  /** Two-way road: this many lanes in each direction. Traffic keeps to the right of the centerline. */
  lanesPerDirection: 2,
  laneWidthMeters: 3.6,
  shoulderWidthMeters: 3,

  /** Painted marking widths and placement. Offsets are measured from the road centerline. */
  lineWidthMeters: 0.15,
  edgeLineInsetMeters: 0.2,
  centerLineOffsetMeters: 0.12,
  dashLengthMeters: 3,
  dashGapMeters: 9,
  /** Stop line sits this far before a junction, on the inbound lanes. */
  stopLineDistanceMeters: 1.5,
  stopLineWidthMeters: 0.4,

  /** Direction arrows on the travel lane of each straight or arc. */
  arrowSpacingMeters: 60,
  arrowFirstOffsetMeters: 30,

  /** Guardrails on the outer shoulder edge of every straight, arc, and dead end. */
  guardrailHeightMeters: 0.7,
  guardrailBaseMeters: 0.05,
  guardrailPostSpacingMeters: 6,
  guardrailPostSizeMeters: 0.12,

  /** Sampling step for curved centerlines. Keeps curves smooth without excess polygons. */
  maxSampleSpacingMeters: 2,

  /** Surface heights. Shoulders sit below the road so the road edge is never z-fought. */
  roadSurfaceYMeters: 0,
  shoulderYMeters: -0.03,
  markingYMeters: 0.012,
  arrowYMeters: 0.02,
  groundYMeters: -0.2,

  /** Finite ground patch around the test circuit. Fog blends its edge into the horizon. */
  groundHalfExtentMeters: 700,

  /** Filler props on the open blocks, not on the road. */
  blockHeightMeters: 6,
} as const;

/** Derived road profile for the network. Total half width from the centerline, to the outer shoulder edge. */
export const NETWORK_LANE_COUNT = ROAD_NETWORK_CONFIG.lanesPerDirection * 2;
export const NETWORK_ROAD_HALF_WIDTH_METERS = (NETWORK_LANE_COUNT * ROAD_NETWORK_CONFIG.laneWidthMeters) / 2;
export const NETWORK_BOUNDARY_HALF_WIDTH_METERS = NETWORK_ROAD_HALF_WIDTH_METERS + ROAD_NETWORK_CONFIG.shoulderWidthMeters;
