import { describe, expect, it } from 'vitest';
import { buildCityInstances } from '../../render/cityInstances';
import { buildRoadBoundary, signedDistance } from '../../simulation/roadBoundary';
import { buildCityNetwork } from './cityNetwork';
import { CITY_LANDMARKS, CITY_NODE_SPACING_METERS, DISTRICT_LABELS, cellCentre, districtOfCell, type DistrictId } from './cityLayout';
import {
  buildCityScenery,
  CELL_EDGE_CLEARANCE_M,
  footprintsOverlap,
  SCENERY_GAP_M,
  type CityBuilding,
  type Footprint,
} from './cityScenery';

/*
 * City scenery rules (Part 5, tests E and F inputs). Every prop is checked against the logical road boundary, the other
 * props, and its cell. No building collider is needed because no drivable point reaches a building.
 */

const network = buildCityNetwork();
const boundary = buildRoadBoundary(network);
const scenery = buildCityScenery();

function inside(footprint: Footprint, x: number, z: number): boolean {
  return x >= footprint.x0 && x <= footprint.x1 && z >= footprint.z0 && z <= footprint.z1;
}

function footprintSamples(footprint: Footprint): Array<{ x: number; z: number }> {
  const mx = (footprint.x0 + footprint.x1) / 2;
  const mz = (footprint.z0 + footprint.z1) / 2;
  const xs = [footprint.x0, mx, footprint.x1];
  const zs = [footprint.z0, mz, footprint.z1];
  const out: Array<{ x: number; z: number }> = [];
  for (const x of xs) for (const z of zs) out.push({ x, z });
  return out;
}

describe('city scenery (test E)', () => {
  it('is deterministic', () => {
    expect(buildCityScenery()).toEqual(scenery);
  });

  it('has buildings in every district but the hillside, and all four landmarks', () => {
    const districts = new Set<DistrictId>(scenery.buildings.map((building: CityBuilding) => building.district));
    // The hillside is bare slope: a building there would float or sink, so it has none by design.
    expect(districts.has('hillside')).toBe(false);
    expect(districts.size).toBe(Object.keys(DISTRICT_LABELS).length - 1);
    for (const landmark of CITY_LANDMARKS) {
      expect(scenery.buildings.some((building) => building.id === landmark.id)).toBe(true);
    }
  });

  it('keeps every footprint at least the scenery gap from every other footprint', () => {
    const footprints = scenery.buildings.map((building) => building.footprint);
    for (let a = 0; a < footprints.length; a += 1) {
      for (let b = a + 1; b < footprints.length; b += 1) {
        const fa = footprints[a];
        const fb = footprints[b];
        if (!fa || !fb) continue;
        expect(footprintsOverlap(fa, fb, SCENERY_GAP_M), `${scenery.buildings[a]?.id} vs ${scenery.buildings[b]?.id}`).toBe(false);
      }
    }
  });

  it('places every footprint inside its own cell, with the edge clearance', () => {
    for (const building of scenery.buildings) {
      const cx = (building.footprint.x0 + building.footprint.x1) / 2;
      const cz = (building.footprint.z0 + building.footprint.z1) / 2;
      const i = Math.floor((cx + 400) / CITY_NODE_SPACING_METERS);
      const j = Math.floor((cz + 400) / CITY_NODE_SPACING_METERS);
      expect(districtOfCell(i, j), building.id).toBe(building.district);
      const c = cellCentre(i, j);
      const limit = CITY_NODE_SPACING_METERS / 2 - CELL_EDGE_CLEARANCE_M;
      expect(building.footprint.x0).toBeGreaterThanOrEqual(c.x - limit - 1e-9);
      expect(building.footprint.x1).toBeLessThanOrEqual(c.x + limit + 1e-9);
      expect(building.footprint.z0).toBeGreaterThanOrEqual(c.z - limit - 1e-9);
      expect(building.footprint.z1).toBeLessThanOrEqual(c.z + limit + 1e-9);
    }
  });

  it('keeps every building outside the drivable boundary, by at least the scenery gap', () => {
    for (const building of scenery.buildings) {
      for (const p of footprintSamples(building.footprint)) {
        const d = signedDistance(boundary, p.x, p.z).distance;
        expect(d, `${building.id} at ${p.x},${p.z}`).toBeGreaterThanOrEqual(SCENERY_GAP_M);
      }
    }
  });

  it('keeps street lamps and signs off the road and clear of buildings', () => {
    const footprints = scenery.buildings.map((building) => building.footprint);
    for (const lamp of scenery.lamps) {
      expect(signedDistance(boundary, lamp.x, lamp.z).distance, lamp.id).toBeGreaterThan(0.5);
      expect(footprints.some((f) => inside(f, lamp.x, lamp.z)), lamp.id).toBe(false);
    }
    for (const sign of scenery.signs) {
      expect(signedDistance(boundary, sign.x, sign.z).distance, sign.id).toBeGreaterThan(0.5);
    }
  });

  it('keeps trees outside the road and off buildings', () => {
    const footprints = scenery.buildings.map((building) => building.footprint);
    for (const tree of scenery.trees) {
      expect(signedDistance(boundary, tree.x, tree.z).distance, tree.id).toBeGreaterThan(tree.crownRadius);
      expect(footprints.some((f) => inside(f, tree.x, tree.z)), tree.id).toBe(false);
    }
  });

  it('keeps landmark parts inside their landmark footprint', () => {
    for (const part of scenery.landmarkParts) {
      const landmark = scenery.buildings.find((building) => building.id === part.landmarkId);
      expect(landmark, part.landmarkId).toBeDefined();
      if (!landmark) continue;
      expect(inside(landmark.footprint, part.x, part.z), `${part.landmarkId} ${part.shape}`).toBe(true);
    }
  });

  it('gives only houses a pitched roof', () => {
    for (const building of scenery.buildings) {
      expect(building.pitchedRoof).toBe(building.kind === 'house');
    }
  });
});

