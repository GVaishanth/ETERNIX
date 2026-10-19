/*
 * Camera views for the landing. Pure functions, so they are tested without WebGL.
 *
 * Angles are in radians around the car's vertical axis, the same convention as showroomOrbit.ts: 0 puts the camera on
 * the nose side (+z), and angles grow toward +x. The views run in order around the car, so each cut to the next view
 * is a short swing. The first view is the landing's original low rear three-quarter.
 *
 * Distances are in car lengths (the body length from the car's config), so a short car and a long car fill the frame
 * alike. Heights are the camera's height above the ground, in metres.
 */
import type { VehicleConfig } from '../../config/vehicleConfig';

export type HeroViewId =
  | 'lowRearThreeQuarter'
  | 'highFrontThreeQuarter'
  | 'front'
  | 'frontThreeQuarter'
  | 'sideProfile'
  | 'rearThreeQuarter'
  | 'rear';

export interface HeroView {
  readonly id: HeroViewId;
  readonly label: string;
  readonly angleRadians: number;
  readonly heightMeters: number;
  /** Multiplies the base distance. Above 1 pulls back, below 1 moves in. */
  readonly distanceScale: number;
}

const QUARTER = Math.PI / 4;

/** Seven views, in order around the car. The last view leads back to the first with a 45 degree swing. */
export const HERO_VIEWS: readonly HeroView[] = [
  { id: 'lowRearThreeQuarter', label: 'Low rear three-quarter', angleRadians: 5 * QUARTER, heightMeters: 1.15, distanceScale: 1 },
  { id: 'highFrontThreeQuarter', label: 'High front three-quarter', angleRadians: 7 * QUARTER, heightMeters: 3.6, distanceScale: 0.9 },
  { id: 'front', label: 'Front', angleRadians: 0, heightMeters: 0.9, distanceScale: 1 },
  { id: 'frontThreeQuarter', label: 'Front three-quarter', angleRadians: QUARTER, heightMeters: 0.95, distanceScale: 1 },
  { id: 'sideProfile', label: 'Side profile', angleRadians: 2 * QUARTER, heightMeters: 0.85, distanceScale: 1.05 },
  { id: 'rearThreeQuarter', label: 'Rear three-quarter', angleRadians: 3 * QUARTER, heightMeters: 1.0, distanceScale: 1 },
  { id: 'rear', label: 'Rear', angleRadians: 4 * QUARTER, heightMeters: 1.0, distanceScale: 1.05 },
];

/** The index of the back view (the 'rear' view), used by the handoff into and out of the game. */
export const BACK_VIEW_INDEX = HERO_VIEWS.findIndex((view) => view.id === 'rear');

/** Index of the view after the given one, wrapping to the first. */
export function nextViewIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  return (((current + 1) % count) + count) % count;
}

/**
 * Where the body's centre sits, measured from the rear axle along the car's length. The car's origin is the rear axle
 * on the ground, so the body centre is the midpoint of the footprint from its rear to its nose.
 */
export function bodyCentreAheadOfAxle(config: VehicleConfig): number {
  return (config.footprintFrontMeters - config.footprintRearMeters) / 2;
}

export interface HeroViewPose {
  readonly angleRadians: number;
  readonly radiusMeters: number;
  readonly heightMeters: number;
}

/**
 * The camera pose for a view, relative to the body centre. The narrow zoom pulls the camera back so the car fits a
 * portrait screen. The caller applies it.
 */
export function heroViewPose(view: HeroView, carLengthMeters: number, distanceInCarLengths: number, zoom: number): HeroViewPose {
  return {
    angleRadians: view.angleRadians,
    radiusMeters: carLengthMeters * distanceInCarLengths * view.distanceScale * zoom,
    heightMeters: view.heightMeters,
  };
}
