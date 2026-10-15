/**
 * Chase camera tuning. Distances are meters, angles degrees, times seconds. Damping rates are per second
 * and are applied with frame-rate-independent smoothing.
 */
export interface ChaseCameraConfig {
  /** Field of view at standstill. */
  readonly fovBaseDegrees: number;
  /** Field of view at top speed. The FOV widens linearly with speed. */
  readonly fovMaxDegrees: number;
  /** Convergence rate of the FOV toward its speed-based target. */
  readonly fovDampingPerSecond: number;
  readonly nearMeters: number;
  readonly farMeters: number;
  /** Camera distance behind the rear axle at standstill. */
  readonly distanceBehindMeters: number;
  /** Extra pull-back per m/s of speed. */
  readonly distancePerSpeedMeters: number;
  /** Upper limit on the speed-based pull-back. */
  readonly maxSpeedDistanceMeters: number;
  /** Distance change per m/s^2 of longitudinal acceleration. The camera lags the car as it speeds up or slows down. */
  readonly distancePerAccelMeters: number;
  /** Upper limit on the acceleration-based distance change, in either direction. */
  readonly maxAccelDistanceMeters: number;
  /** Convergence rate of the smoothed acceleration that drives the distance lag. */
  readonly accelDampingPerSecond: number;
  /** Camera height above the ground. */
  readonly heightMeters: number;
  /** Look-at point distance ahead of the rear axle. */
  readonly lookAheadMeters: number;
  /** Look-at point height above the ground. */
  readonly lookHeightMeters: number;
  /** Convergence rate of camera position toward its goal. */
  readonly positionDampingPerSecond: number;
  /** Convergence rate of the look-at point toward its goal. */
  readonly lookDampingPerSecond: number;
  /**
   * Convergence rate of the camera heading toward the vehicle heading. A low value lets the camera swing
   * slightly behind a turn. It never rolls, and it never reads steering input.
   */
  readonly headingDampingPerSecond: number;
  /** Fraction of top speed where the speed shake begins (0..1). */
  readonly shakeStartFraction: number;
  /** Maximum shake offset at top speed. Meters. */
  readonly shakeMaxMeters: number;
  /** Shake oscillation frequency. Hz. */
  readonly shakeFrequencyHz: number;
}

export const CHASE_CAMERA_CONFIG: ChaseCameraConfig = {
  fovBaseDegrees: 62,
  fovMaxDegrees: 74,
  fovDampingPerSecond: 4,
  nearMeters: 0.1,
  farMeters: 3000,
  distanceBehindMeters: 7.5,
  distancePerSpeedMeters: 0.05,
  maxSpeedDistanceMeters: 3,
  distancePerAccelMeters: 0.04,
  maxAccelDistanceMeters: 0.8,
  accelDampingPerSecond: 3,
  heightMeters: 2.8,
  lookAheadMeters: 12,
  lookHeightMeters: 1.0,
  positionDampingPerSecond: 6,
  lookDampingPerSecond: 10,
  headingDampingPerSecond: 5,
  shakeStartFraction: 0.6,
  shakeMaxMeters: 0.035,
  shakeFrequencyHz: 9,
};
