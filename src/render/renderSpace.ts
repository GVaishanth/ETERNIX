import { Box3, Vector3 } from 'three';
import { toRenderSpace } from '../core/coordinates';
import type { AxisAlignedBounds } from '../world/roadLayout';
import type { Vec3 } from '../core/types';

/**
 * Helpers that bridge simulation space and Three.js objects that live OUTSIDE the SimRoot mirror
 * (the camera). Objects inside SimRoot should set simulation coordinates directly.
 */

export function setRenderVector(target: Vector3, simPoint: Vec3): Vector3 {
  const converted = toRenderSpace(simPoint);
  return target.set(converted.x, converted.y, converted.z);
}

/**
 * Same as setRenderVector, but relative to a floating origin (see worldOrigin.ts). Used for objects outside SimRoot, the
 * camera, so they agree with the world that SimRoot draws relative to that origin.
 */
export function setRenderVectorFrom(target: Vector3, simPoint: Vec3, origin: { x: number; z: number }): Vector3 {
  return target.set(simPoint.x - origin.x, simPoint.y, -(simPoint.z - origin.z));
}

/** Converts simulation bounds to render bounds. Z flips, so the min and max swap on that axis. */
export function renderBoundsFromSim(bounds: AxisAlignedBounds): Box3 {
  const min = toRenderSpace(bounds.min);
  const max = toRenderSpace(bounds.max);
  return new Box3(
    new Vector3(Math.min(min.x, max.x), Math.min(min.y, max.y), Math.min(min.z, max.z)),
    new Vector3(Math.max(min.x, max.x), Math.max(min.y, max.y), Math.max(min.z, max.z)),
  );
}
