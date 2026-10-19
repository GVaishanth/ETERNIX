/*
 * The camera move rules: the back view, the full turn when a move starts or ends at the back view, the shorter swing
 * otherwise, and the pose along a move.
 */
import { describe, expect, it } from 'vitest';
import { HERO_VIEWS, BACK_VIEW_INDEX } from './heroViews';
import { BACK_VIEW_ANGLE, easeInOut, isAtBackView, poseAlong, sweepDelta, type CameraPose } from './cameraMove';

const THRESHOLD = 0.2;
const TAU = 2 * Math.PI;

describe('back view', () => {
  it('matches the rear view in heroViews', () => {
    expect(HERO_VIEWS[BACK_VIEW_INDEX]?.id).toBe('rear');
    expect(HERO_VIEWS[BACK_VIEW_INDEX]?.angleRadians).toBeCloseTo(BACK_VIEW_ANGLE, 10);
  });

  it('counts an angle as the back view only within the threshold', () => {
    expect(isAtBackView(Math.PI, THRESHOLD)).toBe(true);
    expect(isAtBackView(Math.PI + 0.1, THRESHOLD)).toBe(true);
    expect(isAtBackView(Math.PI - 0.15, THRESHOLD)).toBe(true);
    expect(isAtBackView(Math.PI + 0.3, THRESHOLD)).toBe(false);
    expect(isAtBackView(0, THRESHOLD)).toBe(false);
  });
});

describe('sweepDelta', () => {
  it('makes a full turn when the camera is at the back view and the move ends there', () => {
    expect(sweepDelta(Math.PI, Math.PI, THRESHOLD)).toBeCloseTo(TAU, 10);
    expect(sweepDelta(Math.PI + 0.1, Math.PI, THRESHOLD)).toBeCloseTo(TAU, 10);
  });

  it('takes the shorter swing to the back view from any other angle', () => {
    expect(sweepDelta(Math.PI / 4, Math.PI, THRESHOLD)).toBeCloseTo((3 * Math.PI) / 4, 10);
    expect(Math.abs(sweepDelta(0, Math.PI, THRESHOLD))).toBeCloseTo(Math.PI, 10);
    expect(sweepDelta(Math.PI, Math.PI / 4, THRESHOLD)).toBeCloseTo(-(3 * Math.PI) / 4, 10);
  });

  it('does not turn when the start and end are the same non-back angle', () => {
    expect(sweepDelta(Math.PI / 2, Math.PI / 2, THRESHOLD)).toBeCloseTo(0, 10);
  });

  it('returns from the back view to a non-back angle the short way round', () => {
    expect(Math.abs(sweepDelta(Math.PI, 0, THRESHOLD))).toBeCloseTo(Math.PI, 10);
    expect(sweepDelta(Math.PI, 5 * (Math.PI / 4), THRESHOLD)).toBeCloseTo(Math.PI / 4, 10);
  });

  it('makes a full turn on the way back when the page was left at the back view', () => {
    expect(sweepDelta(Math.PI, Math.PI - 0.05, THRESHOLD)).toBeCloseTo(TAU, 10);
  });
});

describe('easeInOut', () => {
  it('starts at 0, ends at 1, and passes the middle at 0.5', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe('poseAlong', () => {
  const from: CameraPose = { angle: 1, radius: 10, height: 3 };
  const to: CameraPose = { angle: Math.PI, radius: 14, height: 1 };
  const delta = Math.PI - 1;

  it('is the start pose at the start and the end pose at the end', () => {
    expect(poseAlong(from, to, delta, 0)).toEqual(from);
    const end = poseAlong(from, to, delta, 1);
    expect(end.angle).toBeCloseTo(Math.PI, 10);
    expect(end.radius).toBeCloseTo(14, 10);
    expect(end.height).toBeCloseTo(1, 10);
  });

  it('is halfway at the halfway point, because the ease is symmetric', () => {
    const middle = poseAlong(from, to, delta, 0.5);
    expect(middle.angle).toBeCloseTo(1 + delta / 2, 10);
    expect(middle.radius).toBeCloseTo(12, 10);
    expect(middle.height).toBeCloseTo(2, 10);
  });
});
