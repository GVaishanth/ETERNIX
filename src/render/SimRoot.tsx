import type { ReactNode } from 'react';

/**
 * The single render root for all simulation-space objects. Its Z mirror is the only place that
 * converts the simulation's left-handed axes into Three.js's right-handed space
 * (see src/core/coordinates.ts). Children use simulation coordinates directly.
 * The camera is NOT a child of this group.
 */
export function SimRoot({ children }: { children: ReactNode }) {
  return (
    <group name="SimRoot" scale={[1, 1, -1]}>
      {children}
    </group>
  );
}
