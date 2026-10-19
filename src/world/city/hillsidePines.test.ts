/*
 * Pines, lamps, and their heights on the hillside. Everything that stands on the hill stands on the ground the terrain
 * uses. A lamp's head is its pole's base plus its height, and the pines keep clear of the roads.
 */
import { describe, expect, it } from 'vitest';
import type { RoadNetwork } from '../roadTypes';
import { hillsideGroundFor, GROUND_REACH_METERS } from '../hillsideGround';
import { buildLoopCityNetwork } from './cityNetwork';
import { buildCityScenery, buildStreetLamps } from './cityScenery';
import { buildCityInstances } from '../../render/cityInstances';
import {
  CITY_CELL_INDEX_MAX,
  CITY_CELL_INDEX_MIN,
  CITY_NODE_INDEX_MAX,
  HILLSIDE_CELL_COLUMNS,
  districtOfCell,
  isMountainCentreCell,
  nodeX,
  nodeZ,
} from './cityLayout';

const loop: RoadNetwork = buildLoopCityNetwork();
const ground = hillsideGroundFor(loop);
const scenery = buildCityScenery(undefined, ground);

/** The hillside cell that contains a point, from node positions. */
function inHillsideCell(x: number, z: number): boolean {
  const i = Math.floor(x / 200) + 2;
  return HILLSIDE_CELL_COLUMNS.includes(i) && z >= nodeZ(-4) && z < nodeZ(CITY_NODE_INDEX_MAX);
}

