import { useEffect } from 'react';
import type { PoliceVisualPool } from './policeVisuals';

/** Mounts the police visual pool into the scene, and disposes it on unmount (StrictMode-safe). */
export function PoliceLayer({ pool }: { pool: PoliceVisualPool }) {
  useEffect(() => {
    return () => pool.dispose();
  }, [pool]);
  return <primitive object={pool.root} />;
}
