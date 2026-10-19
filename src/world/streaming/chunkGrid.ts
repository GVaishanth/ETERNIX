/*
 * Chunk grid. Pure coordinate arithmetic for the world's square chunks. Chunks are half-open: chunk (kx, kz) owns the
 * points with floor(x / size) = kx and floor(z / size) = kz. A point on a chunk edge belongs to the chunk on its
 * positive side, so every point has exactly one owner. No Three.js.
 */

export interface ChunkCoord {
  readonly kx: number;
  readonly kz: number;
}

export interface ChunkBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Stable chunk id, for example C-0-0 or C--1-2. Used as the key in every map and in diagnostics. */
export function chunkKey(coord: ChunkCoord): string {
  return `C-${coord.kx}-${coord.kz}`;
}

/** Chunk that owns the point (x, z). */
export function chunkOfPoint(x: number, z: number, sizeMeters: number): ChunkCoord {
  return { kx: Math.floor(x / sizeMeters), kz: Math.floor(z / sizeMeters) };
}

export function chunkBounds(coord: ChunkCoord, sizeMeters: number): ChunkBounds {
  return {
    minX: coord.kx * sizeMeters,
    maxX: (coord.kx + 1) * sizeMeters,
    minZ: coord.kz * sizeMeters,
    maxZ: (coord.kz + 1) * sizeMeters,
  };
}

export function chunkCentre(coord: ChunkCoord, sizeMeters: number): { x: number; z: number } {
  return { x: (coord.kx + 0.5) * sizeMeters, z: (coord.kz + 0.5) * sizeMeters };
}

/** Distance from (x, z) to the nearest point of a chunk. Zero when the point is inside it. */
export function distanceToChunk(x: number, z: number, coord: ChunkCoord, sizeMeters: number): number {
  const b = chunkBounds(coord, sizeMeters);
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

/** Inclusive range of chunk indices that a closed interval [min, max] touches. */
export function chunkRange(min: number, max: number, sizeMeters: number): { from: number; to: number } {
  return { from: Math.floor(min / sizeMeters), to: Math.floor(max / sizeMeters) };
}

/** Parses a chunk key back to its coordinate. Returns null for anything that is not a chunk key. */
export function parseChunkKey(key: string): ChunkCoord | null {
  const match = /^C-(-?\d+)-(-?\d+)$/.exec(key);
  if (!match) return null;
  return { kx: Number(match[1]), kz: Number(match[2]) };
}
