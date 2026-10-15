import { forwardFromYaw, rightFromYaw } from '../core/coordinates';
import { TWO_PI } from '../core/math';
import type { VehicleState } from '../core/types';
import type { VehicleConfig } from '../config/vehicleConfig';
import type { RoadNetwork, RoadSegment } from '../world/roadTypes';

/*
 * Arcade road boundary (Part 3). Custom code, no physics engine.
 *
 * The drivable region is the union of every segment's footprint: a rectangle for straights and dead-end spurs, an
 * annular sector for arcs, and a square for junction pads. Each footprint extends to the outer shoulder edge, so the
 * union is the region where the car may drive. Its boundary is where guardrails stand. Open junction mouths are not
 * boundary, because the pad and the arm share a border there.
 *
 * Signed distance: negative inside the drivable region, positive outside. Outside the region the union value is exact
 * (the distance to the nearest shape), so the car is pushed out along the true gradient. Inside the region the value
 * is the most negative per-shape distance. Its sign is always right, but its depth can be underestimated where two
 * shapes share a joint, because that joint is interior to the union.
 *
 * Constraint rules (applied after each fixed step, and only here):
 *   - Corners of the footprint are tested. Any corner outside the region is pushed back along the gradient, at most
 *   three iterations per step. The push moves the position only.
 *   - The velocity component along the outward normal is removed. Speed and lateral speed are rebuilt from the
 *     corrected world velocity, so the movement model keeps running from consistent values.
 *   - On contact, the remaining tangential speed is multiplied by a small retention factor, so a wall scrubs speed
 *     but never holds the car still.
 *   - Forces are never added. Nothing here accelerates the car, and the physics engine is not involved.
 */

const BOX_KIND = 'box';
const ARC_KIND = 'arc';

