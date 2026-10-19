/*
 * World wrap arithmetic (infinite looping world, Stage A). Pure functions with no state, no rendering, and no imports
 * from the simulation or the renderer.
 *
 * Three coordinate spaces. Keep them separate:
 *
 *   Logical   The simulation's position. Continuous and unbounded. A car that drives east past the east edge keeps
 *             increasing its x. Physics, velocity, heading, race progress, and career state use logical values only, so
 *             a seam crossing never moves them. Nothing is teleported.
 *   Wrapped   The logical position folded into one period, [0, period). Geometry lookups (road lanes, drivable
 *             boundary, chunk ids, the minimap) use wrapped values, or the nearest image of a wrapped value.
 *   Render    The position relative to the camera, on the shortest wrapped path. Objects are drawn at
 *             cameraRender + renderOffset(camera, logical), so the numbers the GPU sees stay small however far the car
 *             has driven.
 *
 * Boundary convention. A boundary at k * period belongs to the upper side: wrapScalar(k * period) is 0, and crossing
 * from just below to exactly the boundary counts as one crossing into cell k. Crossings are signed: +1 going east or
 * north, -1 going west or south.
 */

import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';

export interface WrapGeometry {
  /** Full wrap period on each axis, meters. */
  readonly periodMeters: number;
  /** Chunk edge length, meters. Must divide periodMeters exactly. */
  readonly chunkSizeMeters: number;
  /** Lowest chunk index of the canonical chunk range. */
  readonly chunkMin: number;
  /** Number of canonical chunk indices on each axis: chunkMin .. chunkMin + chunkCount - 1. */
  readonly chunkCount: number;
}

export interface WrappedXZ {
  readonly x: number;
  readonly z: number;
}

