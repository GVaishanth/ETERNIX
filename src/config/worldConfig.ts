/** Static world layout constants. Meters. */
export const WORLD_CONFIG = {
  laneCount: 3,
  laneWidthMeters: 3.6,
  /** Road begins behind the spawn point so the car can be seen from the first frame. */
  roadStartZMeters: -100,
  roadEndZMeters: 4000,
  dashLengthMeters: 3,
  dashGapMeters: 9,
  lineWidthMeters: 0.15,
  /** Spacing between distance markers across the road. */
  markerSpacingMeters: 100,
  /** Minor and major markers use different colors every N markers. */
  majorMarkerEvery: 10,
  groundHalfExtentMeters: 10000,
} as const;
