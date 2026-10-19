import { wrapIndex, wrapToBase } from '../wrap/worldWrap';
import { chunkKey, chunkRange, parseChunkKey, type ChunkCoord } from './chunkGrid';

/*
 * Chunk coordinates on a torus. The streamer works in logical chunk coordinates, which are unbounded: the car's logical
 * position is never wrapped, so the set of loaded chunks changes smoothly as the car drives across a seam. Content is
 * stored once per canonical chunk, in the base domain [origin, origin + period). A logical chunk is the canonical chunk plus
 * a whole number of periods (its image). Its geometry is drawn at that image offset.
 *
 * Finite worlds have no ChunkPeriod, and none of this applies to them.
 */

/** The footprint fields the period needs. Structural, so this module does not import worldIndex (no cycle). */
export interface PeriodFootprint {
  readonly owner: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface ChunkPeriod {
  readonly sizeMeters: number;
  readonly periodMeters: number;
  /** Chunks per period on each axis. Any whole number: the base domain is aligned to the chunk grid, not centred. */
  readonly chunksPerPeriod: number;
  /** Lowest canonical chunk index on each axis. The canonical range is [minChunk, minChunk + chunksPerPeriod). */
  readonly minChunk: number;
}

/** A canonical chunk reached from a footprint's base cell, and the image shift that cell carries. */
export interface PeriodTouch {
  /** Canonical key of the segment's owning chunk. */
  readonly owner: ChunkCoord;
  /** Image of the base cell, relative to its canonical chunk. A footprint cell one period east has shift 1. */
  readonly shiftX: number;
  readonly shiftZ: number;
}

/**
 * Builds the period for a torus. The base domain starts at originMeters, which must lie on the chunk grid, so the
 * canonical chunks are origin / size, and so on for chunksPerPeriod chunks. Throws when the period is not a whole number
 * of chunks, or the origin is not on the chunk grid.
 */
export function chunkPeriodFor(periodMeters: number, sizeMeters: number, originMeters: number): ChunkPeriod {
  if (!(periodMeters > 0) || !(sizeMeters > 0)) throw new RangeError('period and chunk size must be positive');
  const count = periodMeters / sizeMeters;
  if (!Number.isInteger(count)) {
    throw new RangeError(`period ${periodMeters} m must be a whole number of ${sizeMeters} m chunks`);
  }
  const minChunk = originMeters / sizeMeters;
  if (!Number.isInteger(minChunk)) {
    throw new RangeError(`base origin ${originMeters} m must lie on the ${sizeMeters} m chunk grid`);
  }
  return { sizeMeters, periodMeters, chunksPerPeriod: count, minChunk };
}

/**
 * The streamer keeps chunks within loadRadius + keepMargin of the car. Two images of one chunk are a period apart, so
 * both can be wanted at once only if the radius is at least half a period. Throws when the streaming radius reaches that.
 */
export function assertStreamingFitsPeriod(period: ChunkPeriod, maxStreamingRadiusMeters: number): void {
  if (maxStreamingRadiusMeters >= period.periodMeters / 2) {
    throw new RangeError(
      `streaming radius ${maxStreamingRadiusMeters} m must stay below half the period (${period.periodMeters / 2} m)`,
    );
  }
}

/** Canonical chunk of a logical chunk: the same chunk in the base domain. */
export function canonicalChunk(period: ChunkPeriod, coord: ChunkCoord): ChunkCoord {
  return {
    kx: wrapIndex(coord.kx, period.minChunk, period.chunksPerPeriod),
    kz: wrapIndex(coord.kz, period.minChunk, period.chunksPerPeriod),
  };
}

/** Number of whole periods between a logical chunk and its canonical chunk, on each axis. */
export function chunkImage(period: ChunkPeriod, coord: ChunkCoord): { mx: number; mz: number } {
  return {
    mx: Math.floor((coord.kx - period.minChunk) / period.chunksPerPeriod),
    mz: Math.floor((coord.kz - period.minChunk) / period.chunksPerPeriod),
  };
}

/** Logical chunk for a canonical chunk at image (mx, mz). */
export function logicalChunk(period: ChunkPeriod, canonical: ChunkCoord, mx: number, mz: number): ChunkCoord {
  return { kx: canonical.kx + mx * period.chunksPerPeriod, kz: canonical.kz + mz * period.chunksPerPeriod };
}

/**
 * Builds the table that makes footprint ownership continuous across a seam. A footprint is in base space. Every base
 * cell it touches maps to a canonical chunk, and that chunk's logical copies must load the owner at the matching image.
 */
export function buildPeriodTouches(
  footprints: readonly PeriodFootprint[],
  ownerOf: (footprint: PeriodFootprint) => ChunkCoord,
  period: ChunkPeriod,
): Map<string, PeriodTouch[]> {
  const out = new Map<string, PeriodTouch[]>();
  const seen = new Set<string>();
  const count = period.chunksPerPeriod;
  for (const footprint of footprints) {
    const owner = ownerOf(footprint);
    const xs = chunkRange(footprint.minX, footprint.maxX, period.sizeMeters);
    const zs = chunkRange(footprint.minZ, footprint.maxZ, period.sizeMeters);
    for (let bx = xs.from; bx <= xs.to; bx += 1) {
      for (let bz = zs.from; bz <= zs.to; bz += 1) {
        const canonical = canonicalChunk(period, { kx: bx, kz: bz });
        const shiftX = (bx - canonical.kx) / count;
        const shiftZ = (bz - canonical.kz) / count;
        const dedupe = `${chunkKey(canonical)}|${chunkKey(owner)}|${shiftX}|${shiftZ}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const list = out.get(chunkKey(canonical)) ?? [];
        list.push({ owner, shiftX, shiftZ });
        out.set(chunkKey(canonical), list);
      }
    }
  }
  return out;
}

/** Key of the canonical content that a logical chunk draws. Identity for finite worlds. */
export function contentKeyOf(period: ChunkPeriod | null, key: string): string {
  if (!period) return key;
  const coord = parseChunkKey(key);
  if (!coord) throw new Error(`Not a chunk key: ${key}`);
  return chunkKey(canonicalChunk(period, coord));
}

/** Offset in metres from a canonical chunk's place to a logical chunk's place. Zero for finite worlds. */
export function imageOffsetMeters(period: ChunkPeriod | null, key: string): { x: number; z: number } {
  if (!period) return { x: 0, z: 0 };
  const coord = parseChunkKey(key);
  if (!coord) throw new Error(`Not a chunk key: ${key}`);
  const { mx, mz } = chunkImage(period, coord);
  return { x: mx * period.periodMeters, z: mz * period.periodMeters };
}

/** Logical footprint owners whose footprint contains the logical point (x, z). Used for urgent loading. */
export function footprintOwnersAt(
  footprints: readonly PeriodFootprint[],
  period: ChunkPeriod,
  x: number,
  z: number,
): string[] {
  const baseX = wrapToBase(x, period.periodMeters);
  const baseZ = wrapToBase(z, period.periodMeters);
  const imageX = Math.round((x - baseX) / period.periodMeters);
  const imageZ = Math.round((z - baseZ) / period.periodMeters);
  const out: string[] = [];
  for (const footprint of footprints) {
    if (baseX < footprint.minX || baseX > footprint.maxX || baseZ < footprint.minZ || baseZ > footprint.maxZ) continue;
    const owner = parseChunkKey(footprint.owner);
    if (!owner) continue;
    out.push(chunkKey(logicalChunk(period, owner, imageX, imageZ)));
  }
  return out;
}
