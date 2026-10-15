/** Chase camera tuning. Distances are meters. Damping rates are per second. */
export interface ChaseCameraConfig {
  readonly fovDegrees: number;
  readonly nearMeters: number;
  readonly farMeters: number;
  /** Camera distance behind the rear axle, measured along the vehicle forward axis. */
  readonly distanceBehindMeters: number;
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
}

export const CHASE_CAMERA_CONFIG: ChaseCameraConfig = {
  fovDegrees: 62,
  nearMeters: 0.1,
  farMeters: 3000,
  distanceBehindMeters: 7.5,
  heightMeters: 2.8,
  lookAheadMeters: 12,
  lookHeightMeters: 1.0,
  positionDampingPerSecond: 6,
  lookDampingPerSecond: 10,
};
