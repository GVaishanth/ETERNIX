export interface FixedStepOptions {
  /** Time carried over from previous frames, seconds. */
  accumulatorSeconds: number;
  /** Real elapsed time for this frame, seconds. */
  frameSeconds: number;
  /** Simulation step length, seconds. */
  stepSeconds: number;
  /** Upper bound on steps per frame. Prevents a spiral of death after a stall. */
  maxSteps: number;
  /** Upper bound on the frame time that is accepted, seconds. Longer frames are truncated. */
  maxFrameSeconds: number;
}

export interface FixedStepPlan {
  /** Number of simulation steps to run this frame. */
  steps: number;
  /** Time left in the accumulator after the steps, seconds. */
  accumulatorSeconds: number;
  /** Interpolation factor in [0, 1) between the last two simulated states. */
  alpha: number;
  /** Simulated time discarded to stay within maxSteps, seconds. */
  droppedSeconds: number;
}

function sanitizeFrameSeconds(frameSeconds: number, maxFrameSeconds: number): number {
  if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) return 0;
  return Math.min(frameSeconds, maxFrameSeconds);
}

/**
 * Pure fixed-timestep planner. The caller runs `steps` simulation steps, then uses
 * `alpha` to interpolate for rendering. Keeping this function pure makes it testable.
 */
export function planFixedSteps(options: FixedStepOptions): FixedStepPlan {
  const { stepSeconds, maxSteps } = options;
  const frame = sanitizeFrameSeconds(options.frameSeconds, options.maxFrameSeconds);
  let accumulator = options.accumulatorSeconds + frame;
  let steps = 0;

  while (accumulator >= stepSeconds && steps < maxSteps) {
    accumulator -= stepSeconds;
    steps += 1;
  }

  let droppedSeconds = 0;
  if (accumulator >= stepSeconds) {
    const remainder = accumulator % stepSeconds;
    droppedSeconds = accumulator - remainder;
    accumulator = remainder;
  }

  return {
    steps,
    accumulatorSeconds: accumulator,
    alpha: Math.min(Math.max(accumulator / stepSeconds, 0), 1),
    droppedSeconds,
  };
}
