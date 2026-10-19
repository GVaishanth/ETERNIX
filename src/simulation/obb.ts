import { forwardFromYaw, rightFromYaw } from '../core/coordinates';

/*
 * Oriented boxes in the ground plane (XZ), for arcade collision between vehicles (Part 4).
 * Pure functions. No physics engine. Overlap uses the separating-axis test on the two box axes of each box.
 */

export interface GroundBox {
  /** Centre, simulation meters. */
  cx: number;
  cz: number;
  /** Unit forward axis. */
  fx: number;
  fz: number;
  /** Unit right axis. */
  rx: number;
  rz: number;
  halfLengthMeters: number;
  halfWidthMeters: number;
}

/**
 * Box for a vehicle whose reference point is the rear-axle centre. The body runs from `rearMeters` behind the reference
 * to `noseMeters` ahead of it, and is `halfWidthMeters` to each side.
 */
export function groundBoxFromPose(
  x: number,
  z: number,
  heading: number,
  rearMeters: number,
  noseMeters: number,
  halfWidthMeters: number,
): GroundBox {
  const forward = forwardFromYaw(heading);
  const right = rightFromYaw(heading);
  const centreAlong = (noseMeters - rearMeters) / 2;
  return {
    cx: x + forward.x * centreAlong,
    cz: z + forward.z * centreAlong,
    fx: forward.x,
    fz: forward.z,
    rx: right.x,
    rz: right.z,
    halfLengthMeters: (noseMeters + rearMeters) / 2,
    halfWidthMeters,
  };
}

export interface OverlapResult {
  overlapping: boolean;
  /** Smallest penetration along any separating axis, meters. Zero when not overlapping. */
  depthMeters: number;
  /** Unit direction along the minimum-depth axis, pointing from `b` toward `a`. Zero when not overlapping. */
  normalX: number;
  normalZ: number;
}

const NO_OVERLAP: OverlapResult = { overlapping: false, depthMeters: 0, normalX: 0, normalZ: 0 };

function projectedRadius(box: GroundBox, axisX: number, axisZ: number): number {
  return (
    box.halfLengthMeters * Math.abs(box.fx * axisX + box.fz * axisZ) +
    box.halfWidthMeters * Math.abs(box.rx * axisX + box.rz * axisZ)
  );
}

/** Separating-axis overlap test for two boxes. Returns the minimum translation along the best axis. */
export function groundBoxOverlap(a: GroundBox, b: GroundBox): OverlapResult {
  const dx = a.cx - b.cx;
  const dz = a.cz - b.cz;
  const axes: Array<[number, number]> = [
    [a.fx, a.fz],
    [a.rx, a.rz],
    [b.fx, b.fz],
    [b.rx, b.rz],
  ];
  let bestDepth = Infinity;
  let bestX = 0;
  let bestZ = 0;
  for (const [axisX, axisZ] of axes) {
    const distance = Math.abs(dx * axisX + dz * axisZ);
    const depth = projectedRadius(a, axisX, axisZ) + projectedRadius(b, axisX, axisZ) - distance;
    if (depth <= 0) return NO_OVERLAP;
    if (depth < bestDepth) {
      bestDepth = depth;
      // Direction from b toward a along this axis.
      const sign = dx * axisX + dz * axisZ >= 0 ? 1 : -1;
      bestX = axisX * sign;
      bestZ = axisZ * sign;
    }
  }
  return { overlapping: true, depthMeters: bestDepth, normalX: bestX, normalZ: bestZ };
}

/** Distance between the centres of two boxes. Used for cheap pre-checks before the full test. */
export function groundBoxCentreDistance(a: GroundBox, b: GroundBox): number {
  return Math.hypot(a.cx - b.cx, a.cz - b.cz);
}
