import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  BoxGeometry,
  Quaternion,
  Euler,
  Vector3,
  type InstancedMesh,
} from 'three';
import { ROAD_NETWORK_CONFIG } from '../config/roadConfig';
import { buildRoadMeshData, type MeshBuffers, type PostInstance, type RoadMeshData } from '../world/roadMeshData';
import type { RoadNetwork } from '../world/roadTypes';
import type { WorldBounds } from '../world/worlds';

/*
 * Renders a road network from the pure mesh buffers. Built once per network, with merged geometry per layer and one
 * shared material per layer. Nothing here regenerates geometry per frame. Simulation-space coordinates under SimRoot.
 */

const COLORS = {
  ground: '#3f6b3c',
  asphalt: '#2e3034',
  shoulder: '#8e8f86',
  markingWhite: '#f5f5f5',
  markingYellow: '#f2c94c',
  guardrail: '#b9bcc0',
  post: '#e8e8e8',
  block: '#7d7f80',
};

const POST_HEIGHT_METERS = 1.0;
const POST_SIZE_METERS = ROAD_NETWORK_CONFIG.guardrailPostSizeMeters;

interface RoadMaterials {
  asphalt: MeshStandardMaterial;
  shoulder: MeshStandardMaterial;
  markingWhite: MeshBasicMaterial;
  markingYellow: MeshBasicMaterial;
  guardrail: MeshStandardMaterial;
  post: MeshStandardMaterial;
  block: MeshStandardMaterial;
}

/** One material per layer, created once. Markings sit above the surface with polygonOffset, so they never z-fight. */
function createRoadMaterials(): RoadMaterials {
  const marking = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  return {
    asphalt: new MeshStandardMaterial({ color: COLORS.asphalt, roughness: 0.9 }),
    shoulder: new MeshStandardMaterial({ color: COLORS.shoulder, roughness: 1 }),
    markingWhite: new MeshBasicMaterial({ color: COLORS.markingWhite, ...marking }),
    markingYellow: new MeshBasicMaterial({ color: COLORS.markingYellow, ...marking }),
    guardrail: new MeshStandardMaterial({ color: COLORS.guardrail, roughness: 0.6, metalness: 0.2, side: DoubleSide }),
    post: new MeshStandardMaterial({ color: COLORS.post, roughness: 0.6 }),
    block: new MeshStandardMaterial({ color: COLORS.block, roughness: 1 }),
  };
}

/** Converts pure buffers into a BufferGeometry. The caller owns it and must dispose it. */
function toBufferGeometry(buffers: MeshBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3));
  geometry.setIndex(new BufferAttribute(buffers.indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

const UNIT_SCALE = new Vector3(1, 1, 1);

function postMatrices(posts: PostInstance[]): Matrix4[] {
  const matrices: Matrix4[] = [];
  const quaternion = new Quaternion();
  const position = new Vector3();
  for (const post of posts) {
    position.set(post.position.x, POST_HEIGHT_METERS / 2, post.position.z);
    quaternion.setFromEuler(new Euler(0, post.headingRadians, 0, 'YXZ'));
    matrices.push(new Matrix4().compose(position, quaternion, UNIT_SCALE));
  }
  return matrices;
}

export interface RoadNetworkSceneProps {
  network: RoadNetwork;
}

export function RoadNetworkScene({ network }: RoadNetworkSceneProps) {
  const data: RoadMeshData = useMemo(() => buildRoadMeshData(network), [network]);
  const materials = useMemo(() => createRoadMaterials(), []);
  const geometries = useMemo(
    () => ({
      asphalt: toBufferGeometry(data.asphalt),
      shoulders: toBufferGeometry(data.shoulders),
      markingsWhite: toBufferGeometry(data.markingsWhite),
      markingsYellow: toBufferGeometry(data.markingsYellow),
      guardrails: toBufferGeometry(data.guardrails),
    }),
    [data],
  );
  const blockGeometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const postGeometry = useMemo(() => new BoxGeometry(POST_SIZE_METERS, POST_HEIGHT_METERS, POST_SIZE_METERS), []);
  const postTransforms = useMemo(() => postMatrices(data.posts), [data]);
  const postRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = postRef.current;
    if (!mesh) return;
    postTransforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [postTransforms]);

  useEffect(() => {
    return () => {
      for (const geometry of Object.values(geometries)) geometry.dispose();
      blockGeometry.dispose();
      postGeometry.dispose();
    };
  }, [geometries, blockGeometry, postGeometry]);

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
    };
  }, [materials]);

  return (
    <group name="RoadNetwork">
      <mesh name="RoadAsphalt" geometry={geometries.asphalt} material={materials.asphalt} />
      <mesh name="RoadShoulders" geometry={geometries.shoulders} material={materials.shoulder} />
      <mesh name="RoadMarkingsWhite" geometry={geometries.markingsWhite} material={materials.markingWhite} />
      <mesh name="RoadMarkingsYellow" geometry={geometries.markingsYellow} material={materials.markingYellow} />
      <mesh name="Guardrails" geometry={geometries.guardrails} material={materials.guardrail} />
      <instancedMesh
        ref={postRef}
        name="GuardrailPosts"
        args={[postGeometry, materials.post, postTransforms.length]}
      />
      {data.blocks.map((block, index) => (
        <mesh
          key={`block-${index}`}
          name="TestBlock"
          geometry={blockGeometry}
          material={materials.block}
          position={[block.centre.x, block.heightMeters / 2, block.centre.z]}
          scale={[block.widthMeters, block.heightMeters, block.depthMeters]}
        />
      ))}
    </group>
  );
}

/** Ground patch around the network, finite. Its edge is blended into the fog, so the limit is visible but soft. */
export function NetworkGround({ bounds }: { bounds: WorldBounds }) {
  const size = ROAD_NETWORK_CONFIG.groundHalfExtentMeters * 2;
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  return (
    <mesh name="Ground" rotation={[-Math.PI / 2, 0, 0]} position={[centreX, ROAD_NETWORK_CONFIG.groundYMeters, centreZ]}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={COLORS.ground} roughness={1} />
    </mesh>
  );
}
