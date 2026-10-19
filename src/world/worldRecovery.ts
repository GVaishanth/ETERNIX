import { WORLD_RECOVERY } from '../config/worldConfig';
import type { Vec3 } from '../core/types';
import { laneSample, nearestOnLane, type LanePath } from '../traffic/laneGraph';

/*
 * World recovery (Part 5). Pure: no simulation state, no rendering. The simulation feeds one input per fixed step and
 * relocates the car only when this reports a reason. Recovery is never part of ordinary driving.
 */

export type RecoveryReason = 'outside-bounds' | 'off-road' | 'stuck';

export interface RecoveryConfig {
  offRoadSeconds: number;
  stuckSeconds: number;
  stuckSpeedMps: number;
}

export interface RecoveryInput {
  /** Car reference point, simulation space. */
  x: number;
  z: number;
  speedMps: number;
  /** True when the centre point is inside a drivable shape. */
  onSurface: boolean;
  /** True when every footprint corner is inside a drivable shape. False means part of the car is wedged off the road. */
  footprintOnSurface: boolean;
  /** True when the point is inside the world's bounds. */
  insideBounds: boolean;
  dtSeconds: number;
}

export interface RecoveryMonitor {
  offRoadSeconds: number;
  stuckSeconds: number;
}

export interface RecoveryPose {
  position: Vec3;
  yawRadians: number;
}

export interface GroundCorner {
  x: number;
  z: number;
}

/**
 * Footprint corners on the ground plane. Heading 0 faces +Z, and positive yaw turns toward +X, so forward is (sin, cos)
 * and right is (cos, -sin). The reference point is the rear axle.
 */
export function footprintCornersOf(
  x: number,
  z: number,
  yawRadians: number,
  footprint: { rearMeters: number; frontMeters: number; halfWidthMeters: number },
): GroundCorner[] {
  const fx = Math.sin(yawRadians);
  const fz = Math.cos(yawRadians);
  const rx = Math.cos(yawRadians);
  const rz = -Math.sin(yawRadians);
  const corners: GroundCorner[] = [];
  for (const along of [-footprint.rearMeters, footprint.frontMeters]) {
    for (const across of [-footprint.halfWidthMeters, footprint.halfWidthMeters]) {
      corners.push({ x: x + fx * along + rx * across, z: z + fz * along + rz * across });
    }
  }
  return corners;
}

export function createRecoveryMonitor(): RecoveryMonitor {
  return { offRoadSeconds: 0, stuckSeconds: 0 };
}

export function resetRecoveryMonitor(monitor: RecoveryMonitor): void {
  monitor.offRoadSeconds = 0;
  monitor.stuckSeconds = 0;
}

/**
 * Advances the monitor by one step. Outside the bounds is immediate. Off the surface (centre point) is timed. Stuck is a
 * stop with part of the car wedged off the drivable surface, which the car cannot drive out of. A car stopped on the road
 * is recoverable (it can reverse), so it never counts as stuck, however long it is held against a boundary.
 * The timers reset as soon as the condition clears.
 */
export function stepRecoveryMonitor(
  monitor: RecoveryMonitor,
  input: RecoveryInput,
  config: RecoveryConfig = WORLD_RECOVERY,
): RecoveryReason | null {
  if (!input.insideBounds) return 'outside-bounds';

  monitor.offRoadSeconds = input.onSurface ? 0 : monitor.offRoadSeconds + input.dtSeconds;

  const stationary = input.speedMps < config.stuckSpeedMps;
  const wedged = !input.footprintOnSurface;
  monitor.stuckSeconds = stationary && wedged ? monitor.stuckSeconds + input.dtSeconds : 0;

  if (monitor.offRoadSeconds >= config.offRoadSeconds) return 'off-road';
  if (monitor.stuckSeconds >= config.stuckSeconds) return 'stuck';
  return null;
}

/**
 * Nearest point on a driving lane (segment lanes only, never connectors), with the lane heading as the yaw. Returns null
 * when there are no lanes. Used only on recovery, so a linear scan is fine.
 */
export function nearestRecoveryPose(lanes: readonly LanePath[], x: number, z: number): RecoveryPose | null {
  let best: { lane: LanePath; s: number; distance: number } | null = null;
  for (const lane of lanes) {
    if (lane.kind !== 'segment') continue;
    const near = nearestOnLane(lane, x, z);
    if (!near) continue;
    if (!best || near.distance < best.distance) best = { lane, s: near.s, distance: near.distance };
  }
  if (!best) return null;
  const sample = laneSample(best.lane, best.s);
  const y = best.lane.points[0]?.y ?? 0;
  return { position: { x: sample.x, y, z: sample.z }, yawRadians: sample.heading };
}
