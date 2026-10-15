import { describe, expect, it } from 'vitest';
import { planFixedSteps } from './fixedStep';

const base = { stepSeconds: 0.01, maxSteps: 8, maxFrameSeconds: 0.25 };

describe('planFixedSteps', () => {
  it('runs no steps for a frame shorter than one step and carries the remainder', () => {
    const plan = planFixedSteps({ ...base, accumulatorSeconds: 0, frameSeconds: 0.004 });
    expect(plan.steps).toBe(0);
    expect(plan.accumulatorSeconds).toBeCloseTo(0.004, 9);
    expect(plan.alpha).toBeCloseTo(0.4, 9);
  });

  it('runs the expected number of steps and keeps the leftover time', () => {
    const plan = planFixedSteps({ ...base, accumulatorSeconds: 0, frameSeconds: 0.035 });
    expect(plan.steps).toBe(3);
    expect(plan.accumulatorSeconds).toBeCloseTo(0.005, 9);
    expect(plan.alpha).toBeCloseTo(0.5, 9);
  });

  it('adds carried-over time from the previous frame', () => {
    const plan = planFixedSteps({ ...base, accumulatorSeconds: 0.008, frameSeconds: 0.005 });
    expect(plan.steps).toBe(1);
    expect(plan.accumulatorSeconds).toBeCloseTo(0.003, 9);
  });

  it('truncates very long frames and caps the step count', () => {
    const plan = planFixedSteps({ ...base, accumulatorSeconds: 0, frameSeconds: 5 });
    expect(plan.steps).toBe(base.maxSteps);
    expect(plan.droppedSeconds).toBeGreaterThan(0);
    expect(plan.accumulatorSeconds).toBeLessThan(base.stepSeconds);
  });

  it('ignores negative, NaN, and infinite frame times', () => {
    for (const frameSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planFixedSteps({ ...base, accumulatorSeconds: 0, frameSeconds });
      expect(plan.steps).toBe(0);
      expect(Number.isFinite(plan.accumulatorSeconds)).toBe(true);
    }
  });

  it('keeps alpha within [0, 1]', () => {
    for (let frame = 0; frame < 0.2; frame += 0.0037) {
      const plan = planFixedSteps({ ...base, accumulatorSeconds: 0, frameSeconds: frame });
      expect(plan.alpha).toBeGreaterThanOrEqual(0);
      expect(plan.alpha).toBeLessThanOrEqual(1);
    }
  });
});
