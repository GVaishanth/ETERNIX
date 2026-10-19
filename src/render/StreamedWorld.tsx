import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BoxGeometry, BufferGeometry, Matrix4, MeshStandardMaterial, type InstancedMesh } from 'three';
import type { CityStreamingSet } from '../world/city/cityChunks';
import type { CityScenery as CityData } from '../world/city/cityScenery';
import type { BlockInstance, MeshBuffers, PreparedRoadInput } from '../world/roadMeshData';
import { buildRoadMeshData } from '../world/roadMeshData';
import type { RoadNetwork } from '../world/roadTypes';
import type { MountedChunk, WorldStreamer } from '../world/streaming/streamer';
import { contentKeyOf, imageOffsetMeters } from '../world/streaming/periodicChunks';
import { parseChunkKey } from '../world/streaming/chunkGrid';
import { hillsideTerrainForChunk } from '../world/hillsideTerrain';
import { hillsideGroundFor } from '../world/hillsideGround';
import { CityScenery } from './CityScenery';
import {
  createRoadMaterials,
  postMatrices,
  POST_HEIGHT_METERS,
  POST_SIZE_METERS,
  toBufferGeometry,
  type RoadMaterials,
} from './roadRenderShared';
import { registerAsphalt } from './surfaceRegistry';

/** Ground colour of the hillside terrain. */
const HILLSIDE_COLOUR = '#7d8f5b';

/*
 * Renders the city one chunk at a time. The streamer decides which chunks are mounted. Each mounted chunk builds its own
 * road geometry from the segments it owns, and its scenery when it has full detail. Unmounting a chunk disposes its
 * geometry, and reports the release to the streamer. Materials and the shared box geometries are created once for the
 * whole world and disposed when it unmounts.
 *
 * Gameplay does not read anything here. The road graph, the boundary, and traffic come from the authoritative network.
 */

const EMPTY_SEGMENTS: readonly string[] = [];
const EMPTY_BLOCKS: readonly BlockInstance[] = [];

type LayerKey = 'asphalt' | 'dirt' | 'shoulder' | 'markingWhite' | 'markingYellow' | 'guardrail';

interface RoadLayer {
  readonly meshName: string;
  readonly material: LayerKey;
  readonly geometry: BufferGeometry;
}

interface ChunkRoad {
  readonly layers: readonly RoadLayer[];
  readonly posts: readonly Matrix4[];
  /** Set when the build failed. The chunk is then reported as failed, and nothing is drawn for it. */
  readonly error: string | null;
}

const NO_ROAD: ChunkRoad = { layers: [], posts: [], error: null };

