import { wrapAngle } from '../core/math';
import { imageNear } from '../world/wrap/worldWrap';

const DEG = Math.PI / 180;
const degToRad = (degrees: number): number => degrees * DEG;

/*
 * Sight (Part 7). A unit sees the player inside a radius and a cone around its heading. There is no occlusion: this is
 * a documented simplification (buildings do not block sight). Pure.
 */

export interface SightSource {
  x: number;
  z: number;
  /** Heading of the unit, radians. Yaw convention matches the vehicle model: forward is (sin yaw, cos yaw). */
  yaw: number;
}

export interface SightConfig {
  radiusMeters: number;
  halfAngleDegrees: number;
}

/**
 * True when the target is inside the unit's radius and cone. A target at the unit's own position is seen. On a loop
 * (period not null) the target is measured from its image nearest the unit, so a target across a seam is seen too.
 */
export function canSee(source: SightSource, target: { x: number; z: number }, sight: SightConfig, period: number | null = null): boolean {
  const dx = imageNear(source.x, target.x, period) - source.x;
  const dz = imageNear(source.z, target.z, period) - source.z;
  const distance = Math.hypot(dx, dz);
  if (distance > sight.radiusMeters) return false;
  if (distance < 1e-6) return true;
  const bearing = Math.atan2(dx, dz);
  const offset = Math.abs(wrapAngle(bearing - source.yaw));
  return offset <= degToRad(sight.halfAngleDegrees);
}

/** Absolute angle, in radians, between a unit's heading and the direction to a point. Range 0..pi. */
export function offAxisAngle(source: SightSource, point: { x: number; z: number }, period: number | null = null): number {
  const bearing = Math.atan2(imageNear(source.x, point.x, period) - source.x, imageNear(source.z, point.z, period) - source.z);
  return Math.abs(wrapAngle(bearing - source.yaw));
}
