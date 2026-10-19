import { forwardFromYaw, rightFromYaw } from '../core/coordinates';
import type { VehicleState } from '../core/types';

/*
 * Contact response for a driven vehicle (Part 4). Corrections only: the car is pushed out along the contact normal,
 * and the part of its velocity that drives into the contact is removed. Nothing is added. Yaw, steering, and the
 * handling model are not touched, so a collision cannot reverse the steering or move the camera.
 */

export interface Vector2 {
  x: number;
  z: number;
}

/** Ground velocity of a driven vehicle, from its forward and lateral speeds and its yaw. */
export function vehicleVelocity(state: VehicleState): Vector2 {
  const forward = forwardFromYaw(state.yaw);
  const right = rightFromYaw(state.yaw);
  return {
    x: forward.x * state.speed + right.x * state.lateralSpeed,
    z: forward.z * state.speed + right.z * state.lateralSpeed,
  };
}

/**
 * Applies a contact to a driven vehicle state.
 *   push            the penetration correction, applied to the position
 *   normal          unit contact normal, pointing from the other body toward this car
 *   otherVelocity   ground velocity of the other body at the contact
 * The normal component of (this car's velocity - other velocity) is removed when it drives into the contact.
 * The tangential component is kept.
 */
export function applyVehicleContact(state: VehicleState, push: Vector2, normal: Vector2, otherVelocity: Vector2): VehicleState {
  const forward = forwardFromYaw(state.yaw);
  const right = rightFromYaw(state.yaw);
  const vx = forward.x * state.speed + right.x * state.lateralSpeed;
  const vz = forward.z * state.speed + right.z * state.lateralSpeed;

  const rx = vx - otherVelocity.x;
  const rz = vz - otherVelocity.z;
  const into = rx * normal.x + rz * normal.z;
  // Only an approach (negative along the normal, from the other body toward this car) is removed. Separating motion stays.
  const removed = into < 0 ? into : 0;
  const nextVx = vx - removed * normal.x;
  const nextVz = vz - removed * normal.z;

  const nextSpeed = nextVx * forward.x + nextVz * forward.z;
  const nextLateral = nextVx * right.x + nextVz * right.z;
  return {
    ...state,
    position: { x: state.position.x + push.x, y: state.position.y, z: state.position.z + push.z },
    speed: nextSpeed,
    lateralSpeed: nextLateral,
  };
}
