import { describe, expect, it } from 'vitest';
import { clamp, damp, moveTowards, shortestAngleDelta, wrapAngle } from './math';

describe('math helpers', () => {
  it('clamps values to the range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
  });

  it('moves toward a target without overshooting', () => {
    expect(moveTowards(0, 10, 3)).toBe(3);
    expect(moveTowards(9, 10, 3)).toBe(10);
    expect(moveTowards(0, -10, 3)).toBe(-3);
  });

  it('wraps angles into [-PI, PI)', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 12);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 9);
  });

  it('takes the shortest path between headings across the wrap boundary', () => {
    const delta = shortestAngleDelta(3, -3);
    expect(Math.abs(delta)).toBeLessThan(Math.PI);
    expect(delta).toBeCloseTo(2 * Math.PI - 6, 9);
  });

  it('damps toward the target and is frame-rate independent', () => {
    const oneLargeStep = damp(0, 1, 5, 0.2);
    let manySmallSteps = 0;
    for (let i = 0; i < 20; i += 1) manySmallSteps = damp(manySmallSteps, 1, 5, 0.01);
    expect(manySmallSteps).toBeCloseTo(oneLargeStep, 6);
  });
});
