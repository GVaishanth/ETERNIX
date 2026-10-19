import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { CITY_SPAWN } from '../world/city/cityLayout';
import {
  buildMinimapModel,
  MINIMAP_PIXELS_PER_METER,
  MINIMAP_SIZE_PX,
  staticLayerSize,
  toMinimapPixels,
  toStaticPixels,
} from './minimapModel';
import { CITY_CELL_INDEX_MAX, CITY_CELL_INDEX_MIN, CITY_NODE_INDEX_MAX, CITY_NODE_INDEX_MIN } from '../world/city/cityLayout';

/*
 * Minimap accuracy (Part 5, test E; updated for the follow view). The model comes from the logical graph, so every
 * street and junction must match the network. Scale is fixed and north is up. The static layer covers the whole
 * populated map, and the visible 220 px window follows the player, so the test checks the layer, not the window.
 */

const NODES_PER_SIDE = CITY_NODE_INDEX_MAX - CITY_NODE_INDEX_MIN + 1;
const CELLS_PER_SIDE = CITY_CELL_INDEX_MAX - CITY_CELL_INDEX_MIN + 1;
const CELL_SIZE_M = 200;

const network = buildCityNetwork();
const model = buildMinimapModel(network);

describe('city minimap model', () => {
  it('draws every street and junction of the logical graph', () => {
    expect(model.streets).toHaveLength(2 * NODES_PER_SIDE * (NODES_PER_SIDE - 1));
    expect(model.junctions).toHaveLength(NODES_PER_SIDE * NODES_PER_SIDE);
    expect(model.districts).toHaveLength(CELLS_PER_SIDE * CELLS_PER_SIDE);
    expect(model.landmarks).toHaveLength(4);
  });

  it('keeps the district tiles covering the whole city with no overlap', () => {
    const area = model.districts.reduce((sum, d) => sum + (d.x1 - d.x0) * (d.z1 - d.z0), 0);
    expect(area).toBeCloseTo(CELLS_PER_SIDE * CELLS_PER_SIDE * CELL_SIZE_M * CELL_SIZE_M, 6);
    for (const a of model.districts) {
      for (const b of model.districts) {
        if (a === b) continue;
        const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const overlapZ = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
        expect(overlapX <= 0 || overlapZ <= 0, `${a.id} and ${b.id}`).toBe(true);
      }
    }
  });

  it('keeps every street point and landmark inside the static layer', () => {
    const { width, height } = staticLayerSize(model.bounds);
    const inside = (p: { px: number; py: number }) => p.px >= 0 && p.px <= width && p.py >= 0 && p.py <= height;
    for (const street of model.streets) {
      for (const point of street.points) {
        expect(inside(toStaticPixels(model.bounds, point.x, point.z))).toBe(true);
      }
    }
    for (const landmark of model.landmarks) {
      expect(inside(toStaticPixels(model.bounds, landmark.x, landmark.z))).toBe(true);
    }
  });

  it('sizes the static layer to the whole network at the fixed scale', () => {
    const { width, height } = staticLayerSize(model.bounds);
    const extent = (CITY_NODE_INDEX_MAX - CITY_NODE_INDEX_MIN) * 200;
    expect(width).toBeGreaterThanOrEqual(extent * MINIMAP_PIXELS_PER_METER);
    expect(height).toBeGreaterThanOrEqual(extent * MINIMAP_PIXELS_PER_METER);
    expect(width).toBeGreaterThan(MINIMAP_SIZE_PX);
  });

  it('uses a fixed scale and puts north (+Z) at the top', () => {
    const origin = toMinimapPixels(model, 0, 0);
    const north = toMinimapPixels(model, 0, 100);
    const east = toMinimapPixels(model, 100, 0);
    expect(origin.px).toBeCloseTo(MINIMAP_SIZE_PX / 2, 6);
    expect(origin.py).toBeCloseTo(MINIMAP_SIZE_PX / 2, 6);
    expect(origin.py - north.py).toBeCloseTo(100 * MINIMAP_PIXELS_PER_METER, 6);
    expect(east.px - origin.px).toBeCloseTo(100 * MINIMAP_PIXELS_PER_METER, 6);
  });

  it('places the spawn marker on the spawn street, inside the canvas', () => {
    const p = toMinimapPixels(model, CITY_SPAWN.position.x, CITY_SPAWN.position.z);
    expect(p.px).toBeGreaterThan(0);
    expect(p.px).toBeLessThan(MINIMAP_SIZE_PX);
    // The spawn is on the H-1-2 centreline (z near 0), so it sits on the horizontal middle line of the map.
    expect(Math.abs(p.py - MINIMAP_SIZE_PX / 2)).toBeLessThan(2);
  });
});
