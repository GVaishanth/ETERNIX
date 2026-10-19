import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { LoftMesh } from './loft';

/** Turns the pure loft arrays into a three.js BufferGeometry. The caller owns it and must dispose it. */
export function loftToGeometry(mesh: LoftMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  return geometry;
}
