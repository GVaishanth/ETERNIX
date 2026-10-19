import { describe, expect, it } from 'vitest';
import { WORLD_STREAMING_CONFIG } from '../../config/worldStreamingConfig';
import { buildRoadMeshData, prepareRoadInput, ROAD_TEST_BLOCKS } from '../roadMeshData';
import { chunkKey, chunkOfPoint } from '../streaming/chunkGrid';
import { buildCityNetwork } from './cityNetwork';
import { buildCityScenery } from './cityScenery';
import { createCityStreamingSet, partitionBlocks, partitionScenery } from './cityChunks';

/*
 * Chunk assignment for the city. Every scenery object and test block is in exactly one chunk, and the road meshes built
 * per chunk add up to the whole-network build. That is the continuity check that matters for rendering: a segment that
 * is drawn twice, or not at all, shows up as a difference in triangle or vertex counts.
 */

const SIZE = WORLD_STREAMING_CONFIG.chunkSizeMeters;
const network = buildCityNetwork();
const scenery = buildCityScenery();

describe('city chunk assignment', () => {
  const set = createCityStreamingSet(network, scenery, ROAD_TEST_BLOCKS);

  it('puts every scenery object in exactly one chunk', () => {
    const parts = partitionScenery(scenery, SIZE);
    let buildings = 0;
    let trees = 0;
    let lamps = 0;
    let signs = 0;
    let landmarkParts = 0;
    for (const part of parts.values()) {
      buildings += part.buildings.length;
      trees += part.trees.length;
      lamps += part.lamps.length;
      signs += part.signs.length;
      landmarkParts += part.landmarkParts.length;
    }
    expect(buildings).toBe(scenery.buildings.length);
    expect(trees).toBe(scenery.trees.length);
    expect(lamps).toBe(scenery.lamps.length);
    expect(signs).toBe(scenery.signs.length);
    expect(landmarkParts).toBe(scenery.landmarkParts.length);
  });

  it('keeps every scenery object inside the chunk it is assigned to', () => {
    for (const [key, part] of partitionScenery(scenery, SIZE)) {
      const coordOf = (x: number, z: number) => chunkOfPoint(x, z, SIZE);
      for (const tree of part.trees) expect(chunkKey(coordOf(tree.x, tree.z)), tree.id).toBe(key);
      for (const lamp of part.lamps) expect(chunkKey(coordOf(lamp.x, lamp.z)), lamp.id).toBe(key);
      for (const building of part.buildings) {
        const cx = (building.footprint.x0 + building.footprint.x1) / 2;
        const cz = (building.footprint.z0 + building.footprint.z1) / 2;
        expect(chunkKey(coordOf(cx, cz)), building.id).toBe(key);
      }
    }
  });

  it('never splits a landmark across two chunks', () => {
    const parts = partitionScenery(scenery, SIZE);
    for (const landmark of scenery.buildings.filter((b) => b.kind === 'landmark')) {
      const owners = [...parts.values()].filter((p) => p.buildings.some((b) => b.id === landmark.id));
      expect(owners).toHaveLength(1);
      const owner = owners[0];
      for (const part of scenery.landmarkParts.filter((p) => p.landmarkId === landmark.id)) {
        expect(owner?.landmarkParts).toContain(part);
      }
    }
  });

  it('puts every test block in exactly one chunk', () => {
    const blocks = partitionBlocks(ROAD_TEST_BLOCKS, SIZE);
    let total = 0;
    for (const list of blocks.values()) total += list.length;
    expect(total).toBe(ROAD_TEST_BLOCKS.length);
  });

  it('indexes every chunk that holds content, so no object is orphaned', () => {
    for (const key of set.sceneryByChunk.keys()) expect(set.index.chunks.has(key), key).toBe(true);
    for (const key of set.blocksByChunk.keys()) expect(set.index.chunks.has(key), key).toBe(true);
  });

  it('is deterministic: two sets give the same chunk assignment', () => {
    const again = createCityStreamingSet(buildCityNetwork(), buildCityScenery(), ROAD_TEST_BLOCKS);
    expect([...again.index.chunks.keys()]).toEqual([...set.index.chunks.keys()]);
    expect([...again.index.segmentOwner.entries()]).toEqual([...set.index.segmentOwner.entries()]);
  });
});

describe('road continuity across chunks', () => {
  const prepared = prepareRoadInput(network);
  const whole = buildRoadMeshData(network, { prepared, blocks: [] });
  const set = createCityStreamingSet(network, scenery, ROAD_TEST_BLOCKS);

  it('builds every segment exactly once: per-chunk triangle and vertex counts add up to the whole network', () => {
    const sum = { asphalt: 0, asphaltVertices: 0, shoulders: 0, markingsWhite: 0, markingsYellow: 0, guardrails: 0, posts: 0 };
    for (const ids of set.index.chunkSegments.values()) {
      const part = buildRoadMeshData(network, { emitIds: new Set(ids), prepared, blocks: [] });
      sum.asphalt += part.asphalt.triangleCount;
      sum.asphaltVertices += part.asphalt.vertexCount;
      sum.shoulders += part.shoulders.triangleCount;
      sum.markingsWhite += part.markingsWhite.triangleCount;
      sum.markingsYellow += part.markingsYellow.triangleCount;
      sum.guardrails += part.guardrails.triangleCount;
      sum.posts += part.posts.length;
    }
    expect(sum.asphalt).toBe(whole.asphalt.triangleCount);
    expect(sum.asphaltVertices).toBe(whole.asphalt.vertexCount);
    expect(sum.shoulders).toBe(whole.shoulders.triangleCount);
    expect(sum.markingsWhite).toBe(whole.markingsWhite.triangleCount);
    expect(sum.markingsYellow).toBe(whole.markingsYellow.triangleCount);
    expect(sum.guardrails).toBe(whole.guardrails.triangleCount);
    expect(sum.posts).toBe(whole.posts.length);
  });

  it('draws nothing for a chunk with no owned segments, and nothing for an empty id set', () => {
    const empty = buildRoadMeshData(network, { emitIds: new Set<string>(), prepared, blocks: [] });
    expect(empty.asphalt.triangleCount).toBe(0);
    expect(empty.posts).toHaveLength(0);
  });
});
