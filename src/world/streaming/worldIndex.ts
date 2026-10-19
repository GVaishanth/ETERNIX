import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import type { RoadNetwork, RoadSegment } from '../roadTypes';
import { chunkKey, chunkOfPoint, chunkRange, type ChunkBounds, type ChunkCoord } from './chunkGrid';
import { buildPeriodTouches, chunkPeriodFor, type ChunkPeriod, type PeriodTouch } from './periodicChunks';

/*
 * World index. Persistent, pure data that maps the road network onto chunks. It is built once per world and kept for
 * the session. It holds no meshes.
 *
 * Ownership. Each segment has exactly one owning chunk, chosen from its anchor: a junction's centre, or the midpoint of
 * a street's centreline. Owners decide what a chunk renders. A segment may extend into a neighbouring chunk, so its
 * footprint (bounding box, grown by the boundary half-width) is also indexed. The streaming rule in wantedChunks.ts
 * uses the footprints, so a segment that touches a loaded area always has its owner loaded.
 */

export interface SegmentFootprint {
  readonly segmentId: string;
  readonly owner: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface WorldIndex {
  readonly sizeMeters: number;
  readonly network: RoadNetwork;
  /** Segment id to the key of its owning chunk. Covers every segment exactly once. */
  readonly segmentOwner: ReadonlyMap<string, string>;
  /** Owning chunk key to the ids of the segments it renders, in network order. */
  readonly chunkSegments: ReadonlyMap<string, readonly string[]>;
  readonly footprints: readonly SegmentFootprint[];
  /** Every chunk with content, keyed by chunk key. */
  readonly chunks: ReadonlyMap<string, ChunkCoord>;
  /** Bounds of the chunk grid that contains content. */
  readonly extent: ChunkBounds;
  /**
   * Torus period of a looping network, or null for a finite one. When set, `chunks` and `chunkSegments` hold canonical
   * chunks only, and the streamer maps logical chunk keys onto them.
   */
  readonly period: ChunkPeriod | null;
  /** Canonical chunk key to the footprint owners that touch it, with their image shift. Empty for finite worlds. */
  readonly touches: ReadonlyMap<string, readonly PeriodTouch[]>;
}

/** Anchor point of a segment: the junction centre, or the centreline point nearest half its length. */
export function anchorOf(segment: RoadSegment): { x: number; z: number } {
  if (segment.kind === 'junction' && segment.junction) {
    return { x: segment.junction.centre.x, z: segment.junction.centre.z };
  }
  const line = segment.centerline;
  if (!line || line.points.length === 0) {
    throw new Error(`Segment ${segment.id} has no centreline or junction to anchor it`);
  }
  const half = segment.lengthMeters / 2;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < line.s.length; i += 1) {
    const distance = Math.abs((line.s[i] ?? 0) - half);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  const point = line.points[best] ?? line.points[0];
  if (!point) throw new Error(`Segment ${segment.id} has an empty centreline`);
  return { x: point.x, z: point.z };
}

/** Footprint of a segment in plan view, grown by its boundary half-width so shoulders and guardrails are included. */
export function footprintOf(segment: RoadSegment): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const grow = segment.boundaryHalfWidthMeters;
  if (segment.kind === 'junction' && segment.junction) {
    const { x, z } = segment.junction.centre;
    const h = segment.junction.halfSizeMeters;
    return { minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h };
  }
  const line = segment.centerline;
  if (!line || line.points.length === 0) {
    throw new Error(`Segment ${segment.id} has no footprint`);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of line.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX: minX - grow, maxX: maxX + grow, minZ: minZ - grow, maxZ: maxZ + grow };
}

/**
 * Builds the index. `extraChunks` lists chunks that have content without a segment (none in the city today). Throws on
 * a duplicate segment id, because ownership would be ambiguous.
 */
export function buildWorldIndex(network: RoadNetwork, sizeMeters: number, extraChunks: readonly ChunkCoord[] = []): WorldIndex {
  if (!(sizeMeters > 0) || !Number.isFinite(sizeMeters)) throw new Error(`Chunk size must be a positive number, got ${sizeMeters}`);
  const segmentOwner = new Map<string, string>();
  const chunkSegments = new Map<string, string[]>();
  const chunks = new Map<string, ChunkCoord>();
  const footprints: SegmentFootprint[] = [];

  for (const segment of network.segments) {
    if (segmentOwner.has(segment.id)) throw new Error(`Duplicate segment id ${segment.id}`);
    const anchor = anchorOf(segment);
    const owner = chunkOfPoint(anchor.x, anchor.z, sizeMeters);
    const key = chunkKey(owner);
    segmentOwner.set(segment.id, key);
    const list = chunkSegments.get(key) ?? [];
    list.push(segment.id);
    chunkSegments.set(key, list);
    chunks.set(key, owner);
    const box = footprintOf(segment);
    footprints.push({ segmentId: segment.id, owner: key, ...box });
  }
  for (const coord of extraChunks) chunks.set(chunkKey(coord), coord);

  let minKx = Infinity;
  let maxKx = -Infinity;
  let minKz = Infinity;
  let maxKz = -Infinity;
  for (const coord of chunks.values()) {
    minKx = Math.min(minKx, coord.kx);
    maxKx = Math.max(maxKx, coord.kx);
    minKz = Math.min(minKz, coord.kz);
    maxKz = Math.max(maxKz, coord.kz);
  }
  const extent: ChunkBounds =
    chunks.size === 0
      ? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
      : {
          minX: minKx * sizeMeters,
          maxX: (maxKx + 1) * sizeMeters,
          minZ: minKz * sizeMeters,
          maxZ: (maxKz + 1) * sizeMeters,
        };
  const period = network.periodMeters !== undefined ? chunkPeriodFor(network.periodMeters, sizeMeters, WORLD_WRAP_CONFIG.baseOriginMeters) : null;
  const touches: Map<string, PeriodTouch[]> = period
    ? buildPeriodTouches(footprints, (footprint) => {
        const owner = chunks.get(footprint.owner);
        if (!owner) throw new Error(`Footprint owned by ${footprint.owner} has no chunk`);
        return owner;
      }, period)
    : new Map();
  return { sizeMeters, network, segmentOwner, chunkSegments, footprints, chunks, extent, period, touches };
}

/** Chunk keys that a footprint touches. Used by continuity checks and by the wanted-chunk rule. */
export function chunksTouchedBy(box: { minX: number; maxX: number; minZ: number; maxZ: number }, sizeMeters: number): ChunkCoord[] {
  const xs = chunkRange(box.minX, box.maxX, sizeMeters);
  const zs = chunkRange(box.minZ, box.maxZ, sizeMeters);
  const out: ChunkCoord[] = [];
  for (let kx = xs.from; kx <= xs.to; kx += 1) {
    for (let kz = zs.from; kz <= zs.to; kz += 1) out.push({ kx, kz });
  }
  return out;
}
