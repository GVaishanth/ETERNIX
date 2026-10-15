import type { Vec3 } from '../core/types';
import { WORLD_CONFIG } from './worldConfig';

/** Timing and cadence constants for the single authoritative game loop. Seconds. */

/** Fixed simulation step. The simulation never uses the raw frame delta directly. */
export const FIXED_STEP_SECONDS = 1 / 60;

/** Frames longer than this are truncated, for example after a tab was hidden. */
export const MAX_FRAME_SECONDS = 0.25;

/** Hard cap on simulation steps per frame (8 steps is about 133 ms of catch-up). */
export const MAX_SUBSTEPS_PER_FRAME = 8;

/** How often the HUD values are pushed into React state. */
export const HUD_PUBLISH_INTERVAL_SECONDS = 0.1;

/** How often development diagnostics are published. Dev builds only. */
export const DIAGNOSTICS_PUBLISH_INTERVAL_SECONDS = 0.2;

/** How often frustum visibility is recomputed. Dev builds only. */
export const VISIBILITY_CHECK_INTERVAL_SECONDS = 0.25;

/** The road-visibility check covers this stretch of road around the car: meters behind and ahead. */
export const ROAD_CHECK_BEHIND_METERS = 20;
export const ROAD_CHECK_AHEAD_METERS = 200;

/**
 * Vehicle spawn point, in simulation space. The car starts in the right lane (+X), facing +Z,
 * with its rear axle on the road surface. Reset returns to this exact pose.
 */
export const VEHICLE_SPAWN: Vec3 = {
  x: WORLD_CONFIG.laneWidthMeters / 2,
  y: 0,
  z: 0,
};
export const VEHICLE_SPAWN_YAW_RADIANS = 0;
