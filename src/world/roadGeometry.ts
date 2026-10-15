import { forwardFromYaw, rightFromYaw } from '../core/coordinates';
import type { Vec3 } from '../core/types';
import type { CenterlineSample } from './roadTypes';

/*
 * Pure road geometry in simulation space (flat, y = elevation). No Three.js. Shared by the logical model,
 * the boundary model, and the mesh builders, so a visible road and its boundary come from the same numbers.
 */

export interface Pose {
  position: Vec3;
  /** Travel heading, radians. */
  heading: number;
}

/** Point offset from the centerline toward the right (positive) or left (negative) of the heading. */
export function offsetPoint(point: Vec3, heading: number, offset: number): Vec3 {
  const right = rightFromYaw(heading);
  return { x: point.x + right.x * offset, y: point.y, z: point.z + right.z * offset };
}

/** Sample count for a path length, from the maximum spacing. Always at least two samples. */
export function sampleCount(lengthMeters: number, maxSpacingMeters: number): number {
  return Math.max(2, Math.ceil(lengthMeters / maxSpacingMeters));
}

/** Centerline of a straight, from `start` for `length` meters along its heading. */
export function straightCenterline(start: Pose, length: number, maxSpacingMeters: number): CenterlineSample {
  const forward = forwardFromYaw(start.heading);
  const n = sampleCount(length, maxSpacingMeters);
  const s: number[] = [];
  const points: Vec3[] = [];
  const headings: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const d = (length * i) / n;
    s.push(d);
    points.push({ x: start.position.x + forward.x * d, y: start.position.y, z: start.position.z + forward.z * d });
    headings.push(start.heading);
  }
  return { s, points, headings };
}

/**
 * Centerline of an arc. `turnRadians` is signed: positive turns right, negative turns left.
 * The heading changes at 1/radius per meter, so the curve is a true circular arc with constant curvature.
 *
 * With k = sign(turn), the centre is `start + k·R·right(h0)`, and the point at heading h is `centre − k·R·right(h)`.
 * Both formulas were checked by hand: at h0 the point is `start`, and the travel direction is `forward(h)`.
 */
export function arcCenterline(start: Pose, radius: number, turnRadians: number, maxSpacingMeters: number): {
  centerline: CenterlineSample;
  centre: Vec3;
} {
  const k = Math.sign(turnRadians);
  const right0 = rightFromYaw(start.heading);
  const centre: Vec3 = {
    x: start.position.x + k * radius * right0.x,
    y: start.position.y,
    z: start.position.z + k * radius * right0.z,
  };
  const length = Math.abs(turnRadians) * radius;
  const n = sampleCount(length, maxSpacingMeters);
  const s: number[] = [];
  const points: Vec3[] = [];
  const headings: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const d = (length * i) / n;
    const heading = start.heading + (k * d) / radius;
    const right = rightFromYaw(heading);
    s.push(d);
    points.push({
      x: centre.x - k * radius * right.x,
      y: start.position.y,
      z: centre.z - k * radius * right.z,
    });
    headings.push(heading);
  }
  return { centerline: { s, points, headings }, centre };
}

/** Interpolated point and heading at arc length `distance`, clamped to the centerline. */
export function sampleAtDistance(centerline: CenterlineSample, distance: number): { point: Vec3; heading: number } {
  const { s, points, headings } = centerline;
  const last = s.length - 1;
  if (distance <= 0) return { point: points[0] ?? { x: 0, y: 0, z: 0 }, heading: headings[0] ?? 0 };
  if (distance >= (s[last] ?? 0)) return { point: points[last] ?? { x: 0, y: 0, z: 0 }, heading: headings[last] ?? 0 };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((s[mid] ?? 0) <= distance) lo = mid;
    else hi = mid;
  }
  const s0 = s[lo] ?? 0;
  const s1 = s[hi] ?? s0;
  const t = s1 > s0 ? (distance - s0) / (s1 - s0) : 0;
  const p0 = points[lo] ?? { x: 0, y: 0, z: 0 };
  const p1 = points[hi] ?? p0;
  const h0 = headings[lo] ?? 0;
  const h1 = headings[hi] ?? h0;
  return {
    point: { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: p0.z + (p1.z - p0.z) * t },
    heading: h0 + (h1 - h0) * t,
  };
}

/** Axis-aligned bounds in XZ of a centerline widened by `halfWidth` on each side. */
export function bounds2d(points: Vec3[], halfWidth: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX: minX - halfWidth, maxX: maxX + halfWidth, minZ: minZ - halfWidth, maxZ: maxZ + halfWidth };
}
