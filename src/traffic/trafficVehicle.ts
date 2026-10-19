import { shortestAngleDelta, wrapAngle, clamp } from '../core/math';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import type { TrafficTypeId } from './trafficTypes';

/*
 * One traffic vehicle's state (Part 4). Lane-locked: the vehicle is described by a lane and an arc length on it.
 * Its world pose is derived from the lane, so it can never leave the lane path.
 */

export interface TrafficVehicle {
  /** Stable slot id, 0..capacity-1. Fixed for the life of the slot. */
  id: number;
  active: boolean;
  /** Increments every time the slot is recycled, so stale references can be detected. */
  generation: number;
  typeId: TrafficTypeId | null;
  laneId: string | null;
  /** Arc length along the current lane, meters. Measured from the lane start to the reference point. */
  s: number;
  speed: number;
  /** Speed the vehicle wants on open road, m/s. Set at spawn from the type and the lane limit. */
  cruiseSpeed: number;
  x: number;
  /** Height of the lane under the vehicle, metres. Follows the road; drawn at this height. */
  y: number;
  z: number;
  /** Rate-limited heading, radians. Follows the lane tangent. */
  heading: number;
  /** Acceleration applied in the last step, m/s^2. For diagnostics. */
  accel: number;
  /** Gap to the leader at the last step, meters. Null when the road ahead is clear. For diagnostics. */
  leaderGapMeters: number | null;
  /** Speed of the leader at the last step, m/s. Null when the road ahead is clear. */
  leaderSpeed: number | null;
  /** Id of the vehicle this one follows, or null. */
  leaderId: number | null;
  /** True when the leader is the player's car, not another traffic vehicle. */
  leaderIsPlayer: boolean;
  /** Seconds the vehicle has been stopped. Reset when it moves. Used to recycle stalled traffic. */
  stoppedSeconds: number;
}

/** Every field is set here. Recycling calls this, so no old state can survive into the next vehicle. */
export function createInactiveTrafficVehicle(id: number): TrafficVehicle {
  return {
    id,
    active: false,
    generation: 0,
    typeId: null,
    laneId: null,
    s: 0,
    speed: 0,
    cruiseSpeed: 0,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    accel: 0,
    leaderGapMeters: null,
    leaderSpeed: null,
    leaderId: null,
    leaderIsPlayer: false,
    stoppedSeconds: 0,
  };
}

/** Clears every field of a slot, keeping its id and bumping its generation. */
export function resetTrafficVehicle(vehicle: TrafficVehicle): void {
  const fresh = createInactiveTrafficVehicle(vehicle.id);
  const generation = vehicle.generation + 1;
  Object.assign(vehicle, fresh, { generation });
}

export interface IdmParameters {
  /** Desired speed on open road, m/s. */
  desiredSpeedMps: number;
  /** Standstill gap, meters. */
  minGapMeters: number;
  /** Desired time headway, seconds. */
  headwaySeconds: number;
  /** Comfortable acceleration, m/s^2. */
  comfortAccelMps2: number;
  /** Comfortable deceleration, m/s^2. */
  comfortDecelMps2: number;
}

/**
 * Intelligent Driver Model acceleration (Treiber, Hennecke, Helbing 2000). Pure.
 * With no leader (gap null), it is the free-road term, so vehicles accelerate smoothly to their cruise speed.
 * With a leader, the vehicle brakes when the gap falls below its desired gap, and the braking grows smoothly.
 * The result is clamped by the caller to the emergency limit.
 */
export function idmAcceleration(
  params: IdmParameters,
  speed: number,
  gapMeters: number | null,
  leaderSpeed: number,
): number {
  const v0 = Math.max(params.desiredSpeedMps, 0.1);
  const freeTerm = 1 - Math.pow(Math.max(speed, 0) / v0, TRAFFIC_CONFIG.idm.exponent);
  if (gapMeters === null) return params.comfortAccelMps2 * freeTerm;

  const a = params.comfortAccelMps2;
  const b = params.comfortDecelMps2;
  const approachRate = speed - leaderSpeed;
  const desiredGap =
    params.minGapMeters +
    Math.max(0, speed * params.headwaySeconds + (speed * approachRate) / (2 * Math.sqrt(a * b)));
  const gap = Math.max(gapMeters, 0.01);
  return a * (freeTerm - (desiredGap / gap) ** 2);
}

/**
 * Advances a heading toward a target at a limited rate. Never snaps. Heading is wrapped to (-pi, pi].
 */
export function approachHeading(current: number, target: number, maxRateRadPerSecond: number, dtSeconds: number): number {
  const delta = shortestAngleDelta(current, target);
  const step = clamp(delta, -maxRateRadPerSecond * dtSeconds, maxRateRadPerSecond * dtSeconds);
  return wrapAngle(current + step);
}
