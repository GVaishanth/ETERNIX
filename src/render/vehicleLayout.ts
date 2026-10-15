import type { VehicleConfig } from '../config/vehicleConfig';
import type { Vec3 } from '../core/types';

/*
 * Pure description of the procedural car, in SIMULATION space, relative to the vehicle origin.
 * Origin: center of the rear axle, on the ground (y = 0).
 * Axes:   +X right, +Y up, +Z forward (the nose). The car's nose faces +Z, matching the simulation.
 * The render layer (VehicleVisual) turns these parts into meshes. It does not redefine them.
 */

export type VehiclePartKind = 'body' | 'cabin' | 'glass' | 'headlight' | 'taillight' | 'indicator' | 'wheel';

export interface VehiclePart {
  name: string;
  kind: VehiclePartKind;
  center: Vec3;
  /** Box size, meters. For wheels, `size.x` is the wheel width and `radius` is used instead of the box. */
  size: Vec3;
  /** Wheel radius, meters. Only set for wheels. */
  radius?: number;
  /** Which side the part is on. Used for symmetry checks. */
  side: 'left' | 'right' | 'center';
}

export interface VehicleLayout {
  parts: VehiclePart[];
  /** Front of the body (nose), z in sim space. */
  frontZ: number;
  /** Rear of the body (tail), z in sim space. */
  rearZ: number;
  /** Top of the body roof, y in sim space. */
  roofY: number;
}

const WHEEL_WIDTH_METERS = 0.25;
const REAR_OVERHANG_METERS = 0.8;
const CABIN_LENGTH_FRACTION = 0.5;
const CABIN_WIDTH_FRACTION = 0.85;
const CABIN_HEIGHT_METERS = 0.5;
const GLASS_THICKNESS_METERS = 0.02;
const LIGHT_HEIGHT_FRACTION = 0.6;
const LIGHT_INSET_METERS = 0.3;
const INDICATOR_INSET_METERS = 0.05;
const LIGHT_DEPTH_METERS = 0.03;

