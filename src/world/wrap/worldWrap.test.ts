/*
 * Stage A tests for the wrapped world: wrap arithmetic, boundary crossings, render offsets, index and chunk wrapping, and
 * the geometry derived from the real config and city layout. Pure. No rendering, no browser.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_STREAMING_CONFIG } from '../../config/worldStreamingConfig';
import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import { CITY_CELL_INDEX_MAX, CITY_CELL_INDEX_MIN, CITY_NODE_INDEX_MAX, CITY_NODE_INDEX_MIN, CITY_NODE_SPACING_METERS, cellCentre } from '../city/cityLayout';
import { chunkOfPoint } from '../streaming/chunkGrid';
import { currentWrapGeometry } from './wrapGeometry';
import {
  baseImage,
  boundaryCrossings,
  imageNear,
  renderOffset,
  wrapDelta,
  wrapIndex,
  wrapPoint,
  wrapScalar,
  wrappedChunkOf,
  wrappedDistance,
  validateWrapGeometry,
} from './worldWrap';

const P = 2400;
/** The loop's period, from the config. The geometry tests use it. */
const P_LOOP = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
const EPS = 1e-9;

/** Fixed-seed generator, so the random cases are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('wrapScalar: positive and negative coordinates', () => {
  it('folds positive values into [0, period)', () => {
    expect(wrapScalar(2500, P)).toBeCloseTo(100, 9);
    expect(wrapScalar(1199, P)).toBeCloseTo(1199, 9);
    expect(wrapScalar(7 * P + 3, P)).toBeCloseTo(3, 6);
  });

  it('folds negative values into [0, period)', () => {
    expect(wrapScalar(-100, P)).toBeCloseTo(2300, 9);
    expect(wrapScalar(-1200, P)).toBeCloseTo(1200, 9);
    expect(wrapScalar(-3 * P - 5, P)).toBeCloseTo(P - 5, 6);
  });
});

describe('wrapScalar: exact boundaries and the sides next to them', () => {
  it('maps every multiple of the period to 0', () => {
    expect(wrapScalar(0, P)).toBe(0);
    expect(wrapScalar(P, P)).toBe(0);
    expect(wrapScalar(-P, P)).toBe(0);
    expect(wrapScalar(4 * P, P)).toBe(0);
    expect(wrapScalar(-4 * P, P)).toBe(0);
  });

  it('keeps the side just below a boundary just below the period', () => {
    expect(wrapScalar(P - EPS, P)).toBeCloseTo(P - EPS, 6);
    expect(wrapScalar(P - EPS, P)).toBeLessThan(P);
    expect(wrapScalar(-EPS, P)).toBeCloseTo(P - EPS, 6);
  });

  it('keeps the side just above a boundary just above zero', () => {
    expect(wrapScalar(P + EPS, P)).toBeCloseTo(EPS, 6);
    expect(wrapScalar(EPS, P)).toBeCloseTo(EPS, 6);
    expect(wrapScalar(-P + EPS, P)).toBeCloseTo(EPS, 6);
  });

  it('never returns a value outside [0, period), over a fixed-seed sample of wide range', () => {
    const next = seeded(0x5eed);
    for (let i = 0; i < 20000; i += 1) {
      const value = (next() - 0.5) * 2e6;
      const wrapped = wrapScalar(value, P);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThan(P);
    }
  });

  it('rejects non-finite values and non-positive periods', () => {
    expect(() => wrapScalar(Number.NaN, P)).toThrow(RangeError);
    expect(() => wrapScalar(Number.POSITIVE_INFINITY, P)).toThrow(RangeError);
    expect(() => wrapScalar(10, 0)).toThrow(RangeError);
    expect(() => wrapScalar(10, -P)).toThrow(RangeError);
  });

  it('wraps both axes of a point independently', () => {
    expect(wrapPoint(-100, 2500, P)).toEqual({ x: wrapScalar(-100, P), z: wrapScalar(2500, P) });
  });
});

describe('wrapDelta: the shortest way across a seam', () => {
  it('takes the short way across the east-west seam in both directions', () => {
    expect(wrapDelta(2390, 10, P)).toBeCloseTo(20, 9);
    expect(wrapDelta(10, 2390, P)).toBeCloseTo(-20, 9);
  });

  it('returns a displacement in [-period/2, period/2)', () => {
    const next = seeded(0xd3171);
    for (let i = 0; i < 5000; i += 1) {
      const d = wrapDelta(next() * 9000 - 4500, next() * 9000 - 4500, P);
      expect(d).toBeGreaterThanOrEqual(-P / 2 - EPS);
      expect(d).toBeLessThan(P / 2 + EPS);
    }
  });

  it('sums to the net movement along a path that crosses the seam (no jumps)', () => {
    // A car drives 0.5 m steps from 2395 to 2405 (logical). Each wrapped step is 0.5 m, not a 2400 m jump.
    let total = 0;
    let previous = 2395;
    for (let k = 1; k <= 20; k += 1) {
      const logical = 2395 + 0.5 * k;
      const step = wrapDelta(previous, logical, P);
      expect(step).toBeCloseTo(0.5, 9);
      total += step;
      previous = logical;
    }
    expect(total).toBeCloseTo(10, 6);
  });
});

describe('boundaryCrossings: counting seams, including reverse, repeated, and fast motion', () => {
  it('counts +1 going forward over a seam and -1 going back', () => {
    expect(boundaryCrossings(P - 1, P + 1, P)).toBe(1);
    expect(boundaryCrossings(P + 1, P - 1, P)).toBe(-1);
  });

  it('counts no crossing inside one period', () => {
    expect(boundaryCrossings(10, 1190, P)).toBe(0);
    expect(boundaryCrossings(1190, 10, P)).toBe(0);
    expect(boundaryCrossings(500, 500, P)).toBe(0);
  });

  it('puts an exact boundary on the upper side', () => {
    expect(boundaryCrossings(P - 0.5, P, P)).toBe(1);
    expect(boundaryCrossings(P, P - 0.5, P)).toBe(-1);
    expect(boundaryCrossings(0, -0.5, P)).toBe(-1);
  });

  it('counts every seam passed in one fast step', () => {
    expect(boundaryCrossings(0, 2.5 * P, P)).toBe(2);
    expect(boundaryCrossings(0, -2.5 * P, P)).toBe(-3);
  });

  it('nets to zero over repeated crossings in both directions', () => {
    let net = 0;
    let count = 0;
    let previous = P - 1;
    for (let i = 0; i < 1000; i += 1) {
      const next = i % 2 === 0 ? P + 1 : P - 1;
      const c = boundaryCrossings(previous, next, P);
      net += c;
      count += Math.abs(c);
      previous = next;
    }
    expect(net).toBe(0);
    expect(count).toBe(1000);
  });

  it('counts exact laps: driving ten periods east crosses ten seams and ends on a boundary', () => {
    let total = 0;
    let previous = 0;
    const step = 0.5;
    for (let k = 1; k <= 10 * P / step; k += 1) {
      const logical = k * step;
      total += boundaryCrossings(previous, logical, P);
      previous = logical;
    }
    expect(total).toBe(10);
    expect(wrapScalar(previous, P)).toBe(0);
  });

  it('keeps per-step crossings at most one for a car at 80 m/s at 60 Hz, with the correct total', () => {
    const dt = 1 / 60;
    const speed = 80;
    let logical = 0;
    let total = 0;
    for (let i = 0; i < 60 * 120; i += 1) {
      const next = logical + speed * dt;
      const c = boundaryCrossings(logical, next, P);
      expect(Math.abs(c)).toBeLessThanOrEqual(1);
      total += c;
      logical = next;
    }
    expect(total).toBe(Math.floor(logical / P));
  });
});

describe('renderOffset and distance: continuous across seams', () => {
  it('gives consecutive offsets that differ by the step, across a seam', () => {
    const camera = { x: 2390, z: 0 };
    let previous: number | null = null;
    for (let x = 2380; x <= 2420; x += 1) {
      const { x: offset } = renderOffset(camera, { x, z: 0 }, P);
      if (previous !== null) expect(offset - previous).toBeCloseTo(1, 9);
      previous = offset;
    }
  });

  it('places an object just across the seam at its true distance from the camera', () => {
    expect(renderOffset({ x: 2390, z: 0 }, { x: 2405, z: 0 }, P).x).toBeCloseTo(15, 9);
    expect(renderOffset({ x: 2390, z: 0 }, { x: 5, z: 0 }, P).x).toBeCloseTo(15, 9);
  });

  it('is the same after the camera has driven many laps (the offset depends only on the difference)', () => {
    expect(renderOffset({ x: 5 * P + 2390, z: 0 }, { x: 5 * P + 2405, z: 0 }, P).x).toBeCloseTo(15, 6);
  });

  it('measures distance on the torus', () => {
    expect(wrappedDistance({ x: 2395, z: 0 }, { x: 5, z: 0 }, P)).toBeCloseTo(10, 9);
    expect(wrappedDistance({ x: 2395, z: 2395 }, { x: 5, z: 5 }, P)).toBeCloseTo(Math.hypot(10, 10), 9);
  });

  it('keeps precision far from the origin: 0.1 m steps at a million metres keep their size', () => {
    let previous = wrapScalar(1e6, P);
    for (let k = 1; k <= 100; k += 1) {
      const wrapped = wrapScalar(1e6 + 0.1 * k, P);
      const step = wrapDelta(previous, wrapped, P);
      expect(step).toBeCloseTo(0.1, 6);
      previous = wrapped;
    }
  });
});

describe('wrapIndex: lattice indices', () => {
  it('wraps the lattice range [-4, 7] so that 8 is the same as -4', () => {
    expect(wrapIndex(8, -4, 12)).toBe(-4);
    expect(wrapIndex(-5, -4, 12)).toBe(7);
    expect(wrapIndex(7, -4, 12)).toBe(7);
    expect(wrapIndex(20, -4, 12)).toBe(-4);
    expect(wrapIndex(-4, -4, 12)).toBe(-4);
  });

  it('rejects non-integers and empty ranges', () => {
    expect(() => wrapIndex(1.5, -4, 12)).toThrow(RangeError);
    expect(() => wrapIndex(1, -4, 0)).toThrow(RangeError);
  });
});

describe('the wrap geometry, derived from the config and the city layout', () => {
  it('is a 2800 m period of seven 400 m chunks, on chunks -3 to 3', () => {
    const g = currentWrapGeometry();
    expect(g.periodMeters).toBe(2800);
    expect(g.chunkSizeMeters).toBe(400);
    expect(g.chunkCount).toBe(7);
    expect(g.chunkMin).toBe(-3);
    expect(validateWrapGeometry(g)).toEqual([]);
  });

  it('agrees with the city layout constants (fails if the config and the layout drift apart)', () => {
    expect(WORLD_WRAP_CONFIG.nodeSpacingMeters).toBe(CITY_NODE_SPACING_METERS);
    expect(WORLD_WRAP_CONFIG.firstNodeIndex).toBe(CITY_NODE_INDEX_MIN);
    // The populated lattice has periodNodes + 1 nodes today: node CITY_NODE_INDEX_MAX duplicates node MIN after wrapping.
    expect(WORLD_WRAP_CONFIG.periodNodes).toBe(CITY_NODE_INDEX_MAX - CITY_NODE_INDEX_MIN);
    expect(WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters).toBe(P_LOOP);
    expect(WORLD_WRAP_CONFIG.baseOriginMeters).toBe((WORLD_WRAP_CONFIG.firstNodeIndex - 2) * WORLD_WRAP_CONFIG.nodeSpacingMeters);
    expect(WORLD_STREAMING_CONFIG.chunkSizeMeters).toBe(currentWrapGeometry().chunkSizeMeters);
  });

  it('the populated cells own exactly the chunks -3 to 3', () => {
    const kx = new Set<number>();
    const kz = new Set<number>();
    for (let i = CITY_CELL_INDEX_MIN; i <= CITY_CELL_INDEX_MAX; i += 1) {
      for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
        const c = cellCentre(i, j);
        const chunk = chunkOfPoint(c.x, c.z, WORLD_STREAMING_CONFIG.chunkSizeMeters);
        kx.add(chunk.kx);
        kz.add(chunk.kz);
      }
    }
    expect([...kx].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect([...kz].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it('wraps a chunk index so that the east seam and the west seam name the same chunk', () => {
    const g = currentWrapGeometry();
    // At 2800 m the seam is at x = 1600 = -1200. 1700 and -1100 are the same place, so are -1300 and 1500.
    expect(wrappedChunkOf(1700, 0, g)).toEqual(wrappedChunkOf(-1100, 0, g));
    expect(wrappedChunkOf(-1300, 0, g)).toEqual(wrappedChunkOf(1500, 0, g));
  });

  it('reports invalid geometry: a period that is not a whole number of chunks, or a wrong chunk count', () => {
    expect(validateWrapGeometry({ periodMeters: 2500, chunkSizeMeters: 400, chunkMin: -3, chunkCount: 6 }).length).toBeGreaterThan(0);
    expect(validateWrapGeometry({ periodMeters: 2800, chunkSizeMeters: 400, chunkMin: -3, chunkCount: 6 }).length).toBeGreaterThan(0);
    expect(validateWrapGeometry({ periodMeters: Number.NaN, chunkSizeMeters: 400, chunkMin: -3, chunkCount: 6 }).length).toBeGreaterThan(0);
  });
});

describe('imageNear and baseImage: the images used by traffic and the render', () => {
  const P = 2400;

  it('is the identity when the world is not periodic', () => {
    expect(imageNear(0, 1300, null)).toBe(1300);
    expect(baseImage(1300, null)).toBe(1300);
    expect(baseImage(-7, null)).toBe(-7);
  });

  it('returns the image of the value nearest the reference, across a seam', () => {
    // 1195 and -1195 are 10 m apart across the seam at +-1200.
    expect(imageNear(1195, -1195, P)).toBeCloseTo(1205, 9);
    expect(imageNear(-1195, 1195, P)).toBeCloseTo(-1205, 9);
    // Values within half a period are unchanged.
    expect(imageNear(100, 200, P)).toBeCloseTo(200, 9);
    // A reference far outside the base domain still gives the nearest image.
    // Images of 1195 are 1195 + k * 2400, so 5995 is the one nearest 5000.
    expect(imageNear(5000, 1195, P)).toBeCloseTo(5995, 9);
    expect(Math.abs(imageNear(1195, -1195, P) - 1195)).toBeCloseTo(10, 9);
  });

  it('maps any value into the lattice-aligned base domain [origin, origin + period), at the loop period', () => {
    const origin = WORLD_WRAP_CONFIG.baseOriginMeters;
    expect(origin).toBe(-1200);
    expect(baseImage(0, P_LOOP)).toBeCloseTo(0, 9);
    expect(baseImage(1599, P_LOOP)).toBeCloseTo(1599, 9);
    expect(baseImage(1601, P_LOOP)).toBeCloseTo(-1199, 9);
    expect(baseImage(-1201, P_LOOP)).toBeCloseTo(1599, 9);
    expect(baseImage(3605, P_LOOP)).toBeCloseTo(805, 9);
    const lower = baseImage(origin, P_LOOP);
    expect(lower).toBeGreaterThanOrEqual(origin);
    expect(lower).toBeLessThan(origin + P_LOOP);
  });

  it('keeps the same image: imageNear of a baseImage is the base value shifted by whole periods', () => {
    const origin = WORLD_WRAP_CONFIG.baseOriginMeters;
    for (const value of [-4000, -1201, -17.5, 0, 1599.9, 2500]) {
      const base = baseImage(value, P_LOOP);
      expect(base >= origin - EPS && base < origin + P_LOOP).toBe(true);
      expect((value - base) / P_LOOP).toBeCloseTo(Math.round((value - base) / P_LOOP), 9);
    }
  });
});

