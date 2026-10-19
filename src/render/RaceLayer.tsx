import { useEffect } from 'react';
import type { RaceVisualPool } from './raceVisuals';

/**
 * Mounts the race visuals inside the mirrored SimRoot. RenderLoop writes their state each frame, so race visuals cause
 * no React rerenders. The pool is disposed on unmount.
 */
export function RaceLayer({ pool }: { pool: RaceVisualPool }) {
  useEffect(() => {
    return () => pool.dispose();
  }, [pool]);
  return <primitive object={pool.root} />;
}
