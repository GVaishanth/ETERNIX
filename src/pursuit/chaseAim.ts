/*
 * The point a chasing unit aims at (pure). The vehicle model's forward direction is (sin yaw, cos yaw), so "behind" is
 * the player's position moved back along that direction. A chase aims behind the player's centre, so the unit comes up
 * on the tail and tags it, and does not drive into the middle of the car.
 */
export function chaseAimPoint(x: number, z: number, yawRadians: number, behindMeters: number): { x: number; z: number } {
  return { x: x - Math.sin(yawRadians) * behindMeters, z: z - Math.cos(yawRadians) * behindMeters };
}
