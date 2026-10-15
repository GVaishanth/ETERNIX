import { useEffect, useMemo } from 'react';
import { DoubleSide, Shape, ShapeGeometry } from 'three';
import { WORLD_CONFIG } from '../config/worldConfig';
import {
  ROAD_CENTER_Z_METERS,
  ROAD_LENGTH_METERS,
  ROAD_SURFACE_Y_METERS,
  ROAD_WIDTH_METERS,
  getCenterLineXs,
  getDirectionArrowZs,
  getEdgeLineXs,
  getMarkerZs,
  getRightLaneCenterX,
  getShoulderRanges,
} from '../world/roadLayout';

/*
 * Procedural ground, road, shoulders, lines, markers, and direction arrows. Simulation-space coordinates
 * under SimRoot: the road runs along +Z, and the right lane is at +X. No external assets.
 */

const LINE_HEIGHT_METERS = 0.02;
const LINE_Y_METERS = ROAD_SURFACE_Y_METERS + 0.01;
const SHOULDER_Y_METERS = ROAD_SURFACE_Y_METERS - 0.004;
const ARROW_Y_METERS = ROAD_SURFACE_Y_METERS + 0.02;
const MARKER_Y_METERS = ROAD_SURFACE_Y_METERS + 0.015;

const GROUND_COLOR = '#3f6b3c';
const ROAD_COLOR = '#2e3034';
const SHOULDER_COLOR = '#8e8f86';
const EDGE_COLOR = '#f5f5f5';
const CENTER_LINE_COLOR = '#f2c94c';
const MARKER_COLOR = '#f2c94c';
const MAJOR_MARKER_COLOR = '#eb5757';
const ARROW_COLOR = '#f5f5f5';

/** Layout values are pure functions of the config, so they are computed once at module load. */
const ARROW_ZS = getDirectionArrowZs();
const MARKER_ZS = getMarkerZs();

/** Large ground plane below the road. The fog blends it into the horizon. */
export function Ground() {
  const size = WORLD_CONFIG.groundHalfExtentMeters * 2;
  return (
    <mesh name="Ground" rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, ROAD_CENTER_Z_METERS]}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={GROUND_COLOR} roughness={1} />
    </mesh>
  );
}

export function Road() {
  const shoulders = getShoulderRanges();
  const edgeXs = getEdgeLineXs();
  const centerXs = getCenterLineXs();

  return (
    <group name="Road">
      <mesh name="RoadSurface" rotation={[-Math.PI / 2, 0, 0]} position={[0, ROAD_SURFACE_Y_METERS, ROAD_CENTER_Z_METERS]}>
        <planeGeometry args={[ROAD_WIDTH_METERS, ROAD_LENGTH_METERS]} />
        <meshStandardMaterial color={ROAD_COLOR} roughness={0.9} />
      </mesh>

      {shoulders.map((range, index) => {
        const width = range.maxX - range.minX;
        return (
          <mesh
            key={`shoulder-${index}`}
            name={index === 0 ? 'ShoulderLeft' : 'ShoulderRight'}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[(range.minX + range.maxX) / 2, SHOULDER_Y_METERS, ROAD_CENTER_Z_METERS]}
          >
            <planeGeometry args={[width, ROAD_LENGTH_METERS]} />
            <meshStandardMaterial color={SHOULDER_COLOR} roughness={1} />
          </mesh>
        );
      })}

      {edgeXs.map((x, index) => (
        <mesh
          key={`edge-${index}`}
          name={index === 0 ? 'EdgeLineLeft' : 'EdgeLineRight'}
          position={[x, LINE_Y_METERS, ROAD_CENTER_Z_METERS]}
        >
          <boxGeometry args={[WORLD_CONFIG.lineWidthMeters, LINE_HEIGHT_METERS, ROAD_LENGTH_METERS]} />
          <meshBasicMaterial color={EDGE_COLOR} />
        </mesh>
      ))}

      {centerXs.map((x, index) => (
        <mesh
          key={`center-${index}`}
          name={index === 0 ? 'CenterLineLeft' : 'CenterLineRight'}
          position={[x, LINE_Y_METERS, ROAD_CENTER_Z_METERS]}
        >
          <boxGeometry args={[WORLD_CONFIG.lineWidthMeters, LINE_HEIGHT_METERS, ROAD_LENGTH_METERS]} />
          <meshBasicMaterial color={CENTER_LINE_COLOR} />
        </mesh>
      ))}

      <DirectionArrows zs={ARROW_ZS} />

      <group name="DistanceMarkers">
        {MARKER_ZS.map((z) => {
          const isMajor = Math.round(z / WORLD_CONFIG.markerSpacingMeters) % WORLD_CONFIG.majorMarkerEvery === 0;
          return (
            <mesh key={z} position={[0, MARKER_Y_METERS, z]}>
              <boxGeometry args={[ROAD_WIDTH_METERS, 0.03, isMajor ? 0.8 : 0.4]} />
              <meshBasicMaterial color={isMajor ? MAJOR_MARKER_COLOR : MARKER_COLOR} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/** Arrow shape with its tip at -Y. After the -90 degree X rotation, the tip points along +Z (travel direction). */
function buildArrowGeometry(): ShapeGeometry {
  const shape = new Shape();
  shape.moveTo(0, -1.0);
  shape.lineTo(0.7, -0.2);
  shape.lineTo(0.25, -0.2);
  shape.lineTo(0.25, 0.9);
  shape.lineTo(-0.25, 0.9);
  shape.lineTo(-0.25, -0.2);
  shape.lineTo(-0.7, -0.2);
  shape.closePath();
  return new ShapeGeometry(shape);
}

/** Forward arrows painted on the right lane, pointing the way traffic travels. */
function DirectionArrows({ zs }: { zs: number[] }) {
  const geometry = useMemo(() => buildArrowGeometry(), []);
  const laneX = getRightLaneCenterX();

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group name="DirectionArrows">
      {zs.map((z) => (
        <mesh key={z} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[laneX, ARROW_Y_METERS, z]}>
          <meshBasicMaterial color={ARROW_COLOR} side={DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