describe('pine trees on the hillside', () => {
  const pines = scenery.trees.filter((tree) => tree.kind === 'pine');

  it('are placed on hillside cells only, and each one is on the ground under it', () => {
    expect(pines.length).toBeGreaterThan(50);
    // Dense forest: every hillside cell holds at least 30 pines.
    const perCell = new Map<string, number>();
    for (const tree of pines) {
      const key = `${Math.floor(tree.x / 200)},${Math.floor(tree.z / 200)}`;
      perCell.set(key, (perCell.get(key) ?? 0) + 1);
    }
    let hillCells = 0;
    for (let i = CITY_CELL_INDEX_MIN; i <= CITY_CELL_INDEX_MAX; i += 1) {
      for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
        if (districtOfCell(i, j) !== 'hillside') continue;
        hillCells += 1;
        expect(perCell.get(`${i - 2},${j - 2}`) ?? 0, `pines in cell ${i},${j}`).toBeGreaterThanOrEqual(30);
      }
    }
    expect(hillCells).toBeGreaterThan(0);
    for (const tree of pines) {
      expect(inHillsideCell(tree.x, tree.z), tree.id).toBe(true);
      expect(tree.baseY, tree.id).toBeCloseTo(ground.heightAt(tree.x, tree.z), 9);
    }
  });

  it('the mountain centre is dense: every centre cell holds 100 to 150 pines, and the other hillside cells keep 40', () => {
    const counts = new Map<string, number>();
    for (const tree of pines) {
      const key = `${Math.floor(tree.x / 200)},${Math.floor(tree.z / 200)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let centre = 0;
    for (let i = CITY_CELL_INDEX_MIN; i <= CITY_CELL_INDEX_MAX; i += 1) {
      for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
        if (districtOfCell(i, j) !== 'hillside') continue;
        const count = counts.get(`${i - 2},${j - 2}`) ?? 0;
        if (isMountainCentreCell(i, j)) {
          centre += 1;
          expect(count, `centre cell ${i},${j}`).toBeGreaterThanOrEqual(100);
          expect(count, `centre cell ${i},${j}`).toBeLessThanOrEqual(150);
        } else {
          expect(count, `edge cell ${i},${j}`).toBeLessThanOrEqual(40);
        }
      }
    }
    // The centre is the ridge: at least a few cells, and not the whole mountain.
    expect(centre).toBeGreaterThanOrEqual(8);
  });

  it('stay clear of every road: never within the carve reach of a centreline', () => {
    for (const tree of pines) {
      expect(ground.roadDistanceAt(tree.x, tree.z), tree.id).toBeGreaterThanOrEqual(GROUND_REACH_METERS + 2);
    }
  });

  it('are on the slope, not the flat: pines on the crest stand higher than the foot of the hill', () => {
    const heights = pines.map((tree) => tree.baseY);
    expect(Math.max(...heights)).toBeGreaterThan(5);
    expect(Math.min(...heights)).toBeLessThan(1);
  });

  it('no pine appears on a flat cell: the flat cells keep their round trees', () => {
    const flatRounds = scenery.trees.filter((tree) => tree.kind === 'round');
    expect(flatRounds.length).toBeGreaterThan(0);
    for (const tree of flatRounds) {
      expect(inHillsideCell(tree.x, tree.z), tree.id).toBe(false);
    }
  });

  it('a pine has a cone crown above its trunk, in the instance data', () => {
    const set = buildCityInstances({ ...scenery, trees: pines.slice(0, 1) });
    const pine = pines[0];
    if (!pine) throw new Error('no pine');
    // The trunk stands on the ground; the cone's base sits on the trunk's top.
    const trunk = set.cylinders.find((c) => Math.abs((c.matrix[12] ?? NaN) - pine.x) < 1e-6 && Math.abs((c.matrix[14] ?? NaN) - pine.z) < 1e-6);
    expect((trunk?.matrix[13] ?? NaN)).toBeCloseTo(pine.baseY, 9);
    const cone = set.cones.find((c) => Math.abs((c.matrix[12] ?? NaN) - pine.x) < 1e-6 && Math.abs((c.matrix[14] ?? NaN) - pine.z) < 1e-6);
    expect((cone?.matrix[13] ?? NaN)).toBeCloseTo(pine.baseY + pine.trunkHeight, 9);
    expect(set.crowns.length).toBe(0);
  });
});

describe('street lamps on the hillside', () => {
  it('every lamp pole stands on the ground under it, and its head is the pole height above that', () => {
    let onSlope = 0;
    for (const lamp of scenery.lamps) {
      expect(lamp.baseY, lamp.id).toBeCloseTo(ground.heightAt(lamp.x, lamp.z), 9);
      if (lamp.baseY > 0.5) onSlope += 1;
    }
    // The hillside streets have lamps on the slope, so the test is about lamps that do not sit at zero.
    expect(onSlope).toBeGreaterThan(0);
  });

  it('the lamp head instance sits at ground plus height, not at height alone', () => {
    const set = buildCityInstances(scenery);
    const lamp = scenery.lamps.find((l) => l.baseY > 0.5);
    if (!lamp) throw new Error('no lamp on the slope');
    const head = set.lampHeads.find((h) => Math.abs((h.matrix[12] ?? NaN) - lamp.x) < 1e-6 && Math.abs((h.matrix[14] ?? NaN) - lamp.z) < 1e-6);
    expect((head?.matrix[13] ?? NaN)).toBeCloseTo(lamp.baseY + lamp.heightMeters, 9);
    const pole = set.cylinders.find((c) => Math.abs((c.matrix[12] ?? NaN) - lamp.x) < 1e-6 && Math.abs((c.matrix[14] ?? NaN) - lamp.z) < 1e-6 && Math.abs((c.matrix[5] ?? NaN) - lamp.heightMeters) < 1e-6);
    expect((pole?.matrix[13] ?? NaN)).toBeCloseTo(lamp.baseY, 9);
  });

  it('a flat-city lamp (no ground) keeps height zero, so the finite city is unchanged', () => {
    const flat = buildStreetLamps('H', 0, 0);
    expect(flat.length).toBeGreaterThan(0);
    for (const lamp of flat) expect(lamp.baseY).toBe(0);
    expect(nodeX(0)).toBe(-400);
  });
});
