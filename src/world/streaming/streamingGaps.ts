import { chunkKey, chunkOfPoint, parseChunkKey } from './chunkGrid';
import { canonicalChunk } from './periodicChunks';
import type { WorldIndex } from './worldIndex';

/*
 * Gap probe. A gap is a place the car is about to drive through whose chunk is not active (built and in the scene). The
 * probe samples a strip of points ahead of the car and asks which of their chunks are not yet active. It is pure: the
 * streamer supplies the activity test. Used by the streamer's stats and by the seam drive tests.
 */

export interface GapSampling {
  /** How far ahead of the car the strip reaches, in metres. */
  readonly lookaheadMeters: number;
  /** Half-width of the strip, in metres. The strip has three lines: left, centre, and right. */
  readonly lateralMeters: number;
  /** Spacing of the samples along the strip, in metres. Across the strip the samples sit on three lines: -lateral, 0, +lateral. */
  readonly stepMeters: number;
}

export interface PlanarPoint {
  readonly x: number;
  readonly z: number;
}

/** Sample points from the car forward. The car's own point is always first. `forward` need not be normalised. */
export function aheadSamples(point: PlanarPoint, forward: PlanarPoint, sampling: GapSampling): PlanarPoint[] {
  const out: PlanarPoint[] = [{ x: point.x, z: point.z }];
  const length = Math.hypot(forward.x, forward.z);
  if (!(length > 1e-9)) return out;
  const fx = forward.x / length;
  const fz = forward.z / length;
  // Right-hand normal in the xz plane: the direction of the lateral offsets.
  const rx = -fz;
  const rz = fx;
  const { lookaheadMeters, lateralMeters, stepMeters } = sampling;
  for (let along = 0; along <= lookaheadMeters + 1e-9; along += stepMeters) {
    for (const lateral of [-lateralMeters, 0, lateralMeters]) {
      out.push({ x: point.x + fx * along + rx * lateral, z: point.z + fz * along + rz * lateral });
    }
  }
  return out;
}

/** True when the index has content for the chunk with this logical key (its canonical chunk is populated). */
export function hasChunkContent(index: WorldIndex, key: string): boolean {
  const coord = parseChunkKey(key);
  if (!coord) return false;
  if (!index.period) return index.chunks.has(key);
  return index.chunks.has(chunkKey(canonicalChunk(index.period, coord)));
}

/**
 * Number of distinct logical chunks with content that contain a sample point and are not active. Zero means the strip
 * ahead of the car is fully built.
 */
export function countUnloadedAhead(index: WorldIndex, samples: readonly PlanarPoint[], isActive: (key: string) => boolean): number {
  const seen = new Set<string>();
  let missing = 0;
  for (const sample of samples) {
    const key = chunkKey(chunkOfPoint(sample.x, sample.z, index.sizeMeters));
    if (seen.has(key)) continue;
    seen.add(key);
    if (!hasChunkContent(index, key)) continue;
    if (!isActive(key)) missing += 1;
  }
  return missing;
}

