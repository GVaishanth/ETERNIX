/** Timing and cadence constants for the single authoritative game loop. Seconds. */

/** Fixed simulation step. The simulation never uses the raw frame delta directly. */
export const FIXED_STEP_SECONDS = 1 / 60;

/** Frames longer than this are truncated, for example after a tab was hidden. */
export const MAX_FRAME_SECONDS = 0.25;

/** Hard cap on simulation steps per frame (8 steps is about 133 ms of catch-up). */
export const MAX_SUBSTEPS_PER_FRAME = 8;

/** How often the HUD speed readout is pushed into React state. */
export const HUD_PUBLISH_INTERVAL_SECONDS = 0.1;

/** How often development diagnostics are published. Dev builds only. */
export const DIAGNOSTICS_PUBLISH_INTERVAL_SECONDS = 0.2;

/** How often frustum visibility is recomputed. Dev builds only. */
export const VISIBILITY_CHECK_INTERVAL_SECONDS = 0.25;

/** Vehicle spawn point in simulation space. */
export const VEHICLE_SPAWN = { x: 0, y: 0, z: 0 } as const;
export const VEHICLE_SPAWN_YAW_RADIANS = 0;
