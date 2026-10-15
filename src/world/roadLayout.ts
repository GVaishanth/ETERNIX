import { WORLD_CONFIG } from '../config/worldConfig';
import type { Vec3 } from '../core/types';

/*
 * Road layout in SIMULATION space: +X right, +Y up, +Z forward. Pure data and math.
 * The road runs along +Z and is centered on X = 0. Traffic travels in +Z, and the right lane
 * is at +X. Rendering consumes these values and never re-derives them.
 */

export interface AxisAlignedBounds {
  min: Vec3;
  max: Vec3;
}

export interface XRange {
  minX: number;
  maxX: number;
}

/** Top surface of the drivable road, in world Y. Wheel bottoms of a grounded car sit exactly here. */
export const ROAD_SURFACE_Y_METERS = 0;

export const ROAD_WIDTH_METERS = WORLD_CONFIG.laneCount * WORLD_CONFIG.laneWidthMeters;
export const ROAD_HALF_WIDTH_METERS = ROAD_WIDTH_METERS / 2;
export const ROAD_LENGTH_METERS = WORLD_CONFIG.roadEndZMeters - WORLD_CONFIG.roadStartZMeters;
export const ROAD_CENTER_Z_METERS = (WORLD_CONFIG.roadStartZMeters + WORLD_CONFIG.roadEndZMeters) / 2;
export const SHOULDER_OUTER_HALF_WIDTH_METERS = ROAD_HALF_WIDTH_METERS + WORLD_CONFIG.shoulderWidthMeters;

/** Center X of each lane, from left to right. Lane 0 is the left lane (-X). */
export function getLaneCenterXs(): number[] {
  const centers: number[] = [];
  for (let i = 0; i < WORLD_CONFIG.laneCount; i += 1) {
    centers.push(-ROAD_HALF_WIDTH_METERS + (i + 0.5) * WORLD_CONFIG.laneWidthMeters);
  }
  return centers;
}

/** Center X of the rightmost lane, which is the direction of travel for +Z traffic. */
export function getRightLaneCenterX(): number {
  return ROAD_HALF_WIDTH_METERS - WORLD_CONFIG.laneWidthMeters / 2;
}

/** X positions of the two yellow center lines (double yellow, one line on each side of X = 0). */
export function getCenterLineXs(): number[] {
  const offset = WORLD_CONFIG.centerLineOffsetMeters;
  return [-offset, offset];
}

/** X positions of the white edge lines, just inside each road edge. */
export function getEdgeLineXs(): number[] {
  const inset = ROAD_HALF_WIDTH_METERS - WORLD_CONFIG.edgeLineInsetMeters;
  return [-inset, inset];
}

/** Shoulder bands beside the road, one on each side. */
export function getShoulderRanges(): XRange[] {
  return [
    { minX: -SHOULDER_OUTER_HALF_WIDTH_METERS, maxX: -ROAD_HALF_WIDTH_METERS },
    { minX: ROAD_HALF_WIDTH_METERS, maxX: SHOULDER_OUTER_HALF_WIDTH_METERS },
  ];
}

/** X positions for roadside posts, one on each side, outside the shoulder. */
export function getRoadsidePostXs(): number[] {
  const x = SHOULDER_OUTER_HALF_WIDTH_METERS + WORLD_CONFIG.roadsidePostOffsetMeters;
  return [-x, x];
}

/** X positions for roadside trees, one on each side, beyond the posts. */
export function getRoadsideTreeXs(): number[] {
  const x = SHOULDER_OUTER_HALF_WIDTH_METERS + WORLD_CONFIG.treeOffsetFromShoulderMeters;
  return [-x, x];
}

/** Z positions that are whole multiples of `spacing` inside [start, end]. */
function multiplesWithin(spacing: number, start: number, end: number): number[] {
  const values: number[] = [];
  const first = Math.ceil(start / spacing);
  const last = Math.floor(end / spacing);
  for (let index = first; index <= last; index += 1) {
    values.push(index * spacing);
  }
  return values;
}

/** Z positions for distance markers across the road. */
export function getMarkerZs(): number[] {
  return multiplesWithin(WORLD_CONFIG.markerSpacingMeters, WORLD_CONFIG.roadStartZMeters, WORLD_CONFIG.roadEndZMeters);
}

/** Z positions for direction arrows on the right lane. */
export function getDirectionArrowZs(): number[] {
  const first = WORLD_CONFIG.roadStartZMeters + WORLD_CONFIG.arrowFirstOffsetMeters;
  const zs: number[] = [];
  for (let z = first; z < WORLD_CONFIG.roadEndZMeters - WORLD_CONFIG.arrowSpacingMeters / 2; z += WORLD_CONFIG.arrowSpacingMeters) {
    zs.push(z);
  }
  return zs;
}

/** Z positions for roadside posts. */
export function getRoadsidePostZs(): number[] {
  return multiplesWithin(WORLD_CONFIG.roadsidePostSpacingMeters, WORLD_CONFIG.roadStartZMeters, WORLD_CONFIG.roadEndZMeters);
}

/** Z positions for roadside trees. */
export function getRoadsideTreeZs(): number[] {
  return multiplesWithin(WORLD_CONFIG.treeSpacingMeters, WORLD_CONFIG.roadStartZMeters, WORLD_CONFIG.roadEndZMeters);
}

/** Axis-aligned bounds of the whole drivable road surface in simulation space. */
export function getRoadBoundsSim(): AxisAlignedBounds {
  return {
    min: { x: -ROAD_HALF_WIDTH_METERS, y: ROAD_SURFACE_Y_METERS, z: WORLD_CONFIG.roadStartZMeters },
    max: { x: ROAD_HALF_WIDTH_METERS, y: ROAD_SURFACE_Y_METERS, z: WORLD_CONFIG.roadEndZMeters },
  };
}

/**
 * Bounds of the road section around a point along Z: `behind` meters back and `ahead` meters forward,
 * clamped to the road. Used for visibility checks, so "road in view" means a meaningful stretch of road.
 */
export function getRoadSegmentBoundsSim(centerZ: number, behindMeters: number, aheadMeters: number): AxisAlignedBounds {
  const minZ = Math.max(WORLD_CONFIG.roadStartZMeters, centerZ - behindMeters);
  const maxZ = Math.min(WORLD_CONFIG.roadEndZMeters, centerZ + aheadMeters);
  return {
    min: { x: -ROAD_HALF_WIDTH_METERS, y: ROAD_SURFACE_Y_METERS, z: minZ },
    max: { x: ROAD_HALF_WIDTH_METERS, y: ROAD_SURFACE_Y_METERS, z: maxZ },
  };
}
