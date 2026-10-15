import type { VehicleConfig } from '../config/vehicleConfig';
import { clamp, lerp, moveTowards, shortestAngleDelta, wrapAngle } from '../core/math';
import { forwardFromYaw, rightFromYaw } from '../core/coordinates';
import type { InputState, Vec3, VehicleState } from '../core/types';
import { RAD_TO_DEG } from '../core/units';

/*
 * Arcade vehicle model, ground plane. Pure: no Three.js, no React.
 *
 * Authoritative state: forward speed (signed), lateral speed (signed, + right), yaw, and position.
 *   - Heading (yaw) follows a kinematic bicycle target from steering, smoothed by a yaw-response lag.
 *   - Lateral speed relaxes toward zero through tire grip, and is driven by centripetal coupling
 *     (dvLat/dt = aTire - speed * yawRate). Normal driving keeps the slip tiny. Low grip (handbrake at speed)
 *     lets the car slide, while the yaw still follows steering. So drift is controlled, and steering alone
 *     decides the heading.
 *   - World velocity = forward * speed + right * lateralSpeed, using the current heading.
 *
 * Steering sign: input.steer > 0 (D / Right) increases yaw, so the nose turns toward +X.
 * Input priority: handbrake overrides throttle and brake. Brake overrides throttle. Brake stops exactly at zero,
 * and reverse engages only from standstill while the brake is still held.
 */

/** Speeds below this magnitude are treated as neutral for the drive-direction readout. */
const DIRECTION_EPSILON_MPS = 0.1;
/** Lower bound on speed when computing lateral acceleration caps, so the cap stays finite at standstill. */
const LATERAL_CAP_MIN_SPEED_MPS = 0.5;
/** Speed gate for the drift readout, so a slow car that is merely jiggling is not reported as drifting. */
const DRIFT_MIN_SPEED_MPS = 5;

export type DriveDirection = 'drive' | 'reverse' | 'neutral';

export function createVehicleState(position: Vec3, yaw: number): VehicleState {
  return {
    position: { x: position.x, y: position.y, z: position.z },
    yaw: wrapAngle(yaw),
    speed: 0,
    lateralSpeed: 0,
    steerAngle: 0,
    yawRate: 0,
    throttlePedal: 0,
    brakePedal: 0,
    handbrakeLevel: 0,
    longitudinalAccel: 0,
    lateralAccel: 0,
    wheelSpin: 0,
  };
}

/** Human-facing drive direction derived from the signed speed. */
export function getDriveDirection(speed: number): DriveDirection {
  if (speed > DIRECTION_EPSILON_MPS) return 'drive';
  if (speed < -DIRECTION_EPSILON_MPS) return 'reverse';
  return 'neutral';
}

/** Slip angle: angle between the velocity direction and the heading, radians. Zero when the car tracks its heading. */
export function slipAngleRadians(state: VehicleState): number {
  return Math.atan2(state.lateralSpeed, Math.abs(state.speed));
}

/**
 * True when the car is in a handbrake drift: sliding beyond the slip threshold, at a meaningful speed, while the
 * handbrake is actually reducing grip. Ordinary cornering slip (at full lock, low speed, or high yaw) is not a drift,
 * so the DRIFT badge only lights for handbrake slides.
 */
export function isDrifting(state: VehicleState, config: VehicleConfig): boolean {
  return (
    Math.abs(state.speed) > DRIFT_MIN_SPEED_MPS &&
    Math.abs(slipAngleRadians(state)) * RAD_TO_DEG > config.driftSlipThresholdDegrees &&
    computeGripReduction(state.handbrakeLevel, state.speed, config) > 0
  );
}

/** Maximum front-wheel angle at the given speed: low-speed steering at standstill, high-speed steering at top speed. */
export function computeMaxSteerAngle(speed: number, config: VehicleConfig): number {
  const speedRatio = clamp(Math.abs(speed) / config.maxForwardSpeedMps, 0, 1);
  return lerp(config.steerAngleLowSpeedRadians, config.steerAngleHighSpeedRadians, speedRatio);
}

/**
 * Yaw rate of the kinematic bicycle model, capped so the lateral acceleration (speed * yawRate) stays within
 * `lateralLimit`. Positive steer angle gives positive yaw rate when moving forward, and the sign flips in reverse.
 */
