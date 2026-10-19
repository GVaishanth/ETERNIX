import type { VehicleConfig } from '../config/vehicleConfig';
import type { Vec3 } from '../core/types';
import type { VehicleDesignProfile } from '../vehicles/designProfile';
import { buildBodyParts, bodyFrameFromConfig } from './vehicleModel/bodyParts';
import type { VehiclePart } from './vehicleModel/partTypes';

export type { VehiclePart, VehiclePartRole, BoxPart, CylinderPart, ArchPart, LoftPart, WheelPart } from './vehicleModel/partTypes';

/*
 * Pure description of one procedural car, in SIMULATION space, relative to the vehicle origin.
 * Origin: centre of the rear axle, on the ground (y = 0). Axes: +X right, +Y up, +Z forward (the nose).
 * The render layer (VehicleVisual) turns these parts into meshes. It does not redefine them.
 *
 * Every car shares the collision hull, wheelbase, track, and wheel radius from VEHICLE_CONFIG. Only the body design
 * (silhouette, lights, aero, wheels) varies per car.
 */

export interface VehicleLayout {
  parts: VehiclePart[];
  /** Front of the body (nose), z in sim space. */
  frontZ: number;
  /** Rear of the body (tail), z in sim space. */
  rearZ: number;
  /** Top of the highest roof point, y in sim space. */
  roofY: number;
}

/**
 * Pivot for the cosmetic body (pitch, roll, heave), in simulation space. It sits at the wheelbase midpoint, at
 * wheel-center height. Body parts are placed relative to it. Wheels are NOT inside this pivot.
 */
export function bodyPivotPosition(config: VehicleConfig): Vec3 {
  return { x: 0, y: config.wheelRadiusMeters, z: config.wheelbaseMeters / 2 };
}

export function buildVehicleLayout(config: VehicleConfig, design: VehicleDesignProfile): VehicleLayout {
  const frame = bodyFrameFromConfig(config);
  const parts = buildBodyParts(config, design);

  // Wheels: front axle at +wheelbase, rear axle at 0. Each wheel is a tyre with a rim and spokes (see VehicleVisual).
  const axles: Array<{ label: 'Rear' | 'Front'; z: number; axle: 'rear' | 'front' }> = [
    { label: 'Rear', z: 0, axle: 'rear' },
    { label: 'Front', z: frame.wheelbase, axle: 'front' },
  ];
  for (const axle of axles) {
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      parts.push({
        kind: 'wheel',
        name: `Wheel${axle.label}${sideLabel(side)}`,
        role: 'wheel',
        center: { x: sign * frame.trackHalf, y: frame.wheelRadius, z: axle.z },
        axle: axle.axle,
        side,
        radius: frame.wheelRadius,
        width: design.tireWidth,
        rim: design.rim,
        rimColor: design.rimColor,
        accent: design.accent,
      });
    }
  }

  const roofY = Math.max(...design.cabin.map((station) => station[1]));
  return { parts, frontZ: frame.frontZ, rearZ: frame.rearZ, roofY };
}

export function sideLabel(side: 'left' | 'right'): string {
  return side === 'left' ? 'Left' : 'Right';
}
