import { forwardRef, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { BufferGeometry, Group, MeshStandardMaterial } from 'three';
import type { VehicleConfig } from '../config/vehicleConfig';
import type { Vec3 } from '../core/types';
import type { VehicleDesignProfile, RimStyle } from '../vehicles/designProfile';
import { bodyPivotPosition, buildVehicleLayout, type VehiclePart, type VehiclePartRole, type LoftPart, type WheelPart } from './vehicleLayout';
import { loftToGeometry } from './vehicleModel/loftGeometry';
import { HEADLIGHT_EMISSIVE, headlightEmissive, registerNightLight } from './nightLights';

/*
 * Procedural car visual. Built in SIMULATION space with the nose at +Z. The parent group (owned by the render loop)
 * sets position and yaw each frame. The mirror lives in SimRoot, so this model matches the simulation.
 *
 * Node hierarchy (names are resolved once by vehicleRig.ts, never by per-frame lookups):
 *   PlayerVehicle                      position and yaw (written by the render loop)
 *   ├── BodyPivot                      cosmetic pitch, roll, and heave. Body parts live here.
 *   ├── WheelSteer<Axle><Side>         front wheels yaw with the steer angle. Rear wheels stay fixed.
 *   │   └── WheelSpin<Axle><Side>      rolls about the axle with distance traveled. Holds tyre, rim, and spokes.
 *
 * Body and wheels are siblings under the root, so suspension effects never change the vehicle's transform.
 * Lofted bodies own a BufferGeometry each. Those are disposed when the design or config changes, and on unmount.
 */

const ROLE_MATERIAL: Record<VehiclePartRole, { color: string; roughness: number; metalness?: number; emissive?: string; emissiveIntensity?: number }> = {
  body: { color: '#b3261e', roughness: 0.45 },
  trim: { color: '#15191e', roughness: 0.6 },
  glass: { color: '#3a5b70', roughness: 0.1, metalness: 0.3 },
  headlight: { color: '#fff6d5', roughness: 0.2, emissive: '#fff1c0', emissiveIntensity: HEADLIGHT_EMISSIVE.day },
  taillight: { color: '#7a0d0d', roughness: 0.2, emissive: '#ff2a2a', emissiveIntensity: 0.7 },
  indicator: { color: '#ffb000', roughness: 0.3, emissive: '#ffb000', emissiveIntensity: 0.25 },
  accent: { color: '#ffffff', roughness: 0.35 },
  metal: { color: '#8d959d', roughness: 0.35, metalness: 0.6 },
  wheel: { color: '#0d0d0d', roughness: 0.9 },
};

/** Spokes per rim style, and their width in metres. Deep dish has no spokes. */
const RIM_SPOKES: Record<RimStyle, { count: number; width: number }> = {
  five: { count: 5, width: 0.05 },
  multi: { count: 10, width: 0.02 },
  turbine: { count: 8, width: 0.07 },
  mesh: { count: 14, width: 0.012 },
  deep: { count: 0, width: 0 },
};

interface VehicleVisualProps {
  config: VehicleConfig;
  design: VehicleDesignProfile;
  /**
   * The colour of the body panels only (parts of role 'body'). Glass, lights, trim, metal, and tyres keep their own
   * materials. Null uses the default body colour. Paint never changes physics.
   */
  paintColor?: string | null;
  /** Extra objects that move with the car, such as the player's headlights. Drawn inside the car's root group. */
  children?: ReactNode;
}

export const VehicleVisual = forwardRef<Group, VehicleVisualProps>(function VehicleVisual({ config, design, paintColor = null, children }, ref) {
  const layout = useMemo(() => buildVehicleLayout(config, design), [config, design]);
  const pivot = useMemo(() => bodyPivotPosition(config), [config]);
  const bodyParts = layout.parts.filter((part) => part.kind !== 'wheel');
  const wheelParts = layout.parts.filter((part): part is WheelPart => part.kind === 'wheel');

  return (
    <group ref={ref} name="PlayerVehicle">
      <group name="BodyPivot" position={[pivot.x, pivot.y, pivot.z]}>
        {bodyParts.map((part, index) => (
          <VehiclePartMesh key={`${part.name}-${index}`} part={part} pivot={pivot} paintColor={paintColor} accent={design.accent} />
        ))}
      </group>
      {wheelParts.map((part) => (
        <WheelAssembly key={part.name} part={part} />
      ))}
      {children}
    </group>
  );
});

/**
 * A headlight material whose glow follows the night level. It registers on mount and unregisters on unmount, so a
 * headlight that is removed never keeps a stale callback.
 */
function HeadlightMaterial({ color }: { color: string }) {
  const ref = useRef<MeshStandardMaterial>(null);
  useEffect(() => {
    const material = ref.current;
    if (!material) return;
    return registerNightLight((level) => {
      material.emissiveIntensity = headlightEmissive(level);
    });
  }, []);
  const base = ROLE_MATERIAL.headlight;
  return (
    <meshStandardMaterial
      ref={ref}
      color={color}
      roughness={base.roughness}
      metalness={base.metalness ?? 0}
      emissive={base.emissive ?? '#000000'}
      emissiveIntensity={HEADLIGHT_EMISSIVE.day}
    />
  );
}

function roleMaterial(role: VehiclePartRole, paintColor: string | null, accent?: string) {
  const base = ROLE_MATERIAL[role];
  const color = role === 'body' && paintColor !== null ? paintColor : role === 'accent' && accent ? accent : base.color;
  if (role === 'headlight') return <HeadlightMaterial color={color} />;
  return (
    <meshStandardMaterial
      color={color}
      roughness={base.roughness}
      metalness={base.metalness ?? 0}
      emissive={base.emissive ?? '#000000'}
      emissiveIntensity={base.emissiveIntensity ?? 0}
    />
  );
}

/** Places one non-wheel part. Positions are relative to the body pivot, so the parts move with the pivot. */
function VehiclePartMesh({
  part,
  pivot,
  paintColor,
  accent,
}: {
  part: Exclude<VehiclePart, WheelPart>;
  pivot: Vec3;
  paintColor: string | null;
  accent: string;
}) {
  if (part.kind === 'loft') return <LoftPartMesh part={part} pivot={pivot} paintColor={paintColor} />;
  const local: [number, number, number] = [part.center.x - pivot.x, part.center.y - pivot.y, part.center.z - pivot.z];

  if (part.kind === 'box') {
    return (
      <mesh name={part.name} position={local} rotation={[0, part.rotationY, 0]}>
        <boxGeometry args={[part.size.x, part.size.y, part.size.z]} />
        {roleMaterial(part.role, paintColor, accent)}
      </mesh>
    );
  }
  if (part.kind === 'cylinder') {
    // CylinderGeometry is along Y by default. Rotate it onto the requested axis.
    const rotation: [number, number, number] = part.axis === 'z' ? [Math.PI / 2, 0, 0] : part.axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0];
    return (
      <mesh name={part.name} position={local} rotation={rotation}>
        <cylinderGeometry args={[part.radius, part.radius, part.length, 16]} />
        {roleMaterial(part.role, paintColor, accent)}
      </mesh>
    );
  }
  // Arch: a half ring over a wheel. The torus ring lies in XY by default; turning it about Y puts it in the YZ plane.
  return (
    <mesh name={part.name} position={local} rotation={[0, Math.PI / 2, 0]}>
      <torusGeometry args={[part.radius, part.tube, 8, 24, Math.PI]} />
      {roleMaterial(part.role, paintColor, accent)}
    </mesh>
  );
}