export function computeYawRate(speed: number, steerAngle: number, config: VehicleConfig, lateralLimit = config.maxLateralAccelerationMps2): number {
  const kinematicYawRate = (speed * Math.tan(steerAngle)) / config.wheelbaseMeters;
  const cap = lateralLimit / Math.max(Math.abs(speed), LATERAL_CAP_MIN_SPEED_MPS);
  return clamp(kinematicYawRate, -cap, cap);
}

/**
 * Fraction of grip reduction from the handbrake, 0 (full grip) to 1 (full drift grip).
 * Scales with handbrake engagement and with speed, so the handbrake cannot start a drift at a crawl.
 */
export function computeGripReduction(handbrakeLevel: number, speed: number, config: VehicleConfig): number {
  const speedGate = clamp((Math.abs(speed) - config.driftMinSpeedMps) / config.driftSpeedRampMps, 0, 1);
  return clamp(handbrakeLevel, 0, 1) * speedGate;
}

/** Pedal targets from raw input. Brake overrides throttle: if both are held, the throttle target is zero. */
export function pedalTargets(input: InputState): { throttle: number; brake: number } {
  const brake = clamp(input.brake, 0, 1);
  const throttle = brake > 0 ? 0 : clamp(input.throttle, 0, 1);
  return { throttle, brake };
}

/** Advances a value toward its target using separate rise and release rates (per second). */
function ramp(current: number, target: number, risePerSecond: number, releasePerSecond: number, dt: number): number {
  const rate = target > current ? risePerSecond : releasePerSecond;
  return moveTowards(current, target, rate * dt);
}

/** Longitudinal update for one step. Returns the new signed forward speed. */
function nextForwardSpeed(
  speed: number,
  throttle: number,
  brake: number,
  handbrake: number,
  config: VehicleConfig,
  dt: number,
): number {
  if (handbrake > 0) {
    // The handbrake slows the car to zero in either direction and holds it there. It never reverses.
    return moveTowards(speed, 0, config.handbrakeDecelerationMps2 * dt);
  }

  if (brake > 0 && speed > 0) {
    // Forward braking stops exactly at zero. It cannot overshoot into reverse.
    return moveTowards(speed, 0, brake * config.brakeDecelerationMps2 * dt);
  }

  if (throttle > 0 && speed < 0) {
    // Throttle while reversing brakes the car back to a stop before it can move forward.
    return moveTowards(speed, 0, throttle * config.brakeDecelerationMps2 * dt);
  }

  let driveAccel = 0;
  if (brake > 0) {
    // Brake held at standstill (or already reversing): reverse acceleration.
    driveAccel = -brake * config.reverseAccelerationMps2;
  } else if (throttle > 0) {
    // Engine force fades linearly toward zero near the top speed.
    const headroom = clamp(1 - speed / config.engineFadeSpeedMps, 0, 1);
    driveAccel = throttle * config.engineAccelerationMps2 * headroom;
  }

  // Rolling resistance plus aero drag oppose the current motion. They pull toward zero and never reverse the car.
  const resistance = config.rollingResistanceMps2 + config.airDragPerMeter * speed * speed;
  let next = speed + driveAccel * dt;
  next = moveTowards(next, 0, resistance * dt);
  return clamp(next, -config.maxReverseSpeedMps, config.maxForwardSpeedMps);
}

