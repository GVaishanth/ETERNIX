import type { VehicleConfig } from '../config/vehicleConfig';
import { clamp, lerp, moveTowards, wrapAngle } from '../core/math';
import { forwardFromYaw } from '../core/coordinates';
import type { InputState, Vec3, VehicleState } from '../core/types';

/*
 * Arcade single-track (bicycle) model in the ground plane. Pure: no Three.js, no React.
 *   yawRate = speed * tan(steerAngle) / wheelbase, capped by a lateral-acceleration limit.
 *   Position advances along the heading at the midpoint of the step (second-order).
 *
 * Steering sign: input.steer > 0 (D / Right) increases yaw, which turns the nose toward +X.
 * Input.steer < 0 (A / Left) decreases yaw, which turns the nose toward -X.
 */

/** Speeds below this magnitude are treated as "stopped" for the drive-direction readout. */
const DIRECTION_EPSILON_MPS = 0.1;
/** Reverse speeds smaller than this are treated as standing still, so throttle stops reversing rather than braking. */
const STOPPED_SPEED_EPSILON_MPS = 0.05;
const LATERAL_LIMIT_MIN_SPEED_MPS = 0.5;

export type DriveDirection = 'drive' | 'reverse' | 'neutral';

export function createVehicleState(position: Vec3, yaw: number): VehicleState {
  return {
    position: { x: position.x, y: position.y, z: position.z },
    yaw: wrapAngle(yaw),
    speed: 0,
    steerAngle: 0,
    yawRate: 0,
  };
}

/** Human-facing drive direction derived from the signed speed. */
export function getDriveDirection(speed: number): DriveDirection {
  if (speed > DIRECTION_EPSILON_MPS) return 'drive';
  if (speed < -DIRECTION_EPSILON_MPS) return 'reverse';
  return 'neutral';
}

/** Advances the vehicle by one fixed step. Returns a new state object. */
export function stepVehicle(
  state: VehicleState,
  input: InputState,
  config: VehicleConfig,
  dtSeconds: number,
): VehicleState {
  const steerAngle = nextSteerAngle(state, input, config, dtSeconds);
  const speed = nextSpeed(state.speed, input, config, dtSeconds);
  const yawRate = computeYawRate(speed, steerAngle, config);
  const yaw = wrapAngle(state.yaw + yawRate * dtSeconds);
  const midYaw = state.yaw + 0.5 * yawRate * dtSeconds;
  const heading = forwardFromYaw(midYaw);

  return {
    position: {
      x: state.position.x + heading.x * speed * dtSeconds,
      y: state.position.y,
      z: state.position.z + heading.z * speed * dtSeconds,
    },
    yaw,
    speed,
    steerAngle,
    yawRate,
  };
}

/** Maximum front-wheel angle at the given speed. Steering authority tapers toward top speed. */
export function computeMaxSteerAngle(speed: number, config: VehicleConfig): number {
  const speedRatio = clamp(Math.abs(speed) / config.maxForwardSpeedMps, 0, 1);
  return config.maxSteerAngleRadians * lerp(1, 1 - config.steerReductionAtTopSpeed, speedRatio);
}

/** Yaw rate from the bicycle model, limited so lateral acceleration stays bounded. */
export function computeYawRate(speed: number, steerAngle: number, config: VehicleConfig): number {
  const kinematicYawRate = (speed * Math.tan(steerAngle)) / config.wheelbaseMeters;
  const lateralLimit =
    config.maxLateralAccelerationMps2 / Math.max(Math.abs(speed), LATERAL_LIMIT_MIN_SPEED_MPS);
  return clamp(kinematicYawRate, -lateralLimit, lateralLimit);
}

function nextSteerAngle(
  state: VehicleState,
  input: InputState,
  config: VehicleConfig,
  dtSeconds: number,
): number {
  const commanded = clamp(input.steer, -1, 1) * computeMaxSteerAngle(state.speed, config);
  return moveTowards(state.steerAngle, commanded, config.steerRateRadiansPerSecond * dtSeconds);
}

function nextSpeed(speed: number, input: InputState, config: VehicleConfig, dtSeconds: number): number {
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);

  // The handbrake overrides throttle and reverse, and holds the car at zero.
  if (input.handbrake > 0) {
    return moveTowards(speed, 0, config.handbrakeDecelerationMps2 * dtSeconds);
  }
  // Braking from any positive speed decelerates to exactly zero, so the car never skips into reverse.
  if (brake > 0 && speed > 0) {
    return moveTowards(speed, 0, brake * config.brakeDecelerationMps2 * dtSeconds);
  }
  if (throttle > 0) {
    return driveForward(speed, throttle, config, dtSeconds);
  }
  if (brake > 0) {
    return clampSpeed(speed - brake * config.reverseAccelerationMps2 * dtSeconds, config);
  }
  return moveTowards(speed, 0, config.coastDecelerationMps2 * dtSeconds);
}

function driveForward(speed: number, throttle: number, config: VehicleConfig, dtSeconds: number): number {
  if (speed < -STOPPED_SPEED_EPSILON_MPS) {
    // Throttle while reversing acts as a brake, so the car stops before moving forward.
    return moveTowards(speed, 0, throttle * config.brakeDecelerationMps2 * dtSeconds);
  }
  const headroom = clamp(1 - speed / config.maxForwardSpeedMps, 0, 1);
  return clampSpeed(speed + throttle * config.engineAccelerationMps2 * headroom * dtSeconds, config);
}

function clampSpeed(speed: number, config: VehicleConfig): number {
  return clamp(speed, -config.maxReverseSpeedMps, config.maxForwardSpeedMps);
}
