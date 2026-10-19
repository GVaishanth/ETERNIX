import { describe, expect, it } from 'vitest';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { buildRoadBoundary, normalAt, signedDistance, signedDistanceReference, type RoadBoundary } from './roadBoundary';

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
const ROW_Z = -400; // Node row j = 0: an east-west street.

const torus: RoadBoundary = buildRoadBoundary(buildLoopCityNetwork());

/** Brute force torus distance: the base reference scan over the nine nearest images. Exact, but slow. */
function bruteTorus(boundary: RoadBoundary, x: number, z: number): number {
  let best = Infinity;
  for (const ox of [-1, 0, 1]) {
    for (const oz of [-1, 0, 1]) {
      const d = signedDistanceReference(boundary, x + ox * PERIOD, z + oz * PERIOD).distance;
      if (d < best) best = d;
    }
  }
  return best;
}

describe('torus boundary', () => {
  it('marks the loop boundary as periodic and the finite city as not', () => {
    expect(torus.periodMeters).toBe(PERIOD);
    expect(buildRoadBoundary(buildCityNetwork()).periodMeters).toBeNull();
  });

  it('is the same at a point and one period away', () => {
    for (const x of [-1195, -600, 0, 900, 1195]) {
      for (const z of [ROW_Z, -800, 0, 1195]) {
        expect(signedDistance(torus, x + PERIOD, z).distance).toBeCloseTo(signedDistance(torus, x, z).distance, 9);
        expect(signedDistance(torus, x, z - PERIOD).distance).toBeCloseTo(signedDistance(torus, x, z).distance, 9);
      }
    }
  });

  it('is continuous across the east-west seam, so a road on one side is road on the other', () => {
    // Just west of the seam (x = 1195) and just east of it (x = 1205, which is -1195 in the base domain). Both on the
    // H-7 street, which ends at 1190 and continues into the H-(-4) street at -1200.
    const west = signedDistance(torus, 1195, ROW_Z);
    const east = signedDistance(torus, 1205, ROW_Z);
    expect(west.distance).toBeLessThan(0);
    expect(east.distance).toBeLessThan(0);
    expect(east.segmentId).not.toBeNull();
  });

  it('matches a brute force nine-image scan near the seams', () => {
    let state = 0x2468ace1;
    const next = (): number => {
      state = (state * 1103515245 + 12345) >>> 0;
      return state / 0x100000000;
    };
    for (let n = 0; n < 300; n += 1) {
      // Points within 150 m of a seam, where the torus result is exact.
      const x = next() < 0.5 ? 1200 - 150 * next() : -1200 + 150 * next();
      const z = -1200 + 2400 * next();
      const fast = signedDistance(torus, x, z).distance;
      const brute = bruteTorus(torus, x, z);
      expect(fast).toBeCloseTo(brute, 6);
    }
  });

  it('gives a unit outward normal across the seam, equal to the normal one period away', () => {
    const here = normalAt(torus, 1195, ROW_Z + 6);
    const there = normalAt(torus, 1195 - PERIOD, ROW_Z + 6);
    expect(Math.hypot(here.x, here.z)).toBeCloseTo(1, 6);
    expect(here.x).toBeCloseTo(there.x, 9);
    expect(here.z).toBeCloseTo(there.z, 9);
  });

  it('keeps the middle of a block positive (outside the road)', () => {
    // Block centres sit 100 m from the nearest road centre line, well outside the 10.2 m boundary.
    expect(signedDistance(torus, 100, 100).distance).toBeGreaterThan(0);
  });
});
