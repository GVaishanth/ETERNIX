import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../../config/vehicleConfig';
import { HERO_VIEWS, bodyCentreAheadOfAxle, heroViewPose, nextViewIndex } from './heroViews';

describe('hero views', () => {
  it('has seven views, each with a distinct id and label', () => {
    expect(HERO_VIEWS).toHaveLength(7);
    expect(new Set(HERO_VIEWS.map((view) => view.id)).size).toBe(7);
    expect(new Set(HERO_VIEWS.map((view) => view.label)).size).toBe(7);
  });

  it('starts on the landing view, the low rear three-quarter', () => {
    expect(HERO_VIEWS[0]!.id).toBe('lowRearThreeQuarter');
    expect(HERO_VIEWS[0]!.heightMeters).toBeCloseTo(1.15, 9);
  });

  it('runs around the car in order, so each cut is a short swing', () => {
    const angles = HERO_VIEWS.map((view) => view.angleRadians);
    // Each view is at most 90 degrees from the next, and the last one leads back to the first.
    for (let i = 0; i < angles.length; i += 1) {
      const next = angles[(i + 1) % angles.length]!;
      const gap = Math.abs(Math.atan2(Math.sin(next - angles[i]!), Math.cos(next - angles[i]!)));
      expect(gap).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });

  it('includes a front view, a side profile, and a rear view', () => {
    const ids = HERO_VIEWS.map((view) => view.id);
    expect(ids).toEqual(expect.arrayContaining(['front', 'sideProfile', 'rear']));
  });

  it('keeps every camera height above the ground and below the roofline', () => {
    for (const view of HERO_VIEWS) {
      expect(view.heightMeters).toBeGreaterThan(0.5);
      expect(view.heightMeters).toBeLessThan(4);
    }
  });
});

describe('nextViewIndex', () => {
  it('advances by one and wraps to the first view', () => {
    expect(nextViewIndex(0, 7)).toBe(1);
    expect(nextViewIndex(5, 7)).toBe(6);
    expect(nextViewIndex(6, 7)).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(nextViewIndex(3, 0)).toBe(0);
  });

  it('visits every view once per full cycle', () => {
    const seen = new Set<number>();
    let index = 0;
    for (let i = 0; i < 7; i += 1) {
      seen.add(index);
      index = nextViewIndex(index, 7);
    }
    expect(seen.size).toBe(7);
    expect(index).toBe(0);
  });
});

describe('heroViewPose', () => {
  it('scales the distance with the car length and the view', () => {
    const view = HERO_VIEWS.find((candidate) => candidate.id === 'front')!;
    const pose = heroViewPose(view, 4.5, 3, 1);
    expect(pose.radiusMeters).toBeCloseTo(4.5 * 3 * view.distanceScale, 9);
    expect(pose.angleRadians).toBe(view.angleRadians);
    expect(pose.heightMeters).toBe(view.heightMeters);
  });

  it('applies the narrow zoom to the distance only', () => {
    const view = HERO_VIEWS[0]!;
    const wide = heroViewPose(view, 4.5, 3, 1);
    const narrow = heroViewPose(view, 4.5, 3, 1.4);
    expect(narrow.radiusMeters).toBeCloseTo(wide.radiusMeters * 1.4, 9);
    expect(narrow.heightMeters).toBe(wide.heightMeters);
  });
});

describe('bodyCentreAheadOfAxle', () => {
  it('is the midpoint of the footprint, from the rear to the nose', () => {
    // A body from 0.8 m behind the axle to 3.7 m ahead of it is centred 1.45 m ahead.
    expect(bodyCentreAheadOfAxle(VEHICLE_CONFIG)).toBeCloseTo(1.45, 9);
  });

  it('matches the body length: the centre is the rear extent plus half the length', () => {
    const config = VEHICLE_CONFIG;
    expect(bodyCentreAheadOfAxle(config)).toBeCloseTo(config.footprintRearMeters * -1 + config.bodyLengthMeters / 2, 9);
  });
});
