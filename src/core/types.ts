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
  /** 0 = released, 1 = held. */
  handbrake: number;
}

/**
 * Complete state of the player vehicle. Treated as immutable: each step returns a new object.
 * Velocity is stored in the vehicle's own frame: `speed` along the forward axis and `lateralSpeed` along
 * the right axis. The world velocity is derived from the heading, so the two can never disagree.
 */
export interface VehicleState {
  /** Rear-axle reference point on the ground plane. Meters. y is 0 on the flat road. */
  position: Vec3;
  /** Heading in radians. 0 faces +Z. Positive turns right (heading moves from +Z toward +X). */
  yaw: number;
  /** Signed speed along the forward axis, m/s. Negative means reversing. */
  speed: number;
  /** Sideways speed along the right axis, m/s. Positive is toward +X in the vehicle frame. */
  lateralSpeed: number;
  /** Actual front-wheel steer angle, radians. Positive is right. */
  steerAngle: number;
  /** Yaw rate, rad/s. Positive is a right turn. */
  yawRate: number;
  /** Smoothed throttle pedal, 0..1. */
  throttlePedal: number;
  /** Smoothed brake pedal, 0..1. */
  brakePedal: number;
  /** Smoothed handbrake engagement, 0..1. Scales the drift grip reduction. */
  handbrakeLevel: number;
  /** Longitudinal acceleration produced in the last step, m/s^2. Positive is forward. */
  longitudinalAccel: number;
  /** Lateral (centripetal) acceleration, m/s^2, equal to speed * yawRate. Positive is toward the right. */
  lateralAccel: number;
  /** Accumulated wheel rotation about the axle, radians, wrapped to [-PI, PI). Positive is forward roll. */
  wheelSpin: number;
}

/** Cosmetic body response: pitch, roll, and heave of the car body. Kept apart from the vehicle root. */
export interface BodyState {
  /** Radians. Positive is nose down. */
  pitch: number;
  pitchRate: number;
  /** Radians. Positive lifts the right side. */
  roll: number;
  rollRate: number;
  /** Meters. Positive is up. */
  heave: number;
  heaveRate: number;
}

export type AppStatus = 'booting' | 'running' | 'error';
