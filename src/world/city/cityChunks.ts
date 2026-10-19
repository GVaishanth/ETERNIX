import { WORLD_STREAMING_CONFIG } from '../../config/worldStreamingConfig';
import { chunkKey, chunkOfPoint, type ChunkCoord } from '../streaming/chunkGrid';
import { WorldStreamer } from '../streaming/streamer';
import { buildWorldIndex, type WorldIndex } from '../streaming/worldIndex';
import type { BlockInstance, PreparedRoadInput } from '../roadMeshData';
import { prepareRoadInput } from '../roadMeshData';
import type { RoadNetwork } from '../roadTypes';
import type { CityScenery } from './cityScenery';

/*
 * Chunk assignment for the city. Pure: no Three.js. Every scenery object and every test block belongs to exactly one
 * chunk, chosen from its own position. Road segments belong to the chunk of their anchor (see worldIndex.ts). Scenery-only
 * chunks are added to the index, so no scenery is ever orphaned outside the streamed set.
 *
 * Deviation from the plan: lamps and signs are assigned by their own position, not by their street's owner. The
 * assignment is still complete and deterministic: each object is in exactly one chunk.
 */

export interface CityStreamingSet {
  readonly index: WorldIndex;
  readonly streamer: WorldStreamer;
  readonly prepared: PreparedRoadInput;
  readonly sceneryByChunk: ReadonlyMap<string, CityScenery>;
  readonly blocksByChunk: ReadonlyMap<string, readonly BlockInstance[]>;
}

/** Every chunk that holds a scenery object or a test block. Used so those chunks exist even without a road owner. */
export function contentChunks(scenery: CityScenery, blocks: readonly BlockInstance[], sizeMeters: number): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (const building of scenery.buildings) {
    out.push(chunkOfPoint((building.footprint.x0 + building.footprint.x1) / 2, (building.footprint.z0 + building.footprint.z1) / 2, sizeMeters));
  }
  for (const part of scenery.landmarkParts) out.push(chunkOfPoint(part.x, part.z, sizeMeters));
  for (const tree of scenery.trees) out.push(chunkOfPoint(tree.x, tree.z, sizeMeters));
  for (const lamp of scenery.lamps) out.push(chunkOfPoint(lamp.x, lamp.z, sizeMeters));
  for (const sign of scenery.signs) out.push(chunkOfPoint(sign.x, sign.z, sizeMeters));
  for (const block of blocks) out.push(chunkOfPoint(block.centre.x, block.centre.z, sizeMeters));
  return out;
}

function emptyScenery(): CityScenery {
  return { buildings: [], landmarkParts: [], trees: [], lamps: [], signs: [], cells: [] };
}

/**
 * Splits the scenery by chunk. Each object goes to the chunk that holds its position. A landmark part goes to the chunk of
 * its landmark's building, so a landmark is never split across two chunks. Throws when a part names a missing building,
 * because that is a layout error, not a runtime condition.
 */
export function partitionScenery(scenery: CityScenery, sizeMeters: number): Map<string, CityScenery> {
  const out = new Map<string, CityScenery>();
  const at = (coord: ChunkCoord): CityScenery => {
    const key = chunkKey(coord);
    const existing = out.get(key);
    if (existing) return existing;
    const created = emptyScenery();
    out.set(key, created);
    return created;
  };
  const chunkOfBuilding = new Map<string, CityScenery>();
  for (const building of scenery.buildings) {
    const coord = chunkOfPoint((building.footprint.x0 + building.footprint.x1) / 2, (building.footprint.z0 + building.footprint.z1) / 2, sizeMeters);
    at(coord).buildings.push(building);
    chunkOfBuilding.set(building.id, at(coord));
  }
  for (const part of scenery.landmarkParts) {
    const owner = chunkOfBuilding.get(part.landmarkId);
    if (!owner) throw new Error(`Landmark part names unknown landmark ${part.landmarkId}`);
    owner.landmarkParts.push(part);
  }
  for (const tree of scenery.trees) at(chunkOfPoint(tree.x, tree.z, sizeMeters)).trees.push(tree);
  for (const lamp of scenery.lamps) at(chunkOfPoint(lamp.x, lamp.z, sizeMeters)).lamps.push(lamp);
  for (const sign of scenery.signs) at(chunkOfPoint(sign.x, sign.z, sizeMeters)).signs.push(sign);
  return out;
}

/** Splits the test blocks by the chunk that holds their centre. */
export function partitionBlocks(blocks: readonly BlockInstance[], sizeMeters: number): Map<string, BlockInstance[]> {
  const out = new Map<string, BlockInstance[]>();
  for (const block of blocks) {
    const key = chunkKey(chunkOfPoint(block.centre.x, block.centre.z, sizeMeters));
    const list = out.get(key) ?? [];
    list.push(block);
    out.set(key, list);
  }
  return out;
}

/**
 * Builds the complete streaming set for the city: the index, the streamer, the precomputed junction ends, and the chunk
 * assignments. Deterministic. Does not build any mesh.
 */
export function createCityStreamingSet(
  network: RoadNetwork,
  scenery: CityScenery,
  blocks: readonly BlockInstance[],
): CityStreamingSet {
  const size = WORLD_STREAMING_CONFIG.chunkSizeMeters;
  const index = buildWorldIndex(network, size, contentChunks(scenery, blocks, size));
  return {
    index,
    streamer: new WorldStreamer(index),
    prepared: prepareRoadInput(network),
    sceneryByChunk: partitionScenery(scenery, size),
    blocksByChunk: partitionBlocks(blocks, size),
  };
}
