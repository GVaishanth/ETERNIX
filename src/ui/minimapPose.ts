/*
 * Plain, mutable pose for the minimap marker. The render loop writes it once per frame; the minimap reads it in its own
 * draw loop. No React state is involved, so the marker never causes a re-render. Simulation coordinates: x east, z north.
 */

export interface MinimapPose {
  x: number;
  z: number;
  /** Heading in radians, 0 faces +Z (north). Same convention as the vehicle. */
  yaw: number;
}

const pose: MinimapPose = { x: 0, z: 0, yaw: 0 };

export function setMinimapPose(x: number, z: number, yaw: number): void {
  pose.x = x;
  pose.z = z;
  pose.yaw = yaw;
}

export function getMinimapPose(): Readonly<MinimapPose> {
  return pose;
}
