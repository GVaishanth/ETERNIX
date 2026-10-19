import { chunkCentre, chunkKey, distanceToChunk, type ChunkCoord } from './chunkGrid';
import { canonicalChunk, chunkImage, logicalChunk, type ChunkPeriod } from './periodicChunks';
import { chunksTouchedBy, type WorldIndex } from './worldIndex';

/*
 * Which chunks are wanted. Pure functions of the index and the player position. No state, no Three.js.
 *
 * Two steps. First, every chunk whose area lies within `radius` of the player is "near". Second, every segment whose
 * footprint touches a near chunk makes its owner wanted. The owner loads its whole segment set, so a road that runs
 * across a boundary is present on both sides, and no piece of a near road is left behind a chunk edge.
 */

export interface PlayerPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * Keys of the chunks that must be loaded for a player at `point` with a load radius of `radius` (metres). On a looping
 * world the keys are logical: the same chunk one period away is a different key, so the set changes continuously as
 * the car crosses a seam. The rule is the same as for a finite world.
 */
export function selectChunks(index: WorldIndex, point: PlayerPoint, radius: number): Set<string> {
  if (index.period) return selectPeriodicChunks(index, index.period, point, radius);
  const size = index.sizeMeters;
  const near = new Set<string>();
  for (const [key, coord] of index.chunks) {
    if (distanceToChunk(point.x, point.z, coord, size) <= radius) near.add(key);
  }
  const wanted = new Set<string>(near);
  for (const footprint of index.footprints) {
    if (wanted.has(footprint.owner)) continue;
    for (const touched of chunksTouchedBy(footprint, size)) {
      if (near.has(chunkKey(touched))) {
        wanted.add(footprint.owner);
        break;
      }
    }
  }
  return wanted;
}

/**
 * Periodic rule. A canonical chunk can appear at several images. Only the images near the player are tested, which is
 * exact: a chunk one image away is more than a period from the player's image, and radius is below half a period. A
 * loaded near chunk keeps its owners at the same image, shifted by the cell's own image, so a road across a seam is
 * present on both sides.
 */
function selectPeriodicChunks(index: WorldIndex, period: ChunkPeriod, point: PlayerPoint, radius: number): Set<string> {
  const size = index.sizeMeters;
  const near = new Map<string, ChunkCoord>();
  for (const canonical of index.chunks.values()) {
    const centre = chunkCentre(canonical, size);
    const m0x = Math.round((point.x - centre.x) / period.periodMeters);
    const m0z = Math.round((point.z - centre.z) / period.periodMeters);
    for (let mx = m0x - 1; mx <= m0x + 1; mx += 1) {
      for (let mz = m0z - 1; mz <= m0z + 1; mz += 1) {
        const logical = logicalChunk(period, canonical, mx, mz);
        if (distanceToChunk(point.x, point.z, logical, size) <= radius) near.set(chunkKey(logical), logical);
      }
    }
  }
  const wanted = new Set<string>(near.keys());
  for (const logical of near.values()) {
    const canonical = canonicalChunk(period, logical);
    const { mx, mz } = chunkImage(period, logical);
    for (const touch of index.touches.get(chunkKey(canonical)) ?? []) {
      const owner = logicalChunk(period, touch.owner, mx - touch.shiftX, mz - touch.shiftZ);
      wanted.add(chunkKey(owner));
    }
  }
  return wanted;
}

/**
 * Load priority of a chunk. Lower loads first. Distance to the chunk centre, scaled down for chunks ahead of the car
 * (in the direction of `forward`) and up for chunks behind it. `forward` need not be normalised.
 */
export function chunkPriority(
  index: WorldIndex,
  coord: ChunkCoord,
  point: PlayerPoint,
  forward: { x: number; z: number },
  bias: number,
): number {
  const centre = chunkCentre(coord, index.sizeMeters);
  const dx = centre.x - point.x;
  const dz = centre.z - point.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-9) return 0;
  const forwardLength = Math.hypot(forward.x, forward.z);
  const cosine = forwardLength > 1e-9 ? (dx * forward.x + dz * forward.z) / (distance * forwardLength) : 0;
  return distance * (1 - bias * Math.max(-1, Math.min(1, cosine)));
}

/** Detail of a chunk. Full detail (roads and scenery) inside the scenery radius, roads only beyond it. Hysteresis. */
export function chunkDetail(
  index: WorldIndex,
  coord: ChunkCoord,
  point: PlayerPoint,
  sceneryRadius: number,
  margin: number,
  previous: 'full' | 'roads' | null,
): 'full' | 'roads' {
  const distance = distanceToChunk(point.x, point.z, coord, index.sizeMeters);
  if (previous === 'full') return distance > sceneryRadius + margin ? 'roads' : 'full';
  if (previous === 'roads') return distance < sceneryRadius - margin ? 'full' : 'roads';
  return distance <= sceneryRadius ? 'full' : 'roads';
}
