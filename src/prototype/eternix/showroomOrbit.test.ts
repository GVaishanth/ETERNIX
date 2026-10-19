import { describe, expect, it } from 'vitest';
import { SHOWROOM_VIEWS, approachAngle, orbitPosition, viewAngle, wrapAngle } from './showroomOrbit';

const near = (actual: number, expected: number, tolerance = 1e-9): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

describe('showroom views', () => {
  it('has four distinct views', () => {
    expect(SHOWROOM_VIEWS.map((view) => view.id)).toEqual(['threeQuarter', 'side', 'front', 'rear']);
    expect(new Set(SHOWROOM_VIEWS.map((view) => view.label)).size).toBe(4);
  });

  it('puts the front view on the nose side and the rear view on the tail side', () => {
    const front = orbitPosition(viewAngle('front'), 5, 1);
    const rear = orbitPosition(viewAngle('rear'), 5, 1);
    near(front[2], 5);
    near(rear[2], -5);
  });

  it('puts the 3/4 view on the rear-left quarter, the side the landing shows', () => {
    const [x, , z] = orbitPosition(viewAngle('threeQuarter'), 5, 1);
    expect(x).toBeLessThan(0);
    expect(z).toBeLessThan(0);
  });
});

describe('orbit geometry', () => {
  it('keeps the radius and height', () => {
    const [x, y, z] = orbitPosition(0.7, 6.5, 1.3);
    near(Math.hypot(x, z), 6.5);
    near(y, 1.3);
  });

  it('wraps angles into (-pi, pi]', () => {
    near(Math.abs(wrapAngle(3 * Math.PI)), Math.PI);
    near(wrapAngle(0.25), 0.25);
    expect(wrapAngle(-Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 9);
  });
});

describe('approachAngle', () => {
  it('moves toward the goal without passing it', () => {
    const next = approachAngle(0, 1, 2, 0.1);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });

  it('takes the short way round the circle', () => {
    // From just below +pi to just above -pi is a short step forward across the wrap, not a long step back.
    const next = approachAngle(3.1, -3.1, 2, 0.1);
    expect(next).toBeGreaterThan(3.1);
  });

  it('arrives at the goal after enough time', () => {
    let angle = 0;
    for (let i = 0; i < 300; i += 1) angle = approachAngle(angle, Math.PI, 3.2, 1 / 60);
    // -pi and +pi are the same direction, so compare around the circle.
    near(wrapAngle(angle - Math.PI), 0, 1e-3);
  });

  it('does not move when already at the goal', () => {
    near(approachAngle(1.2, 1.2, 3.2, 0.1), 1.2);
  });
});
