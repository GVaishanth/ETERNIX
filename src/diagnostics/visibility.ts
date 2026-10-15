import { Frustum, Matrix4, type Box3, type PerspectiveCamera } from 'three';

/**
 * Frustum visibility checks for diagnostics. "Visible" means the bounds intersect the view
 * frustum. Occlusion is not tested.
 */

const projectionScratch = new Matrix4();

export function updateFrustumFromCamera(frustum: Frustum, camera: PerspectiveCamera): void {
  camera.updateMatrixWorld();
  projectionScratch.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projectionScratch);
}

export function isBoundsInFrustum(frustum: Frustum, bounds: Box3): boolean {
  return frustum.intersectsBox(bounds);
}