/** A lofted body or greenhouse. Owns its geometry: built once per mesh, disposed when replaced or unmounted. */
function LoftPartMesh({ part, pivot, paintColor }: { part: LoftPart; pivot: Vec3; paintColor: string | null }) {
  const geometry: BufferGeometry = useMemo(() => loftToGeometry(part.mesh), [part.mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh name={part.name} geometry={geometry} position={[-pivot.x, -pivot.y, -pivot.z]}>
      {roleMaterial(part.role, paintColor)}
    </mesh>
  );
}

/** One wheel: a steer group at the hub, a spin group inside it, and the tyre, rim disc, and spokes. */
function WheelAssembly({ part }: { part: WheelPart }) {
  const { center } = part;
  const suffix = part.name.slice('Wheel'.length);
  const width = part.width;
  const radius = part.radius;
  const steered = part.axle === 'front';
  const outward = part.side === 'left' ? -1 : 1;
  const faceX = outward * (width / 2 + 0.008);
  const spokes = RIM_SPOKES[part.rim];
  const rimRadius = radius * 0.72;

  const spokeNodes: ReactNode[] = [];
  for (let i = 0; i < spokes.count; i += 1) {
    const angle = (2 * Math.PI * i) / spokes.count;
    spokeNodes.push(
      <group key={`spoke-${i}`} rotation={[angle, 0, 0]}>
        <mesh position={[faceX, radius * 0.3, 0]}>
          <boxGeometry args={[0.012, radius * 0.6, spokes.width]} />
          <meshStandardMaterial color={part.rimColor} roughness={0.35} metalness={0.3} />
        </mesh>
      </group>,
    );
  }

  return (
    <group name={`WheelSteer${suffix}`} position={[center.x, center.y, center.z]} userData={{ steered }}>
      <group name={`WheelSpin${suffix}`}>
        {/* The tyre: a cylinder along the axle (X). */}
        <mesh name={part.name} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[radius, radius, width, 22]} />
          <meshStandardMaterial color={ROLE_MATERIAL.wheel.color} roughness={ROLE_MATERIAL.wheel.roughness} />
        </mesh>
        {/* The rim disc on the outer face. */}
        <mesh rotation={[0, 0, Math.PI / 2]} position={[faceX, 0, 0]}>
          <cylinderGeometry args={[rimRadius, rimRadius, 0.012, 18]} />
          <meshStandardMaterial color={part.rimColor} roughness={0.4} metalness={0.4} />
        </mesh>
        {/* Hub cap in the accent colour. Makes rotation readable on every rim style. */}
        <mesh rotation={[0, 0, Math.PI / 2]} position={[faceX + outward * 0.006, 0, 0]}>
          <cylinderGeometry args={[radius * 0.18, radius * 0.18, 0.01, 12]} />
          <meshStandardMaterial color={part.accent} roughness={0.35} />
        </mesh>
        {spokeNodes}
      </group>
    </group>
  );
}
