import type { Vec3 } from './types';

/*
 * ============================================================================
 * COORDINATE CONVENTION (authoritative for simulation, world, camera, input)
 * ============================================================================
 *   World / vehicle-local axes:  +X = right,  +Y = up,  +Z = forward.   Units: meters.
 *   Yaw (heading) θ rotates about +Y.  θ = 0 faces +Z.  θ > 0 turns RIGHT.
 *
 *   forward(θ) = ( sin θ, 0,  cos θ )
 *   right(θ)   = ( cos θ, 0, -sin θ )      (forward rotated 90° clockwise seen from above)
 *
 *   Steering input:  +1 = right (D / ArrowRight),  -1 = left (A / ArrowLeft).
 *   Positive steer angle -> positive yaw rate while moving forward -> nose moves toward +X.
 *
 * RENDER SPACE (Three.js) is right-handed. The brief's axes above form a left-handed
 * frame, so looking from behind a car that faces +Z, +X would appear on the screen's
 * LEFT. To keep steering and screen direction consistent, all simulation-space objects
 * live under a single render root scaled by (1, 1, -1), and the camera converts its
 * points with toRenderSpace(). Nothing else in the codebase may apply this mirror.
 *
 * Pure module: no Three.js imports, safe for simulation and tests.
 * ============================================================================
 */

export const SIM_UP: Readonly<Vec3> = Object.freeze({ x: 0, y: 1, z: 0 });

/** Forward unit vector in simulation space for a given yaw. */
export function forwardFromYaw(yaw: number): Vec3 {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

/** Right unit vector in simulation space for a given yaw. */
export function rightFromYaw(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/**
 * Converts a simulation-space point or direction into right-handed render space.
 * This is the single documented mirror; use it only for free-standing render values
 * (for example camera position and look-at). Objects under the SimRoot group must not
 * call it, because the group already applies the mirror.
 */
export function toRenderSpace(simPoint: Vec3): Vec3 {
  return { x: simPoint.x, y: simPoint.y, z: -simPoint.z };
}
