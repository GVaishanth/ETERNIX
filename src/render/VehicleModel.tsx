import { forwardRef } from 'react';
import type { Group } from 'three';
import type { VehicleConfig } from '../config/vehicleConfig';

/**
 * Placeholder procedural car, built in simulation space (nose toward +Z).
 * The origin is the rear-axle center on the ground. The parent group (owned by the loop driver)
 * sets position and yaw each frame. Replace with a real model during the asset phase.
 */

const BODY_COLOR = '#b3261e';
const CABIN_COLOR = '#1d2228';
const WHEEL_COLOR = '#0d0d0d';
const NOSE_COLOR = '#ffd166';
const CABIN_HEIGHT_METERS = 0.5;
const WHEEL_WIDTH_METERS = 0.25;
const NOSE_MARKER_SIZE_METERS = 0.18;

interface VehicleModelProps {
  config: VehicleConfig;
}

export const VehicleModel = forwardRef<Group, VehicleModelProps>(function VehicleModel({ config }, ref) {
  const { wheelbaseMeters: wheelbase, trackWidthMeters: track, bodyLengthMeters: length } = config;
  const wheelRadius = config.wheelRadiusMeters;
  const bodyBottomY = wheelRadius;
  const bodyCenterY = bodyBottomY + config.bodyHeightMeters / 2;
  const cabinCenterY = bodyBottomY + config.bodyHeightMeters + CABIN_HEIGHT_METERS / 2;
  const frontZ = wheelbase / 2 + length / 2;

  return (
    <group ref={ref} name="PlayerVehicle">
      <mesh name="VehicleBody" position={[0, bodyCenterY, wheelbase / 2]}>
        <boxGeometry args={[config.bodyWidthMeters, config.bodyHeightMeters, length]} />
        <meshStandardMaterial color={BODY_COLOR} roughness={0.5} />
      </mesh>
      <mesh name="VehicleCabin" position={[0, cabinCenterY, wheelbase / 2 - length * 0.1]}>
        <boxGeometry args={[config.bodyWidthMeters * 0.85, CABIN_HEIGHT_METERS, length * 0.5]} />
        <meshStandardMaterial color={CABIN_COLOR} roughness={0.3} />
      </mesh>
      {/* Nose marker: confirms forward (+Z) at a glance during debugging. */}
      <mesh name="VehicleNoseMarker" position={[0, bodyCenterY, frontZ + 0.02]}>
        <boxGeometry args={[NOSE_MARKER_SIZE_METERS, NOSE_MARKER_SIZE_METERS, 0.05]} />
        <meshBasicMaterial color={NOSE_COLOR} />
      </mesh>
      {getWheelPositions(track, wheelbase).map(([x, z], index) => (
        <mesh
          key={index}
          name={`Wheel${index}`}
          rotation={[0, 0, Math.PI / 2]}
          position={[x, wheelRadius, z]}
        >
          <cylinderGeometry args={[wheelRadius, wheelRadius, WHEEL_WIDTH_METERS, 16]} />
          <meshStandardMaterial color={WHEEL_COLOR} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
});

/** Wheel centers as [x, z] in the vehicle frame. Rear axle at z = 0, front axle at z = wheelbase. */
function getWheelPositions(track: number, wheelbase: number): Array<[number, number]> {
  const halfTrack = track / 2;
  return [
    [-halfTrack, 0],
    [halfTrack, 0],
    [-halfTrack, wheelbase],
    [halfTrack, wheelbase],
  ];
}
