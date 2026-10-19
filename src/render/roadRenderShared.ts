import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Euler,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { ROAD_NETWORK_CONFIG } from '../config/roadConfig';
import type { MeshBuffers, PostInstance } from '../world/roadMeshData';

/*
 * Shared road rendering pieces: colours, materials, buffer-to-geometry conversion, and post transforms. Used by the
 * whole-network scene (RoadNetworkScene.tsx) and by the streamed city (StreamedWorld.tsx). Pure helpers, no components.
 */

export const COLORS = {
  ground: '#3f6b3c',
  asphalt: '#2e3034',
  dirt: '#7a6447',
  shoulder: '#8e8f86',
  markingWhite: '#f5f5f5',
  markingYellow: '#f2c94c',
  guardrail: '#b9bcc0',
  post: '#e8e8e8',
  block: '#7d7f80',
};

export const POST_HEIGHT_METERS = 1.0;
export const POST_SIZE_METERS = ROAD_NETWORK_CONFIG.guardrailPostSizeMeters;

export interface RoadMaterials {
  asphalt: MeshStandardMaterial;
  dirt: MeshStandardMaterial;
  shoulder: MeshStandardMaterial;
  markingWhite: MeshBasicMaterial;
  markingYellow: MeshBasicMaterial;
  guardrail: MeshStandardMaterial;
  post: MeshStandardMaterial;
  block: MeshStandardMaterial;
}

/** One material per layer, created once. Markings sit above the surface with polygonOffset, so they never z-fight. */
export function createRoadMaterials(): RoadMaterials {
  const marking = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  return {
    asphalt: new MeshStandardMaterial({ color: COLORS.asphalt, roughness: 0.9 }),
    dirt: new MeshStandardMaterial({ color: COLORS.dirt, roughness: 1 }),
    shoulder: new MeshStandardMaterial({ color: COLORS.shoulder, roughness: 1 }),
    markingWhite: new MeshBasicMaterial({ color: COLORS.markingWhite, ...marking }),
    markingYellow: new MeshBasicMaterial({ color: COLORS.markingYellow, ...marking }),
    guardrail: new MeshStandardMaterial({ color: COLORS.guardrail, roughness: 0.6, metalness: 0.2, side: DoubleSide }),
    post: new MeshStandardMaterial({ color: COLORS.post, roughness: 0.6 }),
    block: new MeshStandardMaterial({ color: COLORS.block, roughness: 1 }),
  };
}

/** Converts pure buffers into a BufferGeometry. The caller owns it and must dispose it. */
export function toBufferGeometry(buffers: MeshBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(buffers.normals, 3));
  geometry.setIndex(new BufferAttribute(buffers.indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

const UNIT_SCALE = new Vector3(1, 1, 1);

export function postMatrices(posts: PostInstance[]): Matrix4[] {
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

