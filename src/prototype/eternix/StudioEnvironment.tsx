import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { Scene, WebGLRenderer } from 'three';
import { buildStudioEnvironment } from './studioEnvironment';

/** Sets the scene's environment map and returns the cleanup. Kept outside the component, because it changes the scene. */
function attachStudioEnvironment(scene: Scene, gl: WebGLRenderer, intensity: number): () => void {
  const environment = buildStudioEnvironment(gl);
  scene.environment = environment.texture;
  scene.environmentIntensity = intensity;
  return () => {
    scene.environment = null;
    environment.dispose();
  };
}

export function StudioEnvironment({ intensity }: { readonly intensity: number }) {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  useEffect(() => attachStudioEnvironment(scene, gl, intensity), [gl, scene, intensity]);
  return null;
}