describe('city scenery instancing (test F inputs)', () => {
  it('builds one instance per object and keeps the total bounded', () => {
    const set = buildCityInstances(scenery);
    const houses = scenery.buildings.filter((building) => building.pitchedRoof).length;
    const landmarkCones = scenery.landmarkParts.filter((part) => part.shape === 'cone').length;
    const landmarkCylinders = scenery.landmarkParts.filter((part) => part.shape === 'cylinder').length;
    const landmarkBoxes = scenery.landmarkParts.filter((part) => part.shape === 'box').length;
    expect(set.boxes).toHaveLength(scenery.buildings.length + scenery.signs.length + landmarkBoxes);
    expect(set.cylinders).toHaveLength(scenery.lamps.length + scenery.signs.length + scenery.trees.length + landmarkCylinders);
    // A pine is a cone, and a round tree is a crown. Houses and landmark cones are cones too.
    const pines = scenery.trees.filter((tree) => tree.kind === 'pine').length;
    expect(set.cones).toHaveLength(houses + landmarkCones + pines);
    expect(set.crowns).toHaveLength(scenery.trees.length - pines);
    // Lamp heads and light pools each have one instance per lamp (the night lights, nightLights.ts).
    expect(set.lampHeads).toHaveLength(scenery.lamps.length);
    expect(set.lampPools).toHaveLength(scenery.lamps.length);
    const total = set.boxes.length + set.cylinders.length + set.cones.length + set.crowns.length + set.lampHeads.length + set.lampPools.length;
    // Whole populated grid, one instance per object (Stage B splits this per chunk). Computed at the 2800 m layout with the
    // hillside forest (40 pines per hillside cell, 120 in the mountain centre): 24,850 in total. The budget is a guard
    // against runaway growth, not a measured frame cost.
    expect(total).toBeLessThan(30000);
  });

  it('has finite matrices and integer colours for every instance', () => {
    const set = buildCityInstances(scenery);
    for (const group of [set.boxes, set.cylinders, set.cones, set.crowns]) {
      for (const item of group) {
        expect(item.matrix).toHaveLength(16);
        expect(item.matrix.every((value) => Number.isFinite(value))).toBe(true);
        expect(Number.isInteger(item.colour)).toBe(true);
      }
    }
  });
});
