/*
 * Road height and grade, read from the lane graph.
 *
 * Every lane keeps the height of its centreline (offsets are horizontal), so the surface under a car is the height of
 * the nearest lane sample, interpolated along the lane. The grade is rise over run along the lane's own travel
 * direction. A car heading the other way on a road sees the opposite sign, so the lookup also takes the car's yaw.
 *
 * Lookups use a spatial grid over the lane samples. On a looping graph the query is tried at each wrap image, so a car
 * on one side of the seam finds the road on the other side. A graph where every sample is at height 0 returns zero
 * without searching, so the flat game costs nothing extra.
 *
 * Limit: the lookup is by plan position. Two roads that cross in plan at different heights (a bridge or an overpass)
 * are not told apart by height. The Division 2 district has none, and the road validator forbids them there.
 */
import type { LaneGraph, LanePath } from '../traffic/laneGraph';
import { forwardFromYaw } from '../core/coordinates';
import type { VehicleState } from '../core/types';
import { TERRAIN_CONFIG } from '../config/terrainConfig';

/** Road height and grade under a point. */
export interface RoadSurface {
  /** Height of the road surface, metres. */
  readonly heightMeters: number;
  /** Rise over run along the car's direction of travel. Positive uphill. */
  readonly grade: number;
}

export interface RoadElevation {
  /** True when every lane sample is at height zero. Lookups then return null without searching. */
  readonly isFlat: boolean;
  /**
   * Surface under (x, z) for a car with the given yaw. Yaw uses the simulation convention (forward = sin, cos). Null when
   * no road is within reach, or when the graph is flat (nothing to follow). Callers then keep the height they have.
   */
  surfaceAt(x: number, z: number, yaw: number): RoadSurface | null;
}

/** Grid cell size, metres. Roads are about 15 m wide, so a cell holds a few lanes. */
const CELL_METERS = 25;
/** A point further than this from every lane sees no road: height zero, grade zero. */
const SEARCH_METERS = 30;
/** A lane counts as aligned with the car when the cosine of the heading difference is above this (about 60 degrees). */
const ALIGNED_COSINE = 0.5;

interface Entry {
  readonly lane: LanePath;
  /** Index of the sample within lane.points. */
  readonly index: number;
}

interface Candidate {
  readonly distanceSquared: number;
  readonly entry: Entry;
  readonly cosine: number;
}

function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function cellOf(value: number): number {
  return Math.floor(value / CELL_METERS);
}

/** Builds the height lookup for a lane graph. Cheap to call once per world; the result is read-only. */
export function buildRoadElevation(graph: LaneGraph): RoadElevation {
  const grid = new Map<string, Entry[]>();
  let flat = true;
  let period: number | undefined;

  for (const lane of graph.lanes) {
    if (lane.periodMeters !== undefined) period = lane.periodMeters;
    for (let index = 0; index < lane.points.length; index += 1) {
      const point = lane.points[index];
      if (!point) continue;
      if (point.y !== 0) flat = false;
      const key = cellKey(cellOf(point.x), cellOf(point.z));
      const bucket = grid.get(key);
      const entry: Entry = { lane, index };
      if (bucket) bucket.push(entry);
      else grid.set(key, [entry]);
    }
  }

  if (flat) {
    return { isFlat: true, surfaceAt: () => null };
  }

  // Offsets of the wrap images to try. A finite graph has one image, the point itself.
  const offsets: number[] = period === undefined ? [0] : [-period, 0, period];

  function search(qx: number, qz: number, forward: { x: number; z: number }): Candidate | null {
    let best: Candidate | null = null;
    let bestAligned: Candidate | null = null;
    const cx0 = cellOf(qx - SEARCH_METERS);
    const cx1 = cellOf(qx + SEARCH_METERS);
    const cz0 = cellOf(qz - SEARCH_METERS);
    const cz1 = cellOf(qz + SEARCH_METERS);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cz = cz0; cz <= cz1; cz += 1) {
        const bucket = grid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const entry of bucket) {
          const point = entry.lane.points[entry.index];
          const heading = entry.lane.headings[entry.index] ?? 0;
          if (!point) continue;
          const dx = point.x - qx;
          const dz = point.z - qz;
          const distanceSquared = dx * dx + dz * dz;
          if (distanceSquared > SEARCH_METERS * SEARCH_METERS) continue;
          const cosine = Math.sin(heading) * forward.x + Math.cos(heading) * forward.z;
          const candidate: Candidate = { distanceSquared, entry, cosine };
          if (!best || distanceSquared < best.distanceSquared) best = candidate;
          if (cosine > ALIGNED_COSINE && (!bestAligned || distanceSquared < bestAligned.distanceSquared)) {
            bestAligned = candidate;
          }
        }
      }
    }
    // A car on a road has an aligned lane within a few metres. Fall back to the nearest lane of any heading otherwise.
    return bestAligned ?? best;
  }

  return {
    isFlat: false,
    surfaceAt(x, z, yaw) {
      const forward = forwardFromYaw(yaw);
      let chosen: Candidate | null = null;
      let image = { x, z };
      for (const ox of offsets) {
        for (const oz of offsets) {
          const qx = x + ox;
          const qz = z + oz;
          const found = search(qx, qz, forward);
          if (found && (!chosen || preferred(found, chosen))) {
            chosen = found;
            image = { x: qx, z: qz };
          }
        }
      }
      if (!chosen) return null;
      return surfaceOnLane(chosen, image.x, image.z);
    },
  };
}

