import { describe, expect, it } from 'vitest';
import { WORLD_CONFIG } from '../config/worldConfig';
import {
  ROAD_HALF_WIDTH_METERS,
  ROAD_WIDTH_METERS,
  SHOULDER_OUTER_HALF_WIDTH_METERS,
  getCenterLineXs,
  getDirectionArrowZs,
  getEdgeLineXs,
  getLaneCenterXs,
  getMarkerZs,
  getRightLaneCenterX,
  getRoadBoundsSim,
  getRoadSegmentBoundsSim,
  getShoulderRanges,
} from './roadLayout';

describe('road layout lanes', () => {
  it('has two lanes that together span the road, centered on X = 0', () => {
    expect(WORLD_CONFIG.laneCount).toBe(2);
    expect(ROAD_WIDTH_METERS).toBeCloseTo(WORLD_CONFIG.laneCount * WORLD_CONFIG.laneWidthMeters, 9);
    expect(ROAD_HALF_WIDTH_METERS).toBeCloseTo(ROAD_WIDTH_METERS / 2, 9);
  });

  it('places lane centers symmetrically on either side of the centerline', () => {
    const centers = getLaneCenterXs();
    expect(centers).toHaveLength(2);
    expect(centers[0]).toBeCloseTo(-centers[1]!, 9);
    expect(centers[1]).toBeCloseTo(WORLD_CONFIG.laneWidthMeters / 2, 9);
  });

  it('spawns and drives traffic in the right lane (+X), matching the right-lane center', () => {
    expect(getRightLaneCenterX()).toBeCloseTo(getLaneCenterXs()[1]!, 9);
    expect(getRightLaneCenterX()).toBeGreaterThan(0);
  });
});

describe('road markings', () => {
  it('draws a double yellow center line: two lines straddling X = 0', () => {
    const xs = getCenterLineXs();
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeCloseTo(-xs[1]!, 9);
    expect(Math.abs(xs[0]!)).toBeGreaterThan(0);
    expect(Math.abs(xs[0]!)).toBeLessThan(WORLD_CONFIG.laneWidthMeters / 2);
  });

  it('places white edge lines just inside each road edge', () => {
    const [left, right] = getEdgeLineXs();
    expect(left).toBeCloseTo(-ROAD_HALF_WIDTH_METERS + WORLD_CONFIG.edgeLineInsetMeters, 9);
    expect(right).toBeCloseTo(ROAD_HALF_WIDTH_METERS - WORLD_CONFIG.edgeLineInsetMeters, 9);
  });

  it('places a contrasting shoulder on each side, outside the road edge', () => {
    const shoulders = getShoulderRanges();
    expect(shoulders).toHaveLength(2);
    expect(shoulders[0]).toEqual({ minX: -SHOULDER_OUTER_HALF_WIDTH_METERS, maxX: -ROAD_HALF_WIDTH_METERS });
    expect(shoulders[1]).toEqual({ minX: ROAD_HALF_WIDTH_METERS, maxX: SHOULDER_OUTER_HALF_WIDTH_METERS });
  });

  it('places distance markers on multiples of the marker spacing', () => {
    const zs = getMarkerZs();
    expect(zs).toContain(0);
    for (const z of zs) {
      expect(z % WORLD_CONFIG.markerSpacingMeters).toBeCloseTo(0, 9);
    }
  });

  it('places direction arrows inside the road extent, at a fixed spacing', () => {
    const zs = getDirectionArrowZs();
    expect(zs.length).toBeGreaterThan(10);
    expect(zs[0]).toBeGreaterThan(WORLD_CONFIG.roadStartZMeters);
    expect(zs[zs.length - 1]).toBeLessThan(WORLD_CONFIG.roadEndZMeters);
    for (let i = 1; i < zs.length; i += 1) {
      expect(zs[i]! - zs[i - 1]!).toBeCloseTo(WORLD_CONFIG.arrowSpacingMeters, 9);
    }
  });
});

describe('road bounds', () => {
  it('reports road bounds that run from the start to the end along +Z', () => {
    const bounds = getRoadBoundsSim();
    expect(bounds.min.z).toBe(WORLD_CONFIG.roadStartZMeters);
    expect(bounds.max.z).toBe(WORLD_CONFIG.roadEndZMeters);
    expect(bounds.min.x).toBeCloseTo(-ROAD_HALF_WIDTH_METERS, 9);
    expect(bounds.max.x).toBeCloseTo(ROAD_HALF_WIDTH_METERS, 9);
  });

  it('clamps a road segment around the car to the road extent', () => {
    const nearStart = getRoadSegmentBoundsSim(-90, 20, 200);
    expect(nearStart.min.z).toBe(WORLD_CONFIG.roadStartZMeters);
    expect(nearStart.max.z).toBeCloseTo(110, 9);

    const nearEnd = getRoadSegmentBoundsSim(3990, 20, 200);
    expect(nearEnd.max.z).toBe(WORLD_CONFIG.roadEndZMeters);
    expect(nearEnd.min.z).toBeCloseTo(3970, 9);
  });

  it('describes a segment that is shorter than the whole road', () => {
    const segment = getRoadSegmentBoundsSim(1000, 20, 200);
    expect(segment.max.z - segment.min.z).toBeCloseTo(220, 9);
  });
});
