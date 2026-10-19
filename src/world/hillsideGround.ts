/*
 * The ground under the hillside. One function gives the height of the ground at any plan point. The terrain mesh, the
 * street lamps, and the pine trees all read it, so they stand on the same surface.
 *
 * The ground is the natural slope (bilinear through the node heights of each cell) with the roads carved in. Near a road
 * the ground is pulled down to the road's height, minus a small clearance, so asphalt never sits below the ground. The
 * carve is full within the road's boundary, and blends back to the natural slope over a short ramp. Where the natural
 * slope is already at the road height, the carve changes nothing. The flat city (every height zero) is unchanged.
 *
 * Pure: no Three.js. Points are in base coordinates. On a looping network, a point is wrapped into the base period, and
 * roads one period away are checked too, so the seam is seamless.
 */
import { NETWORK_BOUNDARY_HALF_WIDTH_METERS, NETWORK_ROAD_HALF_WIDTH_METERS } from '../config/roadConfig';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { CITY_NODE_SPACING_METERS, nodeHeightMeters } from './city/cityLayout';
import { wrapToBase } from './wrap/worldWrap';
import type { RoadNetwork } from './roadTypes';

export interface HillsideGround {
  /** Ground height under the plan point (x, z), metres. */
  heightAt(x: number, z: number): number;
  /** Plan distance from (x, z) to the nearest road centreline or junction pad, metres. Infinity when none is in reach. */
  roadDistanceAt(x: number, z: number): number;
}

/**
 * The ground sits this far below a road's surface, at every height. A constant gap: at zero it would meet the asphalt at
 * the same height, and the two surfaces would flicker where they overlap.
 */
export const GROUND_CLEARANCE_METERS = 0.1;
/** Full carve within this distance of a road: its boundary, which covers the shoulder. */
const CARVE_FULL_METERS = NETWORK_BOUNDARY_HALF_WIDTH_METERS;
/** The carve fades to the natural slope over this distance beyond the boundary. */
const CARVE_RAMP_METERS = 10;
/** Asphalt half-width. A point within it of a street's centreline is on that street's asphalt. */
const ASPHALT_HALF_METERS = NETWORK_ROAD_HALF_WIDTH_METERS;
/** Beyond this distance from every road, the ground is the natural slope. */
export const GROUND_REACH_METERS = CARVE_FULL_METERS + CARVE_RAMP_METERS;

const BUCKET_METERS = 25;
const BUCKET_SPAN = Math.ceil((GROUND_REACH_METERS + 25) / BUCKET_METERS);

/** Ground for a network with no hillside and no roads to carve. Used by flat fixtures and tests. */
export const FLAT_GROUND: HillsideGround = {
  heightAt: () => 0,
  roadDistanceAt: () => Infinity,
};

interface Edge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ay: number;
  by: number;
}

interface Pad {
  x: number;
  z: number;
  half: number;
  y: number;
}

interface Nearest {
  distance: number;
  y: number;
  /** The lowest height of any asphalt that covers the point (a street within its half-width, or inside a pad). Null if none covers it. */
  coverY: number | null;
}

const cache = new WeakMap<RoadNetwork, HillsideGround>();

/** The ground for a network, built once and shared by everything that reads it. */
export function hillsideGroundFor(network: RoadNetwork): HillsideGround {
  const cached = cache.get(network);
  if (cached) return cached;
  const built = buildGround(network);
  cache.set(network, built);
  return built;
}

function bucketKey(bx: number, bz: number): string {
  return `${bx},${bz}`;
}