/** Advances the vehicle by one fixed step. Returns a new state object. */
export function stepVehicle(
  state: VehicleState,
  input: InputState,
  config: VehicleConfig,
  dtSeconds: number,
): VehicleState {
  if (!(dtSeconds > 0)) return state;
  const dt = dtSeconds;

  // 1. Pedals and handbrake engagement ramp toward their targets.
  const targets = pedalTargets(input);
  const throttlePedal = ramp(state.throttlePedal, targets.throttle, config.throttleRisePerSecond, config.throttleReleasePerSecond, dt);
  const brakePedal = ramp(state.brakePedal, targets.brake, config.brakeRisePerSecond, config.brakeReleasePerSecond, dt);
  const handbrakeTarget = clamp(input.handbrake, 0, 1);
  const handbrakeLevel = moveTowards(
    state.handbrakeLevel,
    handbrakeTarget,
    dt / (handbrakeTarget > state.handbrakeLevel ? config.handbrakeEngageSeconds : config.handbrakeReleaseSeconds),
  );

  // 2. Longitudinal speed.
  const speed = nextForwardSpeed(state.speed, throttlePedal, brakePedal, handbrakeTarget, config, dt);

  // 3. Tire grip: reduced by the handbrake at speed. Grip reduction is the only drift mechanism.
  const gripReduction = computeGripReduction(handbrakeLevel, speed, config);
  const grip = lerp(config.lateralGripPerSecond, config.lateralGripDriftPerSecond, gripReduction);
  const lateralLimit = lerp(config.maxLateralAccelerationMps2, config.maxDriftLateralAccelerationMps2, gripReduction);

  // 4. Steering: rate-limited front-wheel angle, speed-dependent maximum.
  const maxSteer = computeMaxSteerAngle(speed, config);
  const commandedSteer = clamp(input.steer, -1, 1) * maxSteer;
  const steerAngle = moveTowards(state.steerAngle, commandedSteer, config.steerRateRadiansPerSecond * dt);

  // 5. Yaw: the kinematic target from steering and the lateral limit, followed with a first-order lag.
  const yawTarget = computeYawRate(speed, steerAngle, config, lateralLimit);
  const yawBlend = 1 - Math.exp(-dt / config.yawResponseSeconds);
  const yawRate = state.yawRate + (yawTarget - state.yawRate) * yawBlend;

  // 6. Lateral speed: tire force opposes sideways motion, and centripetal coupling drives it during turns.
  const tireLateralAccel = clamp(-grip * state.lateralSpeed, -lateralLimit, lateralLimit);
  let lateralSpeed = state.lateralSpeed + (tireLateralAccel - speed * yawRate) * dt;
  const maxLateralSpeed = Math.abs(speed) * Math.tan((config.maxSlipAngleDegrees * Math.PI) / 180);
  lateralSpeed = clamp(lateralSpeed, -maxLateralSpeed, maxLateralSpeed);

  // 7. Position and heading. Midpoint heading and average velocity give a second-order position update.
  const yaw = wrapAngle(state.yaw + yawRate * dt);
  const midYaw = state.yaw + 0.5 * yawRate * dt;
  const forward = forwardFromYaw(midYaw);
  const right = rightFromYaw(midYaw);
  const avgForward = 0.5 * (state.speed + speed);
  const avgLateral = 0.5 * (state.lateralSpeed + lateralSpeed);
  const position: Vec3 = {
    x: state.position.x + forward.x * avgForward * dt + right.x * avgLateral * dt,
    y: state.position.y,
    z: state.position.z + forward.z * avgForward * dt + right.z * avgLateral * dt,
  };

  // 8. Wheel spin: distance traveled divided by radius. Reverse gives negative spin.
  const wheelSpin = wrapAngle(state.wheelSpin + (avgForward * dt) / config.wheelRadiusMeters);

  return {
    position,
    yaw,
    speed,
    lateralSpeed,
    steerAngle,
    yawRate,
    throttlePedal,
    brakePedal,
    handbrakeLevel,
    longitudinalAccel: (speed - state.speed) / dt,
    lateralAccel: speed * yawRate,
    wheelSpin,
  };
}

/**
 * Blends two consecutive simulated states for rendering. Angles use the shortest arc, so a heading or wheel
 * crossing ±PI never interpolates the long way round. Render only: never feed the result back into the simulation.
 */
export function interpolateVehicleState(previous: VehicleState, current: VehicleState, alpha: number): VehicleState {
  const a = clamp(alpha, 0, 1);
  return {
    position: {
      x: lerp(previous.position.x, current.position.x, a),
      y: lerp(previous.position.y, current.position.y, a),
      z: lerp(previous.position.z, current.position.z, a),
    },
    yaw: wrapAngle(previous.yaw + shortestAngleDelta(previous.yaw, current.yaw) * a),
    speed: lerp(previous.speed, current.speed, a),
    lateralSpeed: lerp(previous.lateralSpeed, current.lateralSpeed, a),
    steerAngle: lerp(previous.steerAngle, current.steerAngle, a),
    yawRate: lerp(previous.yawRate, current.yawRate, a),
    throttlePedal: lerp(previous.throttlePedal, current.throttlePedal, a),
    brakePedal: lerp(previous.brakePedal, current.brakePedal, a),
    handbrakeLevel: lerp(previous.handbrakeLevel, current.handbrakeLevel, a),
    longitudinalAccel: lerp(previous.longitudinalAccel, current.longitudinalAccel, a),
    lateralAccel: lerp(previous.lateralAccel, current.lateralAccel, a),
    wheelSpin: wrapAngle(previous.wheelSpin + shortestAngleDelta(previous.wheelSpin, current.wheelSpin) * a),
  };
}