export function buildVehicleLayout(config: VehicleConfig): VehicleLayout {
  const { wheelbaseMeters: wheelbase, trackWidthMeters: track, bodyLengthMeters: length } = config;
  const bodyWidth = config.bodyWidthMeters;
  const bodyHeight = config.bodyHeightMeters;
  const wheelRadius = config.wheelRadiusMeters;

  const rearZ = -REAR_OVERHANG_METERS;
  const frontZ = rearZ + length;
  const bodyCenterZ = (rearZ + frontZ) / 2;
  const bodyBottomY = wheelRadius;
  const bodyCenterY = bodyBottomY + bodyHeight / 2;
  const roofY = bodyBottomY + bodyHeight + CABIN_HEIGHT_METERS;

  const cabinLength = length * CABIN_LENGTH_FRACTION;
  const cabinWidth = bodyWidth * CABIN_WIDTH_FRACTION;
  // The cabin sits slightly rearward of center, with the windshield toward the nose.
  const cabinCenterZ = bodyCenterZ - length * 0.05;
  const cabinCenterY = bodyBottomY + bodyHeight + CABIN_HEIGHT_METERS / 2;
  const cabinFrontZ = cabinCenterZ + cabinLength / 2;
  const cabinRearZ = cabinCenterZ - cabinLength / 2;

  const lightY = bodyBottomY + bodyHeight * LIGHT_HEIGHT_FRACTION;
  const lightX = bodyWidth / 2 - LIGHT_INSET_METERS;
  const indicatorX = bodyWidth / 2 - INDICATOR_INSET_METERS;
  const indicatorY = bodyBottomY + bodyHeight * 0.3;

  const parts: VehiclePart[] = [
    {
      name: 'VehicleBody',
      kind: 'body',
      center: { x: 0, y: bodyCenterY, z: bodyCenterZ },
      size: { x: bodyWidth, y: bodyHeight, z: length },
      side: 'center',
    },
    {
      name: 'VehicleCabin',
      kind: 'cabin',
      center: { x: 0, y: cabinCenterY, z: cabinCenterZ },
      size: { x: cabinWidth, y: CABIN_HEIGHT_METERS, z: cabinLength },
      side: 'center',
    },
    {
      name: 'Windshield',
      kind: 'glass',
      center: { x: 0, y: cabinCenterY, z: cabinFrontZ + GLASS_THICKNESS_METERS / 2 },
      size: { x: cabinWidth * 0.9, y: CABIN_HEIGHT_METERS * 0.8, z: GLASS_THICKNESS_METERS },
      side: 'center',
    },
    {
      name: 'RearWindow',
      kind: 'glass',
      center: { x: 0, y: cabinCenterY, z: cabinRearZ - GLASS_THICKNESS_METERS / 2 },
      size: { x: cabinWidth * 0.9, y: CABIN_HEIGHT_METERS * 0.7, z: GLASS_THICKNESS_METERS },
      side: 'center',
    },
    ...sidePair((side, sign) => ({
      name: `SideWindow${sideLabel(side)}`,
      kind: 'glass',
      center: { x: sign * (cabinWidth / 2 + GLASS_THICKNESS_METERS / 2), y: cabinCenterY, z: cabinCenterZ },
      size: { x: GLASS_THICKNESS_METERS, y: CABIN_HEIGHT_METERS * 0.6, z: cabinLength * 0.8 },
      side,
    })),
    ...sidePair((side, sign) => ({
      name: `Headlight${sideLabel(side)}`,
      kind: 'headlight',
      center: { x: sign * lightX, y: lightY, z: frontZ + LIGHT_DEPTH_METERS / 2 },
      size: { x: 0.35, y: 0.12, z: LIGHT_DEPTH_METERS },
      side,
    })),
    ...sidePair((side, sign) => ({
      name: `Taillight${sideLabel(side)}`,
      kind: 'taillight',
      center: { x: sign * lightX, y: lightY, z: rearZ - LIGHT_DEPTH_METERS / 2 },
      size: { x: 0.4, y: 0.12, z: LIGHT_DEPTH_METERS },
      side,
    })),
    ...sidePair((side, sign) => ({
      name: `IndicatorFront${sideLabel(side)}`,
      kind: 'indicator',
      center: { x: sign * indicatorX, y: indicatorY, z: frontZ + LIGHT_DEPTH_METERS / 2 },
      size: { x: 0.08, y: 0.1, z: LIGHT_DEPTH_METERS },
      side,
    })),
    ...sidePair((side, sign) => ({
      name: `IndicatorRear${sideLabel(side)}`,
      kind: 'indicator',
      center: { x: sign * indicatorX, y: indicatorY, z: rearZ - LIGHT_DEPTH_METERS / 2 },
      size: { x: 0.08, y: 0.1, z: LIGHT_DEPTH_METERS },
      side,
    })),
  ];

  // Wheels: front axle at +wheelbase, rear axle at 0. Cylinder axis is along X.
  const halfTrack = track / 2;
  const axles: Array<{ label: string; z: number }> = [
    { label: 'Rear', z: 0 },
    { label: 'Front', z: wheelbase },
  ];
  for (const axle of axles) {
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      parts.push({
        name: `Wheel${axle.label}${sideLabel(side)}`,
        kind: 'wheel',
        center: { x: sign * halfTrack, y: wheelRadius, z: axle.z },
        size: { x: WHEEL_WIDTH_METERS, y: wheelRadius * 2, z: wheelRadius * 2 },
        radius: wheelRadius,
        side,
      });
    }
  }

  return { parts, frontZ, rearZ, roofY };
}

function sideLabel(side: 'left' | 'right'): string {
  return side === 'left' ? 'Left' : 'Right';
}

function sidePair(make: (side: 'left' | 'right', sign: number) => VehiclePart): VehiclePart[] {
  return [make('left', -1), make('right', 1)];
}
