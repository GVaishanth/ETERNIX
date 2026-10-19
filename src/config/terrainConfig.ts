/*
 * Terrain tuning for roads with real elevation (Division 2 hillside district).
 *
 * Roads may now rise and fall. These limits are checked by src/world/roadValidation.ts, so a road that is too steep
 * fails validation before any physics or rendering uses it.
 */
export const TERRAIN_CONFIG = {
  /**
   * Largest road grade allowed, as rise over run (0.08 = 8 percent). Measured between consecutive centerline samples
   * on a segment. Agreed with the user for the hillside switchbacks.
   */
  maxRoadGrade: 0.08,
  /** Gravity, m/s^2. A grade of g * grade acts along the road: a climb slows the car, a descent speeds it up. */
  gravityMps2: 9.81,
} as const;
