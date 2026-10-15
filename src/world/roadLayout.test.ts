import { describe, expect, it } from 'vitest';
import { WORLD_CONFIG } from '../config/worldConfig';
import {
  ROAD_HALF_WIDTH_METERS,
  ROAD_WIDTH_METERS,
  getDashCenterZs,
  getLaneCenterXs,
  getLaneDividerXs,
  getMarkerZs,
  getRoadBoundsSim,
} from './roadLayout';

describe('road layout', () => {
  it('spans laneCount lanes of laneWidth centered on X = 0', () => {
    expect(ROAD_WIDTH_METERS).toBeCloseTo(WORLD_CONFIG.laneCount * WORLD_CONFIG.laneWidthMeters, 9);
    expect(ROAD_HALF_WIDTH_METERS).toBeCloseTo(ROAD_WIDTH_METERS / 2, 9);
  });

  it('places lane centers symmetrically around the road centerline', () => {
    const centers = getLaneCenterXs();
    expect(centers).toHaveLength(WORLD_CONFIG.laneCount);
    expect(centers[1]).toBeCloseTo(0, 9);
    expect(centers[0]).toBeCloseTo(-centers[2]!, 9);
  });

  it('places lane dividers between adjacent lane centers', () => {
    const dividers = getLaneDividerXs();
    expect(dividers).toHaveLength(WORLD_CONFIG.laneCount - 1);
    const centers = getLaneCenterXs();
    expect(dividers[0]).toBeCloseTo((centers[0]! + centers[1]!) / 2, 9);
    expect(dividers[1]).toBeCloseTo((centers[1]! + centers[2]!) / 2, 9);
  });

  it('generates dashes only inside the road extent', () => {
    const zs = getDashCenterZs();
    expect(zs.length).toBeGreaterThan(100);
    expect(zs[0]).toBeGreaterThanOrEqual(WORLD_CONFIG.roadStartZMeters);
    expect(zs[zs.length - 1]).toBeLessThan(WORLD_CONFIG.roadEndZMeters);
  });

  it('places distance markers on multiples of the marker spacing', () => {
    const zs = getMarkerZs();
    expect(zs).toContain(0);
    for (const z of zs) {
      expect(z % WORLD_CONFIG.markerSpacingMeters).toBeCloseTo(0, 9);
    }
  });

  it('reports road bounds that run from the start to the end along +Z', () => {
    const bounds = getRoadBoundsSim();
    expect(bounds.min.z).toBe(WORLD_CONFIG.roadStartZMeters);
    expect(bounds.max.z).toBe(WORLD_CONFIG.roadEndZMeters);
    expect(bounds.min.x).toBeCloseTo(-ROAD_HALF_WIDTH_METERS, 9);
    expect(bounds.max.x).toBeCloseTo(ROAD_HALF_WIDTH_METERS, 9);
  });
});
