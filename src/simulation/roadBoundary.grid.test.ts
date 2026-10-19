import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildRoadBoundary, signedDistance, signedDistanceReference } from './roadBoundary';

/*
 * The bucket grid must match the reference scan. Distances agree to 1e-9 m. Segment ids must agree, except on a seam:
 * where two shapes meet, both distances are within 1e-9 m of zero, and either segment is a correct answer. The
 * reference scan can give the seam answer that the grid skips, because its bounding-box pruning uses >=. The sample is
 * deterministic (fixed-seed linear congruential generator), so a failure reproduces.
 */
const TOLERANCE_M = 1e-9;

function sameAnswer(
  fast: { distance: number; segmentId: string | null },
  slow: { distance: number; segmentId: string | null },
): boolean {
  if (Math.abs(fast.distance - slow.distance) > TOLERANCE_M) return false;
  if (fast.segmentId === slow.segmentId) return true;
  return Math.abs(fast.distance) <= TOLERANCE_M && Math.abs(slow.distance) <= TOLERANCE_M;
}

describe('road boundary grid equivalence', () => {
  const boundary = buildRoadBoundary(buildCityNetwork());

  it('builds a grid for the city', () => {
    expect(boundary.grid).not.toBeNull();
    expect(boundary.shapes.length).toBeGreaterThan(400);
  });

  it('matches the reference scan at 4000 fixed-seed points across the city and its edge', () => {
    let seed = 0x2f6b9d1;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let mismatches = 0;
    for (let n = 0; n < 4000; n += 1) {
      const x = -520 + next() * 1040;
      const z = -520 + next() * 1040;
      const fast = signedDistance(boundary, x, z);
      const slow = signedDistanceReference(boundary, x, z);
      if (!sameAnswer(fast, slow)) {
        mismatches += 1;
        // The first mismatch is reported with its point, so the case can be reproduced.
        if (mismatches === 1) expect({ x, z, fast, slow }).toEqual({ x, z, fast: slow, slow });
      }
    }
    expect(mismatches).toBe(0);
  });

  it('agrees exactly on the road centrelines and the junction pads', () => {
    const network = buildCityNetwork();
    let checked = 0;
    for (const segment of network.segments) {
      const points = segment.centerline ? segment.centerline.points : [];
      for (const point of points.slice(0, 8)) {
        const fast = signedDistance(boundary, point.x, point.z);
        const slow = signedDistanceReference(boundary, point.x, point.z);
        expect(sameAnswer(fast, slow), `${segment.id} ${point.x},${point.z}`).toBe(true);
        checked += 1;
      }
      if (segment.kind === 'junction' && segment.junction) {
        const c = segment.junction.centre;
        expect(sameAnswer(signedDistance(boundary, c.x, c.z), signedDistanceReference(boundary, c.x, c.z))).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('falls back to the reference scan outside the grid, with the same answer', () => {
    expect(signedDistance(boundary, 5000, -9000)).toEqual(signedDistanceReference(boundary, 5000, -9000));
  });
});
