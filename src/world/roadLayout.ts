import { WORLD_CONFIG } from '../config/worldConfig';
import type { Vec3 } from '../core/types';

/*
 * Road layout in SIMULATION space (+X right, +Z forward). Pure data and math.
 * The road runs along +Z and is centered on X = 0. Future collision and AI code should read
 * this module instead of re-deriving widths or lane positions.
 */

export interface AxisAlignedBounds {
  min: Vec3;
  max: Vec3;
}

export const ROAD_WIDTH_METERS = WORLD_CONFIG.laneCount * WORLD_CONFIG.laneWidthMeters;
export const ROAD_HALF_WIDTH_METERS = ROAD_WIDTH_METERS / 2;
export const ROAD_LENGTH_METERS = WORLD_CONFIG.roadEndZMeters - WORLD_CONFIG.roadStartZMeters;
export const ROAD_CENTER_Z_METERS = (WORLD_CONFIG.roadStartZMeters + WORLD_CONFIG.roadEndZMeters) / 2;

/** X position of each lane divider, from left edge to right edge (length laneCount - 1). */
export function getLaneDividerXs(): number[] {
  const dividers: number[] = [];
  for (let i = 1; i < WORLD_CONFIG.laneCount; i += 1) {
    dividers.push(-ROAD_HALF_WIDTH_METERS + i * WORLD_CONFIG.laneWidthMeters);
  }
  return dividers;
}

/** Center X of each lane, from left to right. */
export function getLaneCenterXs(): number[] {
  const centers: number[] = [];
  for (let i = 0; i < WORLD_CONFIG.laneCount; i += 1) {
    centers.push(-ROAD_HALF_WIDTH_METERS + (i + 0.5) * WORLD_CONFIG.laneWidthMeters);
  }
  return centers;
}

/** Z positions of dashed-line segment starts, for the lane dividers. */
export function getDashCenterZs(): number[] {
  const period = WORLD_CONFIG.dashLengthMeters + WORLD_CONFIG.dashGapMeters;
  const centers: number[] = [];
  for (let z = WORLD_CONFIG.roadStartZMeters; z < WORLD_CONFIG.roadEndZMeters; z += period) {
    centers.push(z + WORLD_CONFIG.dashLengthMeters / 2);
  }
  return centers;
}

/** Z positions for distance markers across the road, every markerSpacingMeters. */
export function getMarkerZs(): number[] {
  const markers: number[] = [];
  const first = Math.ceil(WORLD_CONFIG.roadStartZMeters / WORLD_CONFIG.markerSpacingMeters);
  const last = Math.floor(WORLD_CONFIG.roadEndZMeters / WORLD_CONFIG.markerSpacingMeters);
  for (let index = first; index <= last; index += 1) {
    markers.push(index * WORLD_CONFIG.markerSpacingMeters);
  }
  return markers;
}

/** Axis-aligned bounds of the drivable road surface in simulation space. */
export function getRoadBoundsSim(): AxisAlignedBounds {
  return {
    min: { x: -ROAD_HALF_WIDTH_METERS, y: 0, z: WORLD_CONFIG.roadStartZMeters },
    max: { x: ROAD_HALF_WIDTH_METERS, y: 0, z: WORLD_CONFIG.roadEndZMeters },
  };
}
