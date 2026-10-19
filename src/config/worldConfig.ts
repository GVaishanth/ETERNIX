/** Static world layout constants. Meters. */
export const WORLD_CONFIG = {
  /** Two lanes, one per direction, with a double yellow center line between them. */
  laneCount: 2,
  laneWidthMeters: 3.6,
  shoulderWidthMeters: 3,
  lineWidthMeters: 0.15,
  /** Distance from the road edge to the center of the edge line. */
  edgeLineInsetMeters: 0.2,
  /** Distance from the centerline to the center of each yellow center line. */
  centerLineOffsetMeters: 0.12,

  /** The road runs along +Z from start to end. */
  roadStartZMeters: -100,
  roadEndZMeters: 4000,

  /** Forward-pointing arrows on the right lane, showing the direction of travel. */
  arrowFirstOffsetMeters: 40,
  arrowSpacingMeters: 120,

  /** Distance markers across the road. */
  markerSpacingMeters: 100,
  majorMarkerEvery: 10,

  /** Roadside posts and trees, placed outside the shoulder. */
  roadsidePostSpacingMeters: 25,
  roadsidePostOffsetMeters: 1.2,
  treeSpacingMeters: 60,
  treeOffsetFromShoulderMeters: 6,

  /** Half-size of the square ground plane, centered on the road. */
  groundHalfExtentMeters: 4000,
} as const;

/**
 * World recovery (Part 5). Seconds and metres. Ordinary driving never reaches these limits: the road boundary holds the
 * car on the drivable surface, so recovery is only for a car that is off the surface or wedged and not moving.
 */
export const WORLD_RECOVERY = {
  /** Seconds the car's centre may stay outside every drivable shape before it is recovered to the nearest lane. */
  offRoadSeconds: 2,
  /** Seconds at near-zero speed, while in boundary contact or off the surface, before the car is recovered as stuck. */
  stuckSeconds: 20,
  /** Speed below which the car counts as not moving, m/s. */
  stuckSpeedMps: 0.5,
} as const;