export interface ChunkIndex {
  readonly kx: number;
  readonly kz: number;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number, got ${value}`);
}

function assertPeriod(period: number): void {
  assertFinite(period, 'period');
  if (period <= 0) throw new RangeError(`period must be positive, got ${period}`);
}

/**
 * Maps a value into the base domain [origin, origin + period). The loop's base domain is aligned to the lattice (see
 * WORLD_WRAP_CONFIG.baseOriginMeters), so a base centred on zero is never used.
 */
export function wrapToBase(value: number, period: number, origin: number = WORLD_WRAP_CONFIG.baseOriginMeters): number {
  return origin + wrapScalar(value - origin, period);
}

/**
 * Maps any finite value into [0, period). Multiples of the period map to 0. Values just below a multiple map to just
 * below the period, so the wrapped result never equals the period.
 */
export function wrapScalar(value: number, period: number): number {
  assertFinite(value, 'value');
  assertPeriod(period);
  let wrapped = value - period * Math.floor(value / period);
  // Rounding in the division can leave the result one step outside [0, period). Fold it back.
  if (wrapped < 0) wrapped += period;
  if (wrapped >= period) wrapped -= period;
  return wrapped;
}

/**
 * Shortest signed displacement from `from` to `to` on a circle of length `period`. The result is in [-period/2,
 * period/2). Adding the displacement to `from` always lands on `to` modulo the period, and the sum of displacements
 * along a path equals the net movement, so the path's wrapped motion stays continuous across seams.
 */
export function wrapDelta(from: number, to: number, period: number): number {
  assertFinite(from, 'from');
  assertFinite(to, 'to');
  assertPeriod(period);
  const half = period / 2;
  return wrapScalar(to - from + half, period) - half;
}

/**
 * Signed number of period boundaries crossed when the logical value moves from `previous` to `next`. Zero when both are in
 * the same period. More than one when a single step moves further than one period (a very fast step or a long frame).
 */
export function boundaryCrossings(previous: number, next: number, period: number): number {
  assertFinite(previous, 'previous');
  assertFinite(next, 'next');
  assertPeriod(period);
  return Math.floor(next / period) - Math.floor(previous / period);
}

/** Wraps both axes of a point. */
export function wrapPoint(x: number, z: number, period: number): WrappedXZ {
  return { x: wrapScalar(x, period), z: wrapScalar(z, period) };
}

/**
 * Horizontal and vertical offset of a logical point from the camera, on the shortest wrapped path. Continuous across
 * seams: as an object drives across an edge, its offset changes by the step it moved, not by a period.
 */
export function renderOffset(camera: WrappedXZ | { x: number; z: number }, logical: { x: number; z: number }, period: number): WrappedXZ {
  return { x: wrapDelta(camera.x, logical.x, period), z: wrapDelta(camera.z, logical.z, period) };
}

/** Distance on the torus between two logical points: the straight line on the shortest wrapped path. */
export function wrappedDistance(a: { x: number; z: number }, b: { x: number; z: number }, period: number): number {
  const dx = wrapDelta(a.x, b.x, period);
  const dz = wrapDelta(a.z, b.z, period);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Wraps an integer index (a node, cell, or chunk index) into the canonical range [min, min + count). Used for lattice
 * indices, so index min + count is the same as index min.
 */
export function wrapIndex(index: number, min: number, count: number): number {
  if (!Number.isInteger(index)) throw new RangeError(`index must be an integer, got ${index}`);
  if (!Number.isInteger(min)) throw new RangeError(`min must be an integer, got ${min}`);
  if (!Number.isInteger(count) || count <= 0) throw new RangeError(`count must be a positive integer, got ${count}`);
  return min + ((((index - min) % count) + count) % count);
}

/** Chunk index of a logical point, on the canonical chunk range of the geometry. */
export function wrappedChunkOf(x: number, z: number, geometry: WrapGeometry): ChunkIndex {
  const kx = Math.floor(wrapScalar(x, geometry.periodMeters) / geometry.chunkSizeMeters);
  const kz = Math.floor(wrapScalar(z, geometry.periodMeters) / geometry.chunkSizeMeters);
  return {
    kx: wrapIndex(kx, geometry.chunkMin, geometry.chunkCount),
    kz: wrapIndex(kz, geometry.chunkMin, geometry.chunkCount),
  };
}

/**
 * Checks a geometry. Returns one line per problem. An empty list means the geometry is usable: the period is a whole
 * number of chunks, the chunk range covers the period exactly once, and every number is finite.
 */
export function validateWrapGeometry(geometry: WrapGeometry): string[] {
  const issues: string[] = [];
  const { periodMeters, chunkSizeMeters, chunkMin, chunkCount } = geometry;
  if (!Number.isFinite(periodMeters) || periodMeters <= 0) issues.push(`period ${periodMeters} must be a positive finite length`);
  if (!Number.isFinite(chunkSizeMeters) || chunkSizeMeters <= 0) issues.push(`chunk size ${chunkSizeMeters} must be a positive finite length`);
  if (issues.length > 0) return issues;
  const chunksPerPeriod = periodMeters / chunkSizeMeters;
  if (Math.abs(chunksPerPeriod - Math.round(chunksPerPeriod)) > 1e-9) {
    issues.push(`period ${periodMeters} m is not a whole number of ${chunkSizeMeters} m chunks`);
  }
  if (!Number.isInteger(chunkMin)) issues.push(`chunk minimum ${chunkMin} must be an integer`);
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) issues.push(`chunk count ${chunkCount} must be a positive integer`);
  if (Number.isInteger(chunkCount) && Math.abs(chunkCount - chunksPerPeriod) > 1e-9) {
    issues.push(`chunk count ${chunkCount} does not equal the ${chunksPerPeriod} chunks per period`);
  }
  return issues;
}

/**
 * The value's image nearest a reference value, on the shortest wrapped path. Identity when the world is not periodic
 * (period null), so finite-world code paths are unchanged.
 */
export function imageNear(reference: number, value: number, period: number | null): number {
  return period === null ? value : reference + wrapDelta(reference, value, period);
}

/**
 * The value's image in the base domain [origin, origin + period), which lane and lattice geometry is stored in. Identity
 * when the world is not periodic.
 */
export function baseImage(value: number, period: number | null): number {
  return period === null ? value : wrapToBase(value, period);
}