interface BoxShape {
  kind: typeof BOX_KIND;
  segmentId: string;
  /** Centre in XZ. */
  cx: number;
  cz: number;
  /** Local axes: forward (sin h, cos h) and right (cos h, -sin h). Axis-aligned boxes use h = 0. */
  heading: number;
  halfAlong: number;
  halfAcross: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface ArcShape {
  kind: typeof ARC_KIND;
  segmentId: string;
  cx: number;
  cz: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  /** Signed angular sweep in the atan2(z, x) frame. */
  sweep: number;
  /** Cap endpoints, precomputed: [inner0, outer0, inner1, outer1]. */
  cap0Inner: { x: number; z: number };
  cap0Outer: { x: number; z: number };
  cap1Inner: { x: number; z: number };
  cap1Outer: { x: number; z: number };
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type BoundaryShape = BoxShape | ArcShape;

export interface RoadBoundary {
  shapes: BoundaryShape[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SignedDistanceResult {
  distance: number;
  segmentId: string | null;
}

/** Gradient sampling distance, meters. */
export const GRADIENT_EPSILON_METERS = 0.02;
/** Extra clearance applied after a push, so the next test does not re-trigger on the same surface. */
export const PUSH_CLEARANCE_METERS = 0.002;
/** Maximum push-out iterations per fixed step. */
export const MAX_PUSH_ITERATIONS = 3;

function boxSignedDistance(shape: BoxShape, x: number, z: number): number {
  const dx = x - shape.cx;
  const dz = z - shape.cz;
  const forward = forwardFromYaw(shape.heading);
  const right = rightFromYaw(shape.heading);
  const u = Math.abs(dx * forward.x + dz * forward.z) - shape.halfAlong;
  const v = Math.abs(dx * right.x + dz * right.z) - shape.halfAcross;
  const outside = Math.hypot(Math.max(u, 0), Math.max(v, 0));
  return outside + Math.min(Math.max(u, v), 0);
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lengthSq)) : 0;
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

/**
 * Exact signed distance to an annular sector. Angles are measured with atan2(z, x). The sector runs from startAngle
 * through `sweep`. Points whose angle lies in the sector use the radial distance, with the caps as a fallback. Points
 * outside the angular range are closest to a cap.
 */
function arcSignedDistance(shape: ArcShape, x: number, z: number): number {
  const dx = x - shape.cx;
  const dz = z - shape.cz;
  const radius = Math.hypot(dx, dz);
  const capDistance = Math.min(
    distanceToSegment(x, z, shape.cap0Inner.x, shape.cap0Inner.z, shape.cap0Outer.x, shape.cap0Outer.z),
    distanceToSegment(x, z, shape.cap1Inner.x, shape.cap1Inner.z, shape.cap1Outer.x, shape.cap1Outer.z),
  );

  const sweepSign = Math.sign(shape.sweep) || 1;
  const sweepMagnitude = Math.abs(shape.sweep);
  const angle = Math.atan2(dz, dx);
  const along = ((((angle - shape.startAngle) * sweepSign) % TWO_PI) + TWO_PI) % TWO_PI;
  const inAngularRange = along <= sweepMagnitude;

  if (!inAngularRange) return capDistance;

  const radialDistance = Math.abs(radius - (shape.innerRadius + shape.outerRadius) / 2) - (shape.outerRadius - shape.innerRadius) / 2;
  if (radialDistance <= 0) {
    // Inside the annulus: negative distance to the nearest boundary piece.
    return -Math.min(-radialDistance, capDistance);
  }
  return Math.min(radialDistance, capDistance);
}

function shapeSignedDistance(shape: BoundaryShape, x: number, z: number): number {
  return shape.kind === BOX_KIND ? boxSignedDistance(shape, x, z) : arcSignedDistance(shape, x, z);
}

/** Distance from a point to a shape's bounding box, a lower bound on the shape's distance. Used to skip far shapes. */
function boundsLowerBound(shape: BoundaryShape, x: number, z: number): number {
  const dx = Math.max(shape.minX - x, 0, x - shape.maxX);
  const dz = Math.max(shape.minZ - z, 0, z - shape.maxZ);
  return Math.hypot(dx, dz);
}

function boxShapeFromSegment(segment: RoadSegment, heading: number, centre: { x: number; z: number }, halfAlong: number, halfAcross: number): BoxShape {
  const forward = forwardFromYaw(heading);
  const right = rightFromYaw(heading);
  const ex = Math.abs(forward.x) * halfAlong + Math.abs(right.x) * halfAcross;
  const ez = Math.abs(forward.z) * halfAlong + Math.abs(right.z) * halfAcross;
  return {
    kind: BOX_KIND,
    segmentId: segment.id,
    cx: centre.x,
    cz: centre.z,
    heading,
    halfAlong,
    halfAcross,
    minX: centre.x - ex,
    maxX: centre.x + ex,
    minZ: centre.z - ez,
    maxZ: centre.z + ez,
  };
}

/** Builds the boundary shapes for every segment of a network. Deterministic, pure. */
export function buildRoadBoundary(network: RoadNetwork): RoadBoundary {
  const shapes: BoundaryShape[] = [];
  for (const segment of network.segments) {
    const halfWidth = segment.boundaryHalfWidthMeters;
    if (segment.kind === 'junction' && segment.junction) {
      const c = segment.junction.centre;
      shapes.push(boxShapeFromSegment(segment, 0, { x: c.x, z: c.z }, halfWidth, halfWidth));
    } else if (segment.kind === 'straight') {
      const start = segment.ports.find((port) => port.id === 'start');
      const end = segment.ports.find((port) => port.id === 'end');
      if (!start || !end) throw new Error(`Straight ${segment.id} is missing a port.`);
      const heading = Math.atan2(end.position.x - start.position.x, end.position.z - start.position.z);
      const length = Math.hypot(end.position.x - start.position.x, end.position.z - start.position.z);
      const centre = { x: (start.position.x + end.position.x) / 2, z: (start.position.z + end.position.z) / 2 };
      shapes.push(boxShapeFromSegment(segment, heading, centre, length / 2, halfWidth));
    } else if (segment.kind === 'arc' && segment.arc) {
      shapes.push(arcShapeFromSegment(segment, segment.arc.centre.x, segment.arc.centre.z, segment.arc.radiusMeters, segment.arc.turnRadians, halfWidth));
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const shape of shapes) {
    minX = Math.min(minX, shape.minX);
    maxX = Math.max(maxX, shape.maxX);
    minZ = Math.min(minZ, shape.minZ);
    maxZ = Math.max(maxZ, shape.maxZ);
  }
  return { shapes, minX, maxX, minZ, maxZ };
}

function arcShapeFromSegment(segment: RoadSegment, cx: number, cz: number, radius: number, turnRadians: number, halfWidth: number): ArcShape {
  const start = segment.ports.find((port) => port.id === 'start');
  const end = segment.ports.find((port) => port.id === 'end');
  if (!start || !end) throw new Error(`Arc ${segment.id} is missing a port.`);
  // Sweep in the atan2(z, x) frame. The point moves through angle -turn about the centre, so this is -turnRadians.
  const sweep = -turnRadians;
  const startAngle = Math.atan2(start.position.z - cz, start.position.x - cx);
  const innerRadius = radius - halfWidth;
  const outerRadius = radius + halfWidth;
  const endAngle = startAngle + sweep;
  const at = (angle: number, r: number) => ({ x: cx + r * Math.cos(angle), z: cz + r * Math.sin(angle) });
  const cap0Inner = at(startAngle, innerRadius);
  const cap0Outer = at(startAngle, outerRadius);
  const cap1Inner = at(endAngle, innerRadius);
  const cap1Outer = at(endAngle, outerRadius);

  // Bounding box: all four cap points, plus any axis extreme of the arc inside the sweep.
  const xs: number[] = [cap0Inner.x, cap0Outer.x, cap1Inner.x, cap1Outer.x];
  const zs: number[] = [cap0Inner.z, cap0Outer.z, cap1Inner.z, cap1Outer.z];
  for (const axisAngle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const along = ((((axisAngle - startAngle) * Math.sign(sweep || 1)) % TWO_PI) + TWO_PI) % TWO_PI;
    if (along <= Math.abs(sweep)) {
      xs.push(cx + outerRadius * Math.cos(axisAngle), cx + innerRadius * Math.cos(axisAngle));
      zs.push(cz + outerRadius * Math.sin(axisAngle), cz + innerRadius * Math.sin(axisAngle));
    }
  }
  return {
    kind: ARC_KIND,
    segmentId: segment.id,
    cx,
    cz,
    innerRadius,
    outerRadius,
    startAngle,
    sweep,
    cap0Inner,
    cap0Outer,
    cap1Inner,
    cap1Outer,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Signed distance to the drivable region, and the id of the nearest segment. Negative inside. */
export function signedDistance(boundary: RoadBoundary, x: number, z: number): SignedDistanceResult {
  let best = Infinity;
  let bestId: string | null = null;
  for (const shape of boundary.shapes) {
    // A shape's distance is at least its bounding-box distance, so it cannot beat `best` if that bound already does not.
    if (boundsLowerBound(shape, x, z) >= best) continue;
    const d = shapeSignedDistance(shape, x, z);
    // Union: take the smallest signed distance. Inside any shape is negative, so the minimum is correct.
    if (d < best) {
      best = d;
      bestId = shape.segmentId;
    }
  }
  return { distance: best, segmentId: bestId };
}

/** Outward unit normal of the boundary at (x, z), from the numeric gradient of the signed distance. */
export function normalAt(boundary: RoadBoundary, x: number, z: number): { x: number; z: number } {
  const e = GRADIENT_EPSILON_METERS;
  const gx = signedDistance(boundary, x + e, z).distance - signedDistance(boundary, x - e, z).distance;
  const gz = signedDistance(boundary, x, z + e).distance - signedDistance(boundary, x, z - e).distance;
  const length = Math.hypot(gx, gz);
  if (!(length > 1e-9)) return { x: 0, z: 0 };
  return { x: gx / length, z: gz / length };
}

export interface ConstraintFootprint {
  rearMeters: number;
  frontMeters: number;
  halfWidthMeters: number;
  tangentialRetentionPerStep: number;
}

export function footprintFromConfig(config: VehicleConfig): ConstraintFootprint {
  return {
    rearMeters: config.footprintRearMeters,
    frontMeters: config.footprintFrontMeters,
    halfWidthMeters: config.footprintHalfWidthMeters,
    tangentialRetentionPerStep: config.wallTangentialRetentionPerStep,
  };
}

export interface ConstraintResult {
  state: VehicleState;
  /** True when at least one footprint corner was outside the drivable region before correction. */
  contact: boolean;
  /** Segment nearest the car after correction, or null when the boundary is empty. */
  segmentId: string | null;
  /** Largest outside distance found before correction, meters. Zero when there was no contact. */
  maxPenetrationMeters: number;
}

/** Footprint corners in world XZ, from the rear-axle position and heading. */
function footprintCorners(x: number, z: number, yaw: number, fp: ConstraintFootprint): Array<{ x: number; z: number }> {
  const forward = forwardFromYaw(yaw);
  const right = rightFromYaw(yaw);
  const corners: Array<{ x: number; z: number }> = [];
  for (const along of [fp.frontMeters, -fp.rearMeters]) {
    for (const side of [fp.halfWidthMeters, -fp.halfWidthMeters]) {
      corners.push({
        x: x + forward.x * along + right.x * side,
        z: z + forward.z * along + right.z * side,
      });
    }
  }
  return corners;
}

/**
 * Keeps the car inside the drivable region. Pure: returns a new state. Only the position and the two velocity components
 * change. Heading, steer, pedals, and the cosmetic body are untouched, so the movement model is not fought.
 */
export function constrainVehicleToRoad(state: VehicleState, boundary: RoadBoundary, fp: ConstraintFootprint): ConstraintResult {
  if (boundary.shapes.length === 0) {
    return { state, contact: false, segmentId: null, maxPenetrationMeters: 0 };
  }

  let x = state.position.x;
  let z = state.position.z;
  let contact = false;
  let maxPenetration = 0;
  let contactNormal: { x: number; z: number } | null = null;

  for (let iteration = 0; iteration < MAX_PUSH_ITERATIONS; iteration += 1) {
    const corners = footprintCorners(x, z, state.yaw, fp);
    let worstDistance = 0;
    let worstCorner: { x: number; z: number } | null = null;
    for (const corner of corners) {
      const d = signedDistance(boundary, corner.x, corner.z).distance;
      if (d > worstDistance) {
        worstDistance = d;
        worstCorner = corner;
      }
    }
    if (!worstCorner || worstDistance <= 0) break;

    const n = normalAt(boundary, worstCorner.x, worstCorner.z);
    if (iteration === 0) {
      contact = true;
      maxPenetration = worstDistance;
      contactNormal = n;
    }
    // Push the car back along the normal, by the outside distance plus a clearance.
    const push = worstDistance + PUSH_CLEARANCE_METERS;
    x -= n.x * push;
    z -= n.z * push;
  }

  if (!contact) {
    const nearest = signedDistance(boundary, x, z).segmentId;
    return { state, contact: false, segmentId: nearest, maxPenetrationMeters: 0 };
  }

  // Velocity: remove the outward normal component, then scrub the tangential part slightly.
  const forward = forwardFromYaw(state.yaw);
  const right = rightFromYaw(state.yaw);
  let vx = forward.x * state.speed + right.x * state.lateralSpeed;
  let vz = forward.z * state.speed + right.z * state.lateralSpeed;
  const n = contactNormal ?? { x: 0, z: 0 };
  const outward = vx * n.x + vz * n.z;
  if (outward > 0) {
    vx -= outward * n.x;
    vz -= outward * n.z;
  }
  vx *= fp.tangentialRetentionPerStep;
  vz *= fp.tangentialRetentionPerStep;

  const speed = vx * forward.x + vz * forward.z;
  const lateralSpeed = vx * right.x + vz * right.z;
  const nearest = signedDistance(boundary, x, z).segmentId;

  return {
    state: {
      ...state,
      position: { x, y: state.position.y, z },
      speed,
      lateralSpeed,
    },
    contact: true,
    segmentId: nearest,
    maxPenetrationMeters: maxPenetration,
  };
}

