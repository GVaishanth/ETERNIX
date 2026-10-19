import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { BoxGeometry, type Group, type InstancedMesh } from 'three';
import { COLORS, createRoadMaterials, postMatrices, POST_HEIGHT_METERS, POST_SIZE_METERS, toBufferGeometry } from './roadRenderShared';
import { ROAD_NETWORK_CONFIG } from '../config/roadConfig';
import { registerAsphalt } from './surfaceRegistry';
import { buildRoadMeshData, type RoadMeshData } from '../world/roadMeshData';
import type { RoadNetwork } from '../world/roadTypes';
import type { WorldBounds } from '../world/worlds';

/*
 * Renders a road network from the pure mesh buffers. Built once per network, with merged geometry per layer and one
 * shared material per layer. Nothing here regenerates geometry per frame. Simulation-space coordinates under SimRoot.
 */

export interface RoadNetworkSceneProps {
  network: RoadNetwork;
}

export function RoadNetworkScene({ network }: RoadNetworkSceneProps) {
  const data: RoadMeshData = useMemo(() => buildRoadMeshData(network), [network]);
  const materials = useMemo(() => createRoadMaterials(), []);
  const geometries = useMemo(
    () => ({
      asphalt: toBufferGeometry(data.asphalt),
      dirt: toBufferGeometry(data.dirt),
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

  // Asphalt responds to weather (Part 10). Registration ends when this network is disposed.
  useEffect(() => registerAsphalt(materials.asphalt), [materials]);

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
    };
  }, [materials]);

  return (
    <group name="RoadNetwork">
      <mesh name="RoadAsphalt" geometry={geometries.asphalt} material={materials.asphalt} />
      <mesh name="RoadDirt" geometry={geometries.dirt} material={materials.dirt} />
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

/**
 * Ground patch around the network, finite. Its edge is blended into the fog, so the limit is visible but soft. The patch
 * is at least the configured size, and grows to cover the whole network with a margin, so no road hangs over bare void.
 */
/**
 * Ground for a looping world. The base bounds do not cover the unbounded world, so this plane follows the origin (its
 * group is moved each frame by applyWorldOrigin). It is larger than the streaming radius in every direction.
 */
export function FollowingGround({ groupRef, sizeMeters }: { groupRef: RefObject<Group | null>; sizeMeters: number }) {
  return (
    <group ref={groupRef}>
      <mesh name="Ground" rotation={[-Math.PI / 2, 0, 0]} position={[0, ROAD_NETWORK_CONFIG.groundYMeters, 0]}>
        <planeGeometry args={[sizeMeters, sizeMeters]} />
        <meshStandardMaterial color={COLORS.ground} roughness={1} />
      </mesh>
    </group>
  );
}

export function NetworkGround({ bounds }: { bounds: WorldBounds }) {
  const margin = 200;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 2 * margin;
  const size = Math.max(ROAD_NETWORK_CONFIG.groundHalfExtentMeters * 2, span);
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  return (
    <mesh name="Ground" rotation={[-Math.PI / 2, 0, 0]} position={[centreX, ROAD_NETWORK_CONFIG.groundYMeters, centreZ]}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={COLORS.ground} roughness={1} />
    </mesh>
  );
}
