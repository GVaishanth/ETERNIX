import { forwardRef, useMemo } from 'react';
import type { Group } from 'three';
import type { VehicleConfig } from '../config/vehicleConfig';
import type { Vec3 } from '../core/types';
import { bodyPivotPosition, buildVehicleLayout, type VehiclePart, type VehiclePartKind } from './vehicleLayout';

/*
 * Procedural car visual. Built in SIMULATION space with the nose at +Z. The parent group (owned by the render
 * loop) sets position and yaw each frame. The mirror lives in SimRoot, so this model matches the simulation.
 *
 * Node hierarchy (names are resolved once by vehicleRig.ts, never by per-frame lookups):
 *   PlayerVehicle                      position and yaw (written by the render loop)
 *   ├── BodyPivot                      cosmetic pitch, roll, and heave. Body parts live here.
 *   ├── WheelSteer<Axle><Side>         front wheels yaw with the steer angle. Rear wheels stay fixed.
 *   │   └── WheelSpin<Axle><Side>      rolls about the axle with distance traveled. Holds the tire and spokes.
 *
 * Body and wheels are siblings under the root, so suspension effects never change the vehicle's transform.
 */

const MATERIAL: Record<VehiclePartKind, { color: string; roughness: number; emissive?: string; emissiveIntensity?: number }> = {
  body: { color: '#b3261e', roughness: 0.45 },
  cabin: { color: '#1d2228', roughness: 0.35 },
  glass: { color: '#0e1a24', roughness: 0.1 },
  headlight: { color: '#fff6d5', roughness: 0.2, emissive: '#fff1c0', emissiveIntensity: 0.9 },
  taillight: { color: '#7a0d0d', roughness: 0.2, emissive: '#ff2a2a', emissiveIntensity: 0.7 },
  indicator: { color: '#ffb000', roughness: 0.3, emissive: '#ffb000', emissiveIntensity: 0.25 },
  wheel: { color: '#0d0d0d', roughness: 0.9 },
};

const HUB_COLOR = '#9aa3ab';
const SPOKE_COLOR = '#e8ecef';

interface VehicleVisualProps {
  config: VehicleConfig;
}

export const VehicleVisual = forwardRef<Group, VehicleVisualProps>(function VehicleVisual({ config }, ref) {
  const layout = useMemo(() => buildVehicleLayout(config), [config]);
  const pivot = useMemo(() => bodyPivotPosition(config), [config]);
  const bodyParts = layout.parts.filter((part) => part.kind !== 'wheel');
  const wheelParts = layout.parts.filter((part) => part.kind === 'wheel');

  return (
    <group ref={ref} name="PlayerVehicle">
      <group name="BodyPivot" position={[pivot.x, pivot.y, pivot.z]}>
        {bodyParts.map((part) => (
          <VehiclePartMesh key={part.name} part={part} pivot={pivot} />
        ))}
      </group>
      {wheelParts.map((part) => (
        <WheelAssembly key={part.name} part={part} radius={config.wheelRadiusMeters} />
      ))}
    </group>
  );
});

function VehiclePartMesh({ part, pivot }: { part: VehiclePart; pivot: Vec3 }) {
  const material = MATERIAL[part.kind];
  const { center } = part;
  // Positions are relative to the body pivot, so the parts move with the pivot.
  const local: [number, number, number] = [center.x - pivot.x, center.y - pivot.y, center.z - pivot.z];

  return (
    <mesh name={part.name} position={local}>
      <boxGeometry args={[part.size.x, part.size.y, part.size.z]} />
      <meshStandardMaterial
        color={material.color}
        roughness={material.roughness}
        emissive={material.emissive ?? '#000000'}
        emissiveIntensity={material.emissiveIntensity ?? 0}
      />
    </mesh>
  );
}

/** One wheel: a steer group at the hub, a spin group inside it, and the tire, hub, and spoke meshes. */
function WheelAssembly({ part, radius }: { part: VehiclePart; radius: number }) {
  const { center } = part;
  const suffix = part.name.slice('Wheel'.length);
  const width = part.size.x;
  const steered = part.axle === 'front';
  const outward = part.side === 'left' ? -1 : 1;
  const hubOffset = width / 2 + 0.006;
  const spokeOffset = width / 2 + 0.012;

  return (
    <group name={`WheelSteer${suffix}`} position={[center.x, center.y, center.z]} userData={{ steered }}>
      <group name={`WheelSpin${suffix}`}>
        {/* The cylinder's axis is along Y by default. Rotating it about Z puts the axis along X (the axle). */}
        <mesh name={part.name} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[radius, radius, width, 20]} />
          <meshStandardMaterial color={MATERIAL.wheel.color} roughness={MATERIAL.wheel.roughness} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]} position={[outward * hubOffset, 0, 0]}>
          <cylinderGeometry args={[radius * 0.55, radius * 0.55, 0.01, 16]} />
          <meshStandardMaterial color={HUB_COLOR} roughness={0.4} metalness={0.3} />
        </mesh>
        {/* A bright spoke on the outer face. It makes the wheel rotation visible. */}
        <mesh position={[outward * spokeOffset, 0, 0]}>
          <boxGeometry args={[0.012, radius * 1.7, 0.05]} />
          <meshStandardMaterial color={SPOKE_COLOR} roughness={0.35} />
        </mesh>
      </group>
    </group>
  );
}
