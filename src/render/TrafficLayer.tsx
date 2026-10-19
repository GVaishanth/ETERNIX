import { useEffect } from 'react';
import type { TrafficVisualPool } from './trafficVisuals';

/**
 * Mounts the traffic visual pool inside the mirrored SimRoot. Transforms are written by RenderLoop, not by React,
 * so traffic never causes React rerenders. The pool is disposed by its owner (RenderLayer) on unmount.
 */
export function TrafficLayer({ pool }: { pool: TrafficVisualPool }) {
  useEffect(() => {
    return () => pool.dispose();
  }, [pool]);
  return <primitive object={pool.root} />;
}
