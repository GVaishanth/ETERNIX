import { useLayoutEffect, useMemo, useRef } from 'react';
import { Matrix4, type InstancedMesh } from 'three';
import { WORLD_CONFIG } from '../config/worldConfig';
import {
  ROAD_CENTER_Z_METERS,
  ROAD_HALF_WIDTH_METERS,
  ROAD_LENGTH_METERS,
  ROAD_WIDTH_METERS,
  getDashCenterZs,
  getLaneDividerXs,
  getMarkerZs,
} from '../world/roadLayout';

/** Placeholder ground, road, lane lines, and distance markers. Procedural geometry only; no external assets. */

const LINE_HEIGHT_METERS = 0.02;
const LINE_Y_METERS = 0.01;
const GROUND_COLOR = '#3f6b3c';
const ROAD_COLOR = '#2e3034';
const DASH_COLOR = '#ececec';
const EDGE_COLOR = '#f5f5f5';
const MARKER_COLOR = '#f2c94c';
const MAJOR_MARKER_COLOR = '#eb5757';

export function Ground() {
  const size = WORLD_CONFIG.groundHalfExtentMeters * 2;
  return (
    <mesh name="Ground" rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={GROUND_COLOR} roughness={1} />
    </mesh>
  );
}

export function Road() {
  const dashTransforms = useMemo(() => buildDashTransforms(), []);
  const dividerXs = useMemo(() => getLaneDividerXs(), []);

  return (
    <group name="Road">
      <mesh name="RoadSurface" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, ROAD_CENTER_Z_METERS]}>
        <planeGeometry args={[ROAD_WIDTH_METERS, ROAD_LENGTH_METERS]} />
        <meshStandardMaterial color={ROAD_COLOR} roughness={0.9} />
      </mesh>

      <mesh name="EdgeLineLeft" position={[-ROAD_HALF_WIDTH_METERS, LINE_Y_METERS, ROAD_CENTER_Z_METERS]}>
        <boxGeometry args={[WORLD_CONFIG.lineWidthMeters, LINE_HEIGHT_METERS, ROAD_LENGTH_METERS]} />
        <meshBasicMaterial color={EDGE_COLOR} />
      </mesh>
      <mesh name="EdgeLineRight" position={[ROAD_HALF_WIDTH_METERS, LINE_Y_METERS, ROAD_CENTER_Z_METERS]}>
        <boxGeometry args={[WORLD_CONFIG.lineWidthMeters, LINE_HEIGHT_METERS, ROAD_LENGTH_METERS]} />
        <meshBasicMaterial color={EDGE_COLOR} />
      </mesh>

      {dividerXs.map((x) => (
        <DashedLine key={x} x={x} transforms={dashTransforms} />
      ))}

      <DistanceMarkers />
    </group>
  );
}

function buildDashTransforms(): Matrix4[] {
  const transforms: Matrix4[] = [];
  for (const z of getDashCenterZs()) {
    transforms.push(new Matrix4().makeTranslation(0, LINE_Y_METERS, z));
  }
  return transforms;
}

interface DashedLineProps {
  x: number;
  transforms: Matrix4[];
}

/** Dashed lane divider. Each instance is offset by the lane-divider X at render time. */
function DashedLine({ x, transforms }: DashedLineProps) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const offset = new Matrix4().makeTranslation(x, 0, 0);
    const scratch = new Matrix4();
    transforms.forEach((transform, index) => {
      mesh.setMatrixAt(index, scratch.multiplyMatrices(offset, transform));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [x, transforms]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, transforms.length]}>
      <boxGeometry args={[WORLD_CONFIG.lineWidthMeters, LINE_HEIGHT_METERS, WORLD_CONFIG.dashLengthMeters]} />
      <meshBasicMaterial color={DASH_COLOR} />
    </instancedMesh>
  );
}

function DistanceMarkers() {
  const zs = useMemo(() => getMarkerZs(), []);
  return (
    <group name="DistanceMarkers">
      {zs.map((z, index) => {
        const isMajor = index % WORLD_CONFIG.majorMarkerEvery === 0;
        return (
          <mesh key={z} position={[0, LINE_Y_METERS + 0.01, z]}>
            <boxGeometry args={[ROAD_WIDTH_METERS, 0.04, 0.5]} />
            <meshBasicMaterial color={isMajor ? MAJOR_MARKER_COLOR : MARKER_COLOR} />
          </mesh>
        );
      })}
    </group>
  );
}
