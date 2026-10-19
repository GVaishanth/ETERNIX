import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { trafficDimensions, TRAFFIC_ROSTER } from '../traffic/trafficTypes';
import { createTrafficModelFactory } from './trafficModel';

/*
 * Model against collision (Part 4 test B and step 8). The rendered bounds of each type must match its collision box:
 * width, length from rear overhang to nose, and height. The wheels touch the ground. Local forward is +Z.
 */
describe('traffic models match their collision dimensions', () => {
  const factory = createTrafficModelFactory();

  for (const type of TRAFFIC_ROSTER) {
    it(`${type.id}: bounds equal width, rear-to-nose length, and roof height`, () => {
      const group = factory.build(type.id, 0);
      group.updateMatrixWorld(true);
      const box = new Box3().setFromObject(group);
      const dims = trafficDimensions(type);
      expect(box.max.x).toBeCloseTo(type.widthMeters / 2, 2);
      expect(box.min.x).toBeCloseTo(-type.widthMeters / 2, 2);
      expect(box.min.z).toBeCloseTo(-dims.rearMeters, 2);
      expect(box.max.z).toBeCloseTo(dims.noseMeters, 2);
      expect(box.max.y).toBeCloseTo(type.heightMeters, 2);
      expect(box.min.y).toBeCloseTo(0, 2);
    });
  }

  it('has a wheel on each corner, at the axle positions', () => {
    for (const type of TRAFFIC_ROSTER) {
      const group = factory.build(type.id, 0);
      const wheels = group.children.filter((child) => child.name.startsWith('Wheel'));
      expect(wheels.length).toBe(4);
      const zs = wheels.map((wheel) => Number(wheel.position.z.toFixed(3))).sort((a, b) => a - b);
      expect(zs).toEqual([0, 0, type.wheelbaseMeters, type.wheelbaseMeters].sort((a, b) => a - b));
    }
  });

  it('gives each type a distinct silhouette, with the van the tallest and longest body', () => {
    const shapes = TRAFFIC_ROSTER.map((type) => {
      const dims = trafficDimensions(type);
      return `${dims.lengthMeters.toFixed(2)}|${type.widthMeters.toFixed(2)}|${type.heightMeters.toFixed(2)}`;
    });
    expect(new Set(shapes).size).toBe(TRAFFIC_ROSTER.length);
    const van = TRAFFIC_ROSTER.find((type) => type.id === 'van');
    expect(van?.heightMeters).toBe(Math.max(...TRAFFIC_ROSTER.map((type) => type.heightMeters)));
    expect(van ? trafficDimensions(van).lengthMeters : 0).toBe(Math.max(...TRAFFIC_ROSTER.map((type) => trafficDimensions(type).lengthMeters)));
  });

  it('shares geometry and materials: building the same type twice creates no new resources', () => {
    const local = createTrafficModelFactory();
    local.build('sedan', 0);
    const before = local.resourceCounts;
    local.build('sedan', 0);
    local.build('sedan', 3);
    expect(local.resourceCounts).toEqual(before);
    local.dispose();
  });
});
