/**
 * Part descriptions shared by the pure layout (vehicleLayout.ts, bodyParts.ts) and the render layer (VehicleVisual).
 * Pure types only. Coordinates are in simulation space: origin at the rear-axle centre on the ground, +Y up, nose +Z.
 */
import type { Vec3 } from '../../core/types';
import type { RimStyle } from '../../vehicles/designProfile';
import type { LoftMesh } from './loft';

/**
 * Material role. The render layer maps each role to a material. Only 'body' takes the paint colour, so lights,
 * glass, and trim are never recoloured by paint.
 */
export type VehiclePartRole = 'body' | 'trim' | 'glass' | 'headlight' | 'taillight' | 'indicator' | 'accent' | 'metal' | 'wheel';

export interface BoxPart {
  readonly kind: 'box';
  readonly name: string;
  readonly role: VehiclePartRole;
  readonly center: Vec3;
  readonly size: Vec3;
  /** Rotation about Y, radians. Used for angled lights. */
  readonly rotationY: number;
}

export interface CylinderPart {
  readonly kind: 'cylinder';
  readonly name: string;
  readonly role: VehiclePartRole;
  readonly center: Vec3;
  readonly radius: number;
  readonly length: number;
  readonly axis: 'x' | 'y' | 'z';
}

/** Upper half-ring over a wheel, in the plane perpendicular to the axle (the YZ plane). */
export interface ArchPart {
  readonly kind: 'arch';
  readonly name: string;
  readonly role: VehiclePartRole;
  readonly center: Vec3;
  readonly radius: number;
  readonly tube: number;
}

export interface LoftPart {
  readonly kind: 'loft';
  readonly name: string;
  readonly role: VehiclePartRole;
  /** Absolute simulation-space vertices. The render layer offsets the mesh by the body pivot. */
  readonly mesh: LoftMesh;
}

export interface WheelPart {
  readonly kind: 'wheel';
  readonly name: string;
  readonly role: 'wheel';
  readonly center: Vec3;
  readonly axle: 'front' | 'rear';
  readonly side: 'left' | 'right';
  readonly radius: number;
  readonly width: number;
  readonly rim: RimStyle;
  readonly rimColor: string;
  readonly accent: string;
}

export type VehiclePart = BoxPart | CylinderPart | ArchPart | LoftPart | WheelPart;
