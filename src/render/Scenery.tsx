import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { Matrix4, type InstancedMesh } from 'three';
import {
  getRoadsidePostXs,
  getRoadsidePostZs,
  getRoadsideTreeXs,
  getRoadsideTreeZs,
} from '../world/roadLayout';

/*
 * Procedural roadside props: posts and trees, placed outside the shoulders. Simulation-space coordinates.
 * Each set is one instanced mesh, so the draw-call count stays low however many props there are.
 */

const POST_HEIGHT_METERS = 1.0;
const POST_SIZE_METERS = 0.15;
const TRUNK_HEIGHT_METERS = 3.0;
const TRUNK_RADIUS_METERS = 0.25;
const CROWN_HEIGHT_METERS = 3.2;
const CROWN_RADIUS_METERS = 1.7;

function buildTranslations(xs: number[], zs: number[], y: number): Matrix4[] {
  const matrices: Matrix4[] = [];
  for (const x of xs) {
    for (const z of zs) {
      matrices.push(new Matrix4().makeTranslation(x, y, z));
    }
  }
  return matrices;
}

export function Scenery() {
  const postMatrices = useMemo(
    () => buildTranslations(getRoadsidePostXs(), getRoadsidePostZs(), POST_HEIGHT_METERS / 2),
    [],
  );
  const trunkMatrices = useMemo(
    () => buildTranslations(getRoadsideTreeXs(), getRoadsideTreeZs(), TRUNK_HEIGHT_METERS / 2),
    [],
  );
  const crownMatrices = useMemo(
    () => buildTranslations(getRoadsideTreeXs(), getRoadsideTreeZs(), TRUNK_HEIGHT_METERS + CROWN_HEIGHT_METERS / 2),
    [],
  );

  return (
    <group name="Scenery">
      <InstancedSet name="RoadsidePosts" matrices={postMatrices}>
        <boxGeometry args={[POST_SIZE_METERS, POST_HEIGHT_METERS, POST_SIZE_METERS]} />
        <meshStandardMaterial color="#e8e8e8" roughness={0.6} />
      </InstancedSet>
      <InstancedSet name="TreeTrunks" matrices={trunkMatrices}>
        <cylinderGeometry args={[TRUNK_RADIUS_METERS, TRUNK_RADIUS_METERS * 1.2, TRUNK_HEIGHT_METERS, 8]} />
        <meshStandardMaterial color="#5a3b22" roughness={0.9} />
      </InstancedSet>
      <InstancedSet name="TreeCrowns" matrices={crownMatrices}>
        <coneGeometry args={[CROWN_RADIUS_METERS, CROWN_HEIGHT_METERS, 8]} />
        <meshStandardMaterial color="#2f6b33" roughness={0.9} />
      </InstancedSet>
    </group>
  );
}

interface InstancedSetProps {
  name: string;
  matrices: Matrix4[];
  children: ReactNode;
}

/** One instanced mesh whose transforms are written once, when the matrices change. */
function InstancedSet({ name, matrices, children }: InstancedSetProps) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  // Geometry and material are owned by the child elements, which R3F disposes on unmount.
  useEffect(() => () => {
    const mesh = meshRef.current;
    mesh?.dispose();
  }, []);

  return (
    <instancedMesh ref={meshRef} name={name} args={[undefined, undefined, matrices.length]}>
      {children}
    </instancedMesh>
  );
}
