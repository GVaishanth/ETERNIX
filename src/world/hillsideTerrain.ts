/*
 * Terrain under the hillside district. The ground is sampled from the shared ground function (hillsideGround.ts), so the
 * terrain, the street lamps, and the pine trees agree. The roads are carved into the ground, so the asphalt lies on it
 * and never pokes through.
 *
 * It is built per streamed chunk, in canonical (unshifted) coordinates. The chunk's group applies the image offset, the
 * same as its roads. A cell belongs to the chunk that owns its centre (chunkGrid.ts). The chunk grid is offset from the
 * node grid: chunk kx = 2 holds cells 6 and 7, so the mapping is taken from chunkOfPoint, not assumed. Only the hillside
 * cells of a chunk produce terrain, so a chunk away from the hillside has none and costs nothing.
 *
 * The grid is fine (SUBDIVISIONS per cell side). The carve is about 20 m wide, so a coarse grid would cut through it.
 */
import { WORLD_STREAMING_CONFIG } from '../config/worldStreamingConfig';
import { CITY_CELL_INDEX_MAX, CITY_CELL_INDEX_MIN, CITY_NODE_SPACING_METERS, HILLSIDE_CELL_COLUMNS, nodeX, nodeZ } from './city/cityLayout';
import { chunkOfPoint } from './streaming/chunkGrid';
import type { MeshBuffers } from './roadMeshData';
import type { HillsideGround } from './hillsideGround';

/** Grid divisions per cell side. 40 gives a 5 m grid, fine enough for the 20 m carve. */
export const TERRAIN_SUBDIVISIONS = 40;

const NORMAL_EPSILON_METERS = 1;
const cache = new WeakMap<HillsideGround, Map<string, MeshBuffers | null>>();

/** Terrain buffers for the hillside cells of canonical chunk (kx, kz), or null when the chunk has no hillside. */
export function hillsideTerrainForChunk(kx: number, kz: number, ground: HillsideGround): MeshBuffers | null {
  let perGround = cache.get(ground);
  if (!perGround) {
    perGround = new Map();
    cache.set(ground, perGround);
  }
  const key = `${kx},${kz}`;
  if (perGround.has(key)) return perGround.get(key) ?? null;
  const built = buildPatch(kx, kz, ground);
  perGround.set(key, built);
  return built;
}

function cellsOfChunk(kx: number, kz: number): Array<{ i: number; j: number }> {
  const size = WORLD_STREAMING_CONFIG.chunkSizeMeters;
  const half = CITY_NODE_SPACING_METERS / 2;
  const cells: Array<{ i: number; j: number }> = [];
  for (const i of HILLSIDE_CELL_COLUMNS) {
    for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
      const owner = chunkOfPoint(nodeX(i) + half, nodeZ(j) + half, size);
      if (owner.kx === kx && owner.kz === kz) cells.push({ i, j });
    }
  }
  return cells;
}

function buildPatch(kx: number, kz: number, ground: HillsideGround): MeshBuffers | null {
  const cells = cellsOfChunk(kx, kz);
  if (cells.length === 0) return null;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const spacing = CITY_NODE_SPACING_METERS;
  const n = TERRAIN_SUBDIVISIONS;
  const stride = n + 1;
  const step = spacing / n;

  for (const { i, j } of cells) {
    const x0 = nodeX(i);
    const z0 = nodeZ(j);
    const base = positions.length / 3;
    for (let r = 0; r <= n; r += 1) {
      for (let c = 0; c <= n; c += 1) {
        const x = x0 + c * step;
        const z = z0 + r * step;
        const y = ground.heightAt(x, z);
        // Normal from the ground's own slope, by central differences.
        const dhdx = (ground.heightAt(x + NORMAL_EPSILON_METERS, z) - ground.heightAt(x - NORMAL_EPSILON_METERS, z)) / (2 * NORMAL_EPSILON_METERS);
        const dhdz = (ground.heightAt(x, z + NORMAL_EPSILON_METERS) - ground.heightAt(x, z - NORMAL_EPSILON_METERS)) / (2 * NORMAL_EPSILON_METERS);
        const length = Math.hypot(dhdx, 1, dhdz);
        positions.push(x, y, z);
        normals.push(-dhdx / length, 1 / length, -dhdz / length);
      }
    }
    // Two triangles per grid square, wound so the normal points up (+y).
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        const a = base + r * stride + c;
        const b = a + 1;
        const d = a + stride;
        const e = d + 1;
        indices.push(a, d, e, a, e, b);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}
