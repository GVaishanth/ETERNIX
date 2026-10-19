import type { RefObject } from 'react';
import type { Object3D } from 'three';

/*
 * Floating origin for the looping world. The simulation keeps the car's logical position, which grows without bound as
 * the car drives on the torus. Rendering keeps the car near the scene origin instead: the mirrored SimRoot moves by the
 * negative origin, and the chase camera is placed relative to it. Everything under SimRoot is drawn in simulation
 * coordinates, so one translation moves the whole world. Finite worlds keep the origin at zero, and nothing changes.
 */

export interface WorldOriginTargets {
  /** The SimRoot group. Its position is the negative origin (x), and its z is the origin's z, because it mirrors z. */
  readonly root: RefObject<Object3D | null>;
  /** The ground that follows the origin, in simulation coordinates. Its ref is empty in finite worlds. */
  readonly ground: RefObject<Object3D | null>;
}

export interface PlanarOrigin {
  x: number;
  z: number;
}

/** Writes the origin to the targets. Called once per frame, before anything under SimRoot is drawn. */
export function applyWorldOrigin(targets: WorldOriginTargets, origin: PlanarOrigin): void {
  // SimRoot mirrors z (scale -1), so its translation in z is the origin's z, not its negative. A sim point at the origin
  // then lands at scene (0, 0), where the car is.
  targets.root.current?.position.set(-origin.x, 0, origin.z);
  targets.ground.current?.position.set(origin.x, 0, origin.z);
}
