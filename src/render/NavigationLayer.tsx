import { useEffect } from 'react';
import type { NavigationScene } from './navigationScene';

/**
 * Mounts the navigation visuals inside the mirrored SimRoot. RenderLoop moves them each frame, so they cause no React
 * rerenders. In DEV the route read-out is exposed for browser tests. The scene is disposed on unmount.
 */
export function NavigationLayer({ scene }: { scene: NavigationScene }) {
  useEffect(() => {
    if (import.meta.env.DEV && window.__STREET_RACER_DEBUG__) {
      window.__STREET_RACER_DEBUG__.navigation = { getRoute: () => scene.readout() };
    }
    return () => {
      if (import.meta.env.DEV && window.__STREET_RACER_DEBUG__) delete window.__STREET_RACER_DEBUG__.navigation;
      scene.dispose();
    };
  }, [scene]);
  return <primitive object={scene.visuals.root} />;
}
