/*
 * The landing camera's one-off moves: from wherever the camera is to the back view when ENTER GAME is pressed, and back
 * to the same place when the game is left. Pure, so it is tested without WebGL.
 *
 * Angles are in radians, as in heroViews.ts: the back view is pi. A move that starts and ends at the back view turns a
 * full 360 degrees. Any other move takes the shorter way round.
 */
import { wrapAngle } from './showroomOrbit';

export const BACK_VIEW_ANGLE = Math.PI;
const FULL_TURN = 2 * Math.PI;

export interface CameraPose {
  readonly angle: number;
  readonly radius: number;
  readonly height: number;
}

/** A one-off camera move. Each new token starts a new move; 'none' only clears the last one. */
export type CameraMove =
  | { readonly token: number; readonly kind: 'none' }
  | { readonly token: number; readonly kind: 'toBack' }
  | { readonly token: number; readonly kind: 'fromBack'; readonly to: CameraPose };

/** True when an angle is at the back view, within the threshold. */
export function isAtBackView(angle: number, thresholdRadians: number): boolean {
  return Math.abs(wrapAngle(angle - BACK_VIEW_ANGLE)) < thresholdRadians;
}

/**
 * The signed angle the camera turns through, from start to end. When both ends are the back view, the camera makes a
 * full turn. Otherwise it takes the shorter way round.
 */
export function sweepDelta(start: number, end: number, thresholdRadians: number): number {
  if (isAtBackView(start, thresholdRadians) && isAtBackView(end, thresholdRadians)) return FULL_TURN;
  return wrapAngle(end - start);
}

/** Smooth start and stop. Clamped to 0..1. */
export function easeInOut(fraction: number): number {
  const t = Math.min(1, Math.max(0, fraction));
  return t * t * (3 - 2 * t);
}

/** The pose part-way through a move. The angle turns by angleDelta, the radius and height blend to the end pose. */
export function poseAlong(from: CameraPose, to: CameraPose, angleDelta: number, fraction: number): CameraPose {
  const f = easeInOut(fraction);
  return {
    angle: from.angle + angleDelta * f,
    radius: from.radius + (to.radius - from.radius) * f,
    height: from.height + (to.height - from.height) * f,
  };
}
