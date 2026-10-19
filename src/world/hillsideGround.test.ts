/*
 * Ground under the hillside, the road carve, and the dirt roads. The ground is the one height function the terrain, the
 * lamps and the pines read. The main claim: the asphalt is never under the ground, across the full road width, which is
 * the cause of the green patches. The loop's seam is checked too, since the ground wraps there.
 */
import { describe, expect, it } from 'vitest';
import { CITY_NODE_INDEX_MAX, CITY_NODE_INDEX_MIN, HILLSIDE_CELL_COLUMNS, isDirtStreet, nodeHeightMeters, nodeX, nodeZ } from './city/cityLayout';
import { buildLoopCityNetwork } from './city/cityNetwork';
import { GROUND_CLEARANCE_METERS, GROUND_REACH_METERS, hillsideGroundFor } from './hillsideGround';
import type { RoadNetwork, RoadSegment } from './roadTypes';
import { NETWORK_ROAD_HALF_WIDTH_METERS } from '../config/roadConfig';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { buildRoadBoundary } from '../simulation/roadBoundary';

const loop: RoadNetwork = buildLoopCityNetwork();
const ground = hillsideGroundFor(loop);
const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;

/** Samples across a road at its centreline points: the full width, both sides, every `lateralStep` metres. */
function acrossRoad(segment: RoadSegment, lateralStep: number): Array<{ x: number; z: number; y: number }> {
  const points: Array<{ x: number; z: number; y: number }> = [];
  const line = segment.centerline;
  if (!line) return points;
  for (let k = 0; k < line.points.length; k += 1) {
    const p = line.points[k];
    const heading = line.headings[k];
    if (!p || heading === undefined) continue;
    // Right-hand normal of the forward vector (sin h, cos h).
    const nx = Math.cos(heading);
    const nz = -Math.sin(heading);
    for (let o = -NETWORK_ROAD_HALF_WIDTH_METERS; o <= NETWORK_ROAD_HALF_WIDTH_METERS + 1e-9; o += lateralStep) {
      points.push({ x: p.x + nx * o, z: p.z + nz * o, y: p.y });
    }
  }
  return points;
}

describe('ground under the roads', () => {
  it('the asphalt is above the ground across the whole width of every hillside street', () => {
    // Collect violations and assert once: one expect per sample builds a message string each time and is slow.
    let checked = 0;
    const violations: string[] = [];
    for (const segment of loop.segments) {
      const match = /^([HV])-(\d+)-(-?\d+)$/.exec(segment.id);
      if (!match) continue;
      const i = Number(match[2]);
      if (!HILLSIDE_CELL_COLUMNS.includes(i)) continue;
      for (const p of acrossRoad(segment, 0.5)) {
        const limit = p.y - GROUND_CLEARANCE_METERS + 1e-9;
        if (ground.heightAt(p.x, p.z) > limit) violations.push(`${segment.id} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        // A flat road is the same test: the ground sits the clearance under it, even at height zero.
        if (p.y === 0 && ground.heightAt(p.x, p.z) > -GROUND_CLEARANCE_METERS + 1e-9) {
          violations.push(`flat ${segment.id} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        }
        checked += 1;
      }
    }
    expect(violations.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it('the ground under a junction pad is at or under the pad', () => {
    let checked = 0;
    for (const segment of loop.segments) {
      if (segment.kind !== 'junction' || !segment.junction) continue;
      const { centre, halfSizeMeters: h } = segment.junction;
      if (!HILLSIDE_CELL_COLUMNS.some((i) => Math.abs(centre.x - nodeX(i)) < 200)) continue;
      for (let x = centre.x - h; x <= centre.x + h + 1e-9; x += 1) {
        for (let z = centre.z - h; z <= centre.z + h + 1e-9; z += 1) {
          expect(ground.heightAt(x, z), `${segment.id} at ${x},${z}`).toBeLessThanOrEqual(centre.y + 1e-9);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('far from every road, the ground is the natural slope: the mean of the four node heights at the cell centre', () => {
    // Cell (7, 2): its centre is 100 m from every road in the cell, beyond the carve's reach.
    const x = nodeX(7) + 100;
    const z = nodeZ(2) + 100;
    expect(ground.roadDistanceAt(x, z)).toBeGreaterThan(GROUND_REACH_METERS);
    const natural = (nodeHeightMeters(7, 2) + nodeHeightMeters(8, 2) + nodeHeightMeters(7, 3) + nodeHeightMeters(8, 3)) / 4;
    expect(ground.heightAt(x, z)).toBeCloseTo(natural, 9);
  });

  it('the ground wraps across the loop seam: a point one period away is the same point', () => {
    for (const z of [-900, -310, 0, 250, 1000]) {
      expect(ground.heightAt(1205, z)).toBeCloseTo(ground.heightAt(1205 - PERIOD, z), 9);
      expect(ground.heightAt(-1195, z)).toBeCloseTo(ground.heightAt(-1195 + PERIOD, z), 9);
    }
  });

  it('the ground agrees on both sides of the seam: x = 1595 and x = -1205 are one period apart, so they read the same', () => {
    // The seam is at x = 1600 (x = -1200). The mountain straddles it, so the ground is not flat there. Both sides must
    // match, so the car and the terrain see one hill.
    for (const z of [-310, 40, 500]) {
      expect(ground.heightAt(1595, z), `east of the seam at z ${z}`).toBeCloseTo(ground.heightAt(-1205, z), 6);
    }
  });

  it('the road distance is the distance to the nearest road, and infinite when none is in reach', () => {
    // Midway between two streets in the strip, the nearest road is 100 m away: beyond reach, so it reads as far.
    expect(ground.roadDistanceAt(nodeX(7) + 100, nodeZ(2) + 100)).toBeGreaterThan(GROUND_REACH_METERS);
    // On a street centreline the distance is zero.
    expect(ground.roadDistanceAt(nodeX(7), nodeZ(2) + 100)).toBeLessThan(1);
  });

  it('the boundary of the loop shares the segment ids of its dirt roads', () => {
    const dirt = buildRoadBoundary(loop).dirtSegments;
    expect(dirt).toBeDefined();
    expect(dirt?.has('H-7-2')).toBe(isDirtStreet(7, 2));
  });
});

describe('dirt roads', () => {
  it('every hillside street is dirt on an even row or column, and no other street is dirt', () => {
    let dirtCount = 0;
    for (const segment of loop.segments) {
      const match = /^([HV])-(\d+)-(-?\d+)$/.exec(segment.id);
      if (!match) continue;
      const i = Number(match[2]);
      const j = Number(match[3]);
      const expected = isDirtStreet(i, j);
      expect(segment.surface === 'dirt', segment.id).toBe(expected);
      if (expected) dirtCount += 1;
    }
    expect(dirtCount).toBeGreaterThan(0);
  });

  it('the highway row stays asphalt, and junctions stay asphalt', () => {
    expect(isDirtStreet(6, 6)).toBe(false);
    expect(loop.segments.find((segment) => segment.id === 'H-6-6')?.surface ?? 'asphalt').toBe('asphalt');
    for (const segment of loop.segments) {
      if (segment.kind === 'junction') expect(segment.surface ?? 'asphalt').toBe('asphalt');
    }
  });

  it('a street in a flat column is never dirt, and the hillside rows alternate', () => {
    for (let j = CITY_NODE_INDEX_MIN; j <= CITY_NODE_INDEX_MAX - 1; j += 1) {
      expect(isDirtStreet(3, j)).toBe(false);
      expect(isDirtStreet(6, j)).toBe(j % 2 === 0 && j !== 6);
    }
  });
});