function bucketOf(value: number): number {
  return Math.floor(value / BUCKET_METERS);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Natural slope: bilinear through the node heights of the cell that holds (x, z). Node (i, j) is at (i - 2, j - 2) * 200. */
function naturalGround(x: number, z: number): number {
  const spacing = CITY_NODE_SPACING_METERS;
  const i = Math.floor(x / spacing) + 2;
  const j = Math.floor(z / spacing) + 2;
  const u = x / spacing - (i - 2);
  const v = z / spacing - (j - 2);
  const h00 = nodeHeightMeters(i, j);
  const h10 = nodeHeightMeters(i + 1, j);
  const h01 = nodeHeightMeters(i, j + 1);
  const h11 = nodeHeightMeters(i + 1, j + 1);
  return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
}

function buildGround(network: RoadNetwork): HillsideGround {
  const edgeBuckets = new Map<string, Edge[]>();
  const padBuckets = new Map<string, Pad[]>();

  for (const segment of network.segments) {
    if (segment.kind === 'junction' && segment.junction) {
      const c = segment.junction.centre;
      const pad: Pad = { x: c.x, z: c.z, half: segment.junction.halfSizeMeters, y: c.y };
      const key = bucketKey(bucketOf(c.x), bucketOf(c.z));
      const bucket = padBuckets.get(key);
      if (bucket) bucket.push(pad);
      else padBuckets.set(key, [pad]);
      continue;
    }
    const points = segment.centerline?.points;
    if (!points) continue;
    for (let k = 1; k < points.length; k += 1) {
      const a = points[k - 1];
      const b = points[k];
      if (!a || !b) continue;
      const edge: Edge = { ax: a.x, az: a.z, bx: b.x, bz: b.z, ay: a.y, by: b.y };
      const key = bucketKey(bucketOf((a.x + b.x) / 2), bucketOf((a.z + b.z) / 2));
      const bucket = edgeBuckets.get(key);
      if (bucket) bucket.push(edge);
      else edgeBuckets.set(key, [edge]);
    }
  }

  const period = network.periodMeters ?? null;
  // The base domain is [origin, origin + period), aligned to the lattice. Roads of the loop sit inside it.
  const origin = WORLD_WRAP_CONFIG.baseOriginMeters;
  // A point this close to the base domain's edge also needs the roads one period away.
  const imageMargin = GROUND_REACH_METERS + 25;

  function wrapCoordinate(value: number): number {
    if (period === null) return value;
    return wrapToBase(value, period, origin);
  }

  function imagesOf(value: number): number[] {
    if (period === null) return [value];
    const images = [value];
    if (value < origin + imageMargin) images.push(value + period);
    if (value > origin + period - imageMargin) images.push(value - period);
    return images;
  }

  /** Nearest road to the wrapped point, over the images that can be in reach. Null when no road is in reach. */
  function nearest(x: number, z: number): Nearest | null {
    let best: { distance: number; y: number } | null = null;
    let coverY: number | null = null;
    for (const qx of imagesOf(x)) {
      for (const qz of imagesOf(z)) {
        const bx = bucketOf(qx);
        const bz = bucketOf(qz);
        for (let dx = -BUCKET_SPAN; dx <= BUCKET_SPAN; dx += 1) {
          for (let dz = -BUCKET_SPAN; dz <= BUCKET_SPAN; dz += 1) {
            const key = bucketKey(bx + dx, bz + dz);
            for (const edge of edgeBuckets.get(key) ?? []) {
              const ex = edge.bx - edge.ax;
              const ez = edge.bz - edge.az;
              const lengthSquared = ex * ex + ez * ez;
              const t = lengthSquared > 0 ? Math.min(1, Math.max(0, ((qx - edge.ax) * ex + (qz - edge.az) * ez) / lengthSquared)) : 0;
              const px = edge.ax + ex * t - qx;
              const pz = edge.az + ez * t - qz;
              const distance = Math.hypot(px, pz);
              const y = edge.ay + (edge.by - edge.ay) * t;
              if (!best || distance < best.distance) best = { distance, y };
              // A micrometre of slack, so an edge point is not lost to floating-point error.
              if (distance <= ASPHALT_HALF_METERS + 1e-6) coverY = coverY === null ? y : Math.min(coverY, y);
            }
            for (const pad of padBuckets.get(key) ?? []) {
              const ox = Math.max(Math.abs(qx - pad.x) - pad.half, 0);
              const oz = Math.max(Math.abs(qz - pad.z) - pad.half, 0);
              const distance = Math.hypot(ox, oz);
              if (!best || distance < best.distance) best = { distance, y: pad.y };
              if (distance === 0) coverY = coverY === null ? pad.y : Math.min(coverY, pad.y);
            }
          }
        }
      }
    }
    if (best === null || best.distance >= GROUND_REACH_METERS) return null;
    return { distance: best.distance, y: best.y, coverY };
  }

  return {
    heightAt(x, z) {
      const wx = wrapCoordinate(x);
      const wz = wrapCoordinate(z);
      const base = naturalGround(wx, wz);
      const near = nearest(wx, wz);
      if (!near) return base;
      // On asphalt, the ground is the lowest asphalt beneath the point, minus the clearance. Off it, the carve blends in
      // from the nearest road.
      if (near.coverY !== null) return near.coverY - GROUND_CLEARANCE_METERS;
      const target = near.y - GROUND_CLEARANCE_METERS;
      const weight = 1 - smoothstep(CARVE_FULL_METERS, GROUND_REACH_METERS, near.distance);
      return base + (target - base) * weight;
    },
    roadDistanceAt(x, z) {
      const near = nearest(wrapCoordinate(x), wrapCoordinate(z));
      return near ? near.distance : Infinity;
    },
  };
}