/** A candidate is preferred when it is aligned and the other is not, otherwise the nearer one. */
function preferred(a: Candidate, b: Candidate): boolean {
  const aAligned = a.cosine > ALIGNED_COSINE;
  const bAligned = b.cosine > ALIGNED_COSINE;
  if (aAligned !== bAligned) return aAligned;
  return a.distanceSquared < b.distanceSquared;
}

/** Interpolates height and grade on the lane segment nearest to (qx, qz). */
function surfaceOnLane(candidate: Candidate, qx: number, qz: number): RoadSurface | null {
  const { lane, index } = candidate.entry;
  const sign = candidate.cosine >= 0 ? 1 : -1;
  // Pick the segment on either side of the nearest sample that the query projects onto more closely.
  let bestSegment: { a: number; b: number; t: number; distanceSquared: number } | null = null;
  for (const a of [index - 1, index]) {
    const b = a + 1;
    if (a < 0 || b >= lane.points.length) continue;
    const pa = lane.points[a];
    const pb = lane.points[b];
    if (!pa || !pb) continue;
    const vx = pb.x - pa.x;
    const vz = pb.z - pa.z;
    const lengthSquared = vx * vx + vz * vz;
    const t = lengthSquared > 0 ? Math.min(1, Math.max(0, ((qx - pa.x) * vx + (qz - pa.z) * vz) / lengthSquared)) : 0;
    const px = pa.x + vx * t - qx;
    const pz = pa.z + vz * t - qz;
    const distanceSquared = px * px + pz * pz;
    if (!bestSegment || distanceSquared < bestSegment.distanceSquared) bestSegment = { a, b, t, distanceSquared };
  }
  if (!bestSegment) {
    // A single-sample lane has no segment. Its own height is the surface.
    const only = lane.points[index];
    return { heightMeters: only?.y ?? 0, grade: 0 };
  }
  const pa = lane.points[bestSegment.a];
  const pb = lane.points[bestSegment.b];
  if (!pa || !pb) return null;
  const run = (lane.s[bestSegment.b] ?? 0) - (lane.s[bestSegment.a] ?? 0);
  const rise = pb.y - pa.y;
  return {
    heightMeters: pa.y + rise * bestSegment.t,
    grade: run > 0 ? (rise / run) * sign : 0,
  };
}

const elevationCache = new WeakMap<LaneGraph, RoadElevation>();

/** The height lookup for a lane graph, built once and shared by every host that uses that graph. */
export function roadElevationFor(graph: LaneGraph): RoadElevation {
  const cached = elevationCache.get(graph);
  if (cached) return cached;
  const built = buildRoadElevation(graph);
  elevationCache.set(graph, built);
  return built;
}

/**
 * The slope acceleration under a car, m/s^2, in its direction of travel: gravity times the grade. This is the value
 * stepVehicle takes. Positive uphill, so it slows a climb. Zero when there is no road to read.
 */
export function slopeAccelerationUnder(state: VehicleState, elevation: RoadElevation | null): number {
  if (!elevation) return 0;
  const grade = elevation.surfaceAt(state.position.x, state.position.z, state.yaw)?.grade ?? 0;
  return TERRAIN_CONFIG.gravityMps2 * grade;
}

/** The car with its height set to the road under it. Leaves the height alone when there is no road to follow. */
export function standOnRoad(state: VehicleState, elevation: RoadElevation | null): VehicleState {
  if (!elevation) return state;
  const surface = elevation.surfaceAt(state.position.x, state.position.z, state.yaw);
  if (!surface) return state;
  return { ...state, position: { ...state.position, y: surface.heightMeters } };
}
