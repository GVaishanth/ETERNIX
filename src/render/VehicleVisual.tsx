import { forwardRef, useMemo } from 'react';
import type { Group } from 'three';
import type { VehicleConfig } from '../config/vehicleConfig';
import { buildVehicleLayout, type VehiclePart, type VehiclePartKind } from './vehicleLayout';

/*
 * Procedural car visual. Built from buildVehicleLayout(), which is in simulation space with the nose at +Z.
 * The parent group (owned by the render loop) sets position and yaw each frame. The visual itself
 * is NOT rotated here: the simulation-to-render mirror lives in SimRoot, so this model matches
 * the simulation directly. Replace the procedural parts with a real model in the asset phase.
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

interface VehicleVisualProps {
  config: VehicleConfig;
}

export const VehicleVisual = forwardRef<Group, VehicleVisualProps>(function VehicleVisual({ config }, ref) {
  const layout = useMemo(() => buildVehicleLayout(config), [config]);

  return (
    <group ref={ref} name="PlayerVehicle">
      {layout.parts.map((part) => (
        <VehiclePartMesh key={part.name} part={part} />
      ))}
    </group>
  );
});

function VehiclePartMesh({ part }: { part: VehiclePart }) {
  const material = MATERIAL[part.kind];
  const { center } = part;

  if (part.kind === 'wheel') {
    // The cylinder's axis is along Y by default. Rotating it about Z puts the axis along X (the axle direction).
    return (
      <mesh name={part.name} position={[center.x, center.y, center.z]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[part.radius ?? 0.3, part.radius ?? 0.3, part.size.x, 16]} />
        <meshStandardMaterial color={material.color} roughness={material.roughness} />
      </mesh>
    );
  }

  return (
    <mesh name={part.name} position={[center.x, center.y, center.z]}>
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