/** Builds the road geometry for the segments a chunk owns. Each owned segment is built once, by its owner only. */
function buildChunkRoad(network: RoadNetwork, owned: readonly string[], prepared: PreparedRoadInput): ChunkRoad {
  if (owned.length === 0) return NO_ROAD;
  try {
    const data = buildRoadMeshData(network, { emitIds: new Set(owned), blocks: EMPTY_BLOCKS, prepared });
    const layers: RoadLayer[] = [];
    const add = (meshName: string, material: LayerKey, buffers: MeshBuffers) => {
      if (buffers.triangleCount === 0) return;
      layers.push({ meshName, material, geometry: toBufferGeometry(buffers) });
    };
    add('RoadAsphalt', 'asphalt', data.asphalt);
    add('RoadDirt', 'dirt', data.dirt);
    add('RoadShoulders', 'shoulder', data.shoulders);
    add('RoadMarkingsWhite', 'markingWhite', data.markingsWhite);
    add('RoadMarkingsYellow', 'markingYellow', data.markingsYellow);
    add('Guardrails', 'guardrail', data.guardrails);
    return { layers, posts: postMatrices(data.posts), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { layers: [], posts: [], error: message };
  }
}

interface SharedGeometry {
  readonly block: BoxGeometry;
  readonly post: BoxGeometry;
}

interface StreamedChunkProps {
  chunk: MountedChunk;
  /** Image offset of this chunk in simulation metres. Zero in a finite world. */
  offset: { x: number; z: number };
  network: RoadNetwork;
  owned: readonly string[];
  prepared: PreparedRoadInput;
  blocks: readonly BlockInstance[];
  scenery: CityData | undefined;
  /** Hillside terrain for this chunk, in its canonical coordinates. Null when the chunk has no hillside. */
  terrain: MeshBuffers | null;
  materials: RoadMaterials;
  shared: SharedGeometry;
  streamer: WorldStreamer;
}

function StreamedChunk({ chunk, offset, network, owned, prepared, blocks, scenery, terrain, materials, shared, streamer }: StreamedChunkProps) {
  const road = useMemo(() => buildChunkRoad(network, owned, prepared), [network, owned, prepared]);
  const terrainGeometry = useMemo(() => (terrain ? toBufferGeometry(terrain) : null), [terrain]);
  const terrainMaterial = useMemo(() => new MeshStandardMaterial({ color: HILLSIDE_COLOUR, roughness: 1 }), []);
  useEffect(() => {
    return () => {
      terrainGeometry?.dispose();
      terrainMaterial.dispose();
    };
  }, [terrainGeometry, terrainMaterial]);
  const postRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = postRef.current;
    if (!mesh) return;
    road.posts.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [road]);

  // The chunk is built once its meshes are in the scene. A failed build is reported, and the chunk is not kept.
  useEffect(() => {
    if (road.error !== null) {
      streamer.fail(chunk.key, road.error);
      return;
    }
    streamer.complete(chunk.key);
    return () => {
      for (const layer of road.layers) layer.geometry.dispose();
      streamer.released(chunk.key);
    };
  }, [road, chunk.key, streamer]);

  const materialOf: Record<LayerKey, RoadMaterials[LayerKey]> = {
    asphalt: materials.asphalt,
    dirt: materials.dirt,
    shoulder: materials.shoulder,
    markingWhite: materials.markingWhite,
    markingYellow: materials.markingYellow,
    guardrail: materials.guardrail,
  };

  return (
    <group name={chunk.key} position={[offset.x, 0, offset.z]}>
      {terrainGeometry ? <mesh name="HillsideTerrain" geometry={terrainGeometry} material={terrainMaterial} /> : null}
      {road.layers.map((layer) => (
        <mesh key={layer.meshName} name={layer.meshName} geometry={layer.geometry} material={materialOf[layer.material]} />
      ))}
      {road.posts.length > 0 ? (
        <instancedMesh ref={postRef} name="GuardrailPosts" args={[shared.post, materials.post, road.posts.length]} />
      ) : null}
      {blocks.map((block, index) => (
        <mesh
          key={`block-${index}`}
          name="TestBlock"
          geometry={shared.block}
          material={materials.block}
          position={[block.centre.x, block.heightMeters / 2, block.centre.z]}
          scale={[block.widthMeters, block.heightMeters, block.depthMeters]}
        />
      ))}
      {chunk.detail === 'full' && scenery ? <CityScenery scenery={scenery} /> : null}
    </group>
  );
}

export interface StreamedWorldProps {
  network: RoadNetwork;
  set: CityStreamingSet;
}

export function StreamedWorld({ network, set }: StreamedWorldProps) {
  const { streamer, index, prepared, sceneryByChunk, blocksByChunk } = set;
  const [mounted, setMounted] = useState<MountedChunk[]>(() => streamer.mountedChunks());
  const materials = useMemo(() => createRoadMaterials(), []);
  // The hillside ground, shared with the lamps and pines so the terrain, the lamps and the trees agree.
  const ground = useMemo(() => hillsideGroundFor(network), [network]);
  const shared = useMemo<SharedGeometry>(
    () => ({
      block: new BoxGeometry(1, 1, 1),
      post: new BoxGeometry(POST_SIZE_METERS, POST_HEIGHT_METERS, POST_SIZE_METERS),
    }),
    [],
  );

  // Asphalt responds to weather. Registration ends when this world unmounts.
  useEffect(() => registerAsphalt(materials.asphalt), [materials]);

  // The streamer is driven from the frame loop. Each change of the mounted set is copied into React state here.
  useEffect(() => streamer.subscribe(() => setMounted(streamer.mountedChunks())), [streamer]);

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
      shared.block.dispose();
      shared.post.dispose();
    };
  }, [materials, shared]);

  return (
    <group name="StreamedWorld">
      {mounted.map((chunk) => {
        // The terrain is keyed by the chunk's canonical content, so every image of a chunk shares one patch.
        const canonical = parseChunkKey(contentKeyOf(index.period, chunk.key));
        const terrain = canonical ? hillsideTerrainForChunk(canonical.kx, canonical.kz, ground) : null;
        return (
          <StreamedChunk
            key={chunk.key}
            chunk={chunk}
            network={network}
            offset={imageOffsetMeters(index.period, chunk.key)}
            owned={index.chunkSegments.get(contentKeyOf(index.period, chunk.key)) ?? EMPTY_SEGMENTS}
            prepared={prepared}
            blocks={blocksByChunk.get(contentKeyOf(index.period, chunk.key)) ?? EMPTY_BLOCKS}
            scenery={sceneryByChunk.get(contentKeyOf(index.period, chunk.key))}
            terrain={terrain}
            materials={materials}
            shared={shared}
            streamer={streamer}
          />
        );
      })}
    </group>
  );
}
