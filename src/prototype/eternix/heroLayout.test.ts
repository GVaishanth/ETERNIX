import { describe, expect, it } from 'vitest';
import { buildHeroScenery, mulberry32, type HeroSceneryOptions } from './heroLayout';

const OPTIONS: HeroSceneryOptions = {
  seed: 42,
  lengthMeters: 520,
  roadWidthMeters: 14.4,
  kerbWidthMeters: 0.35,
  kerbHeightMeters: 0.14,
  lineWidthMeters: 0.14,
  edgeInsetMeters: 0.35,
  centreGapMeters: 0.18,
  dashLengthMeters: 3,
  dashPeriodMeters: 12,
  buildingSetbackMeters: 9,
  buildingSpacingMeters: 26,
  buildingMinHeightMeters: 12,
  buildingMaxHeightMeters: 42,
  buildingMinDepthMeters: 14,
  buildingMaxDepthMeters: 26,
  windowRowMeters: 3.4,
  windowColumnMeters: 3.6,
  windowLitChance: 0.32,
  farSetbackMeters: 70,
  farSpacingMeters: 24,
  farMinHeightMeters: 40,
  farMaxHeightMeters: 110,
  farLitChance: 0.36,
  lampSpacingMeters: 34,
  lampHeightMeters: 8.5,
  lampSetbackMeters: 1,
  trailSpacingMeters: 14,
  trailMinLengthMeters: 14,
  trailMaxLengthMeters: 48,
  trailHeightMeters: 0.02,
  trailWidthMeters: 0.14,
  trailZMinMeters: -8,
  trailZMaxMeters: 60,
  laneOffsetsMeters: [-5.4, -1.8, 1.8, 5.4],
};

describe('mulberry32', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('buildHeroScenery', () => {
  const scene = buildHeroScenery(OPTIONS);

  it('places the expected count of each element for the road length', () => {
    expect(scene.kerbs).toHaveLength(2);
    expect(scene.pavements).toHaveLength(2);
    expect(scene.markings).toHaveLength(2);
    expect(scene.centreMarkings).toHaveLength(2);
    expect(scene.dashes).toHaveLength(2 * Math.floor(520 / 12));
    expect(scene.lampPosts).toHaveLength(2 * Math.floor(520 / 34));
    expect(scene.lampHeads).toHaveLength(scene.lampPosts.length);
    expect(scene.buildings).toHaveLength(2 * Math.floor(520 / 26));
  });

  it('keeps every box at a positive size and a tone in [0, 1]', () => {
    const all = [...Object.values(scene)].flat();
    expect(all.length).toBeGreaterThan(0);
    for (const box of all) {
      expect(box.sx).toBeGreaterThan(0);
      expect(box.sy).toBeGreaterThan(0);
      expect(box.sz).toBeGreaterThan(0);
      expect(box.tone).toBeGreaterThanOrEqual(0);
      expect(box.tone).toBeLessThanOrEqual(1);
    }
  });

  it('keeps buildings and their windows beyond the pavement, on the correct side of the road', () => {
    const faceDistance = OPTIONS.roadWidthMeters / 2 + OPTIONS.buildingSetbackMeters;
    for (const building of scene.buildings) {
      expect(Math.abs(building.x)).toBeGreaterThanOrEqual(faceDistance - 1e-9);
    }
    for (const window of scene.windows) {
      expect(Math.abs(window.x)).toBeGreaterThanOrEqual(faceDistance - 0.05);
    }
  });

  it('keeps the street inside a bounded box count, so the hero stays cheap to draw', () => {
    const total = Object.values(scene).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBeLessThan(6000);
  });

  it('places the far skyline well behind the near row, and fills it with more lit windows', () => {
    expect(scene.farBuildings).toHaveLength(2 * Math.floor(520 / 24));
    const nearest = Math.min(...scene.buildings.map((b) => Math.abs(b.x)));
    const farthestNear = Math.max(...scene.buildings.map((b) => Math.abs(b.x)));
    const nearestFar = Math.min(...scene.farBuildings.map((b) => Math.abs(b.x)));
    expect(nearestFar).toBeGreaterThan(farthestNear);
    expect(nearest).toBeLessThan(nearestFar);
    const tallest = Math.max(...scene.farBuildings.map((b) => b.sy));
    expect(tallest).toBeGreaterThan(OPTIONS.farMinHeightMeters);
    expect(scene.farWindows.length).toBeGreaterThan(scene.windows.length);
  });

  it('draws red trails only on the left of the road and white trails only on the right', () => {
    expect(scene.trailsRed.length).toBeGreaterThan(0);
    expect(scene.trailsWhite.length).toBeGreaterThan(0);
    for (const trail of scene.trailsRed) expect(trail.x).toBeLessThan(0);
    for (const trail of scene.trailsWhite) expect(trail.x).toBeGreaterThan(0);
  });

  it('keeps every trail inside its band ahead of the camera', () => {
    for (const trail of [...scene.trailsRed, ...scene.trailsWhite]) {
      expect(trail.z - trail.sz / 2).toBeGreaterThanOrEqual(OPTIONS.trailZMinMeters - 1e-9);
      expect(trail.z + trail.sz / 2).toBeLessThanOrEqual(OPTIONS.trailZMaxMeters + 1e-9);
    }
  });

  it('keeps every trail on the road and inside the road length', () => {
    const halfRoad = OPTIONS.roadWidthMeters / 2;
    const halfLength = OPTIONS.lengthMeters / 2;
    for (const trail of [...scene.trailsRed, ...scene.trailsWhite]) {
      expect(Math.abs(trail.x)).toBeLessThan(halfRoad);
      expect(trail.z - trail.sz / 2).toBeGreaterThanOrEqual(-halfLength - 1e-9);
      expect(trail.z + trail.sz / 2).toBeLessThanOrEqual(halfLength + 1e-9);
      expect(trail.sz).toBeGreaterThanOrEqual(OPTIONS.trailMinLengthMeters - 1e-9);
      expect(trail.sz).toBeLessThanOrEqual(OPTIONS.trailMaxLengthMeters + 1e-9);
    }
  });

  it('is the same for the same seed and different for another seed', () => {
    const again = buildHeroScenery(OPTIONS);
    expect(again.buildings).toEqual(scene.buildings);
    expect(again.windows).toEqual(scene.windows);
    expect(again.farWindows).toEqual(scene.farWindows);
    expect(again.trailsRed).toEqual(scene.trailsRed);
    const other = buildHeroScenery({ ...OPTIONS, seed: 43 });
    expect(other.buildings.map((b) => b.sy)).not.toEqual(scene.buildings.map((b) => b.sy));
  });
});
