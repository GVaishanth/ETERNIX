/**
 * Shared simulation types. All simulation values use SI units:
 * meters, seconds, meters per second, radians, and radians per second.
 * See PROJECT_CONTEXT.md for the coordinate convention.
 */

/** A point or direction in simulation space (+X right, +Y up, +Z forward). Meters. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Driver intent, sampled once per rendered frame and held for every fixed step in that frame. */
export interface InputState {
  /** -1 = full left, 0 = neutral, +1 = full right. */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
}

/** Complete kinematic state of the player vehicle. Treated as immutable: each step returns a new object. */
export interface VehicleState {
  /** Rear-axle reference point on the ground plane. Meters. y is 0 in Phase 0. */
  position: Vec3;
  /** Heading in radians. 0 faces +Z. Positive turns right (heading moves from +Z toward +X). */
  yaw: number;
  /** Signed speed along the forward axis, m/s. Negative means reversing. */
  speed: number;
  /** Actual front-wheel steer angle, radians. Positive is right. */
  steerAngle: number;
  /** Yaw rate, rad/s. Positive is a right turn. */
  yawRate: number;
}

export type AppStatus = 'booting' | 'running' | 'error';
