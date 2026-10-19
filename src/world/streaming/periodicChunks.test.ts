import { describe, expect, it } from 'vitest';
import { WORLD_STREAMING_CONFIG } from '../../config/worldStreamingConfig';
import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import { buildLoopCityNetwork } from '../city/cityNetwork';
import { chunkKey, chunkOfPoint, parseChunkKey } from './chunkGrid';
import {
  assertStreamingFitsPeriod,
  canonicalChunk,
  chunkImage,
  chunkPeriodFor,
  contentKeyOf,
  footprintOwnersAt,
  imageOffsetMeters,
  logicalChunk,
} from './periodicChunks';
import { selectChunks } from './wantedChunks';
import { buildWorldIndex } from './worldIndex';

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
const SIZE = WORLD_STREAMING_CONFIG.chunkSizeMeters;
const ORIGIN = WORLD_WRAP_CONFIG.baseOriginMeters;
const CHUNKS = PERIOD / SIZE;
/** The canonical chunk range of the loop: from the origin's chunk, CHUNKS chunks long. */
const CANON_MIN = ORIGIN / SIZE;
const CANON_MAX = CANON_MIN + CHUNKS - 1;
const LOAD = WORLD_STREAMING_CONFIG.loadRadiusMeters;
const ROW_Z = -400; // Node row j = 0.

const index = buildWorldIndex(buildLoopCityNetwork(), SIZE);

/** Shifts every logical key of a selection by a whole number of periods on x. */
function shiftKeys(keys: Set<string>, periods: number): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const coord = parseChunkKey(key);
    if (!coord) throw new Error(key);
    out.add(chunkKey({ kx: coord.kx + periods * CHUNKS, kz: coord.kz }));
  }
  return out;
}

describe('chunk period', () => {
  it('is seven 400 m chunks per 2800 m period, with the base domain on the chunk grid, chunks -3 to 3', () => {
    const period = chunkPeriodFor(PERIOD, SIZE, ORIGIN);
    expect(period.chunksPerPeriod).toBe(7);
    expect(period.minChunk).toBe(-3);
    expect(CANON_MAX).toBe(3);
    expect(index.period).not.toBeNull();
  });

  it('accepts an odd number of chunks, and refuses a period that is not whole or an origin off the chunk grid', () => {
    expect(() => chunkPeriodFor(2500, SIZE, ORIGIN)).toThrow(RangeError);
    expect(() => chunkPeriodFor(2450, SIZE, ORIGIN)).toThrow(RangeError);
    expect(() => chunkPeriodFor(PERIOD, SIZE, ORIGIN - 50)).toThrow(RangeError);
    expect(chunkPeriodFor(PERIOD, SIZE, ORIGIN).chunksPerPeriod).toBe(7);
  });

  it('maps every logical chunk to exactly one canonical chunk and an image', () => {
    const period = chunkPeriodFor(PERIOD, SIZE, ORIGIN);
    for (const kx of [-9, -4, -3, -1, 0, 2, 3, 4, 8]) {
      const canonical = canonicalChunk(period, { kx, kz: 0 });
      expect(canonical.kx).toBeGreaterThanOrEqual(CANON_MIN);
      expect(canonical.kx).toBeLessThanOrEqual(CANON_MAX);
      const { mx } = chunkImage(period, { kx, kz: 0 });
      expect(logicalChunk(period, canonical, mx, 0).kx).toBe(kx);
    }
    // Logical chunk 4 is canonical -3 one period east. Logical chunk -3 is canonical itself.
    expect(canonicalChunk(period, { kx: 4, kz: 0 }).kx).toBe(-3);
    expect(chunkImage(period, { kx: 4, kz: 0 }).mx).toBe(1);
    expect(chunkImage(period, { kx: -3, kz: 0 }).mx).toBe(0);
  });

  it('keeps every chunk with content in the canonical range', () => {
    for (const coord of index.chunks.values()) {
      expect(coord.kx).toBeGreaterThanOrEqual(CANON_MIN);
      expect(coord.kx).toBeLessThanOrEqual(CANON_MAX);
      expect(coord.kz).toBeGreaterThanOrEqual(CANON_MIN);
      expect(coord.kz).toBeLessThanOrEqual(CANON_MAX);
    }
  });

  it('draws a logical chunk at the image offset of its canonical content', () => {
    // Logical chunk 4 is canonical -3 one period east (x 1600..2000 is x -1200..-800 wrapped).
    expect(contentKeyOf(index.period, 'C-4--1')).toBe('C--3--1');
    expect(imageOffsetMeters(index.period, 'C-4--1')).toEqual({ x: PERIOD, z: 0 });
    expect(imageOffsetMeters(index.period, 'C-3--1')).toEqual({ x: 0, z: 0 });
    expect(contentKeyOf(index.period, 'C-4--1')).not.toBe('C-4--1');
    expect(contentKeyOf(null, 'C-1-2')).toBe('C-1-2');
    expect(imageOffsetMeters(null, 'C-1-2')).toEqual({ x: 0, z: 0 });
  });
});

describe('wanted chunks on the torus', () => {
  it('is periodic: a point one period away wants the same chunks, one period along', () => {
    const points = [
      { x: 1100, z: ROW_Z },
      { x: 1205, z: ROW_Z },
      { x: -1195, z: 300 },
      { x: 0, z: 0 },
    ];
    for (const point of points) {
      const here = selectChunks(index, point, LOAD);
      const there = selectChunks(index, { x: point.x + PERIOD, z: point.z }, LOAD);
      expect(there).toEqual(shiftKeys(here, 1));
    }
  });

  it('changes continuously as the car crosses the east seam', () => {
    let previous: Set<string> | null = null;
    for (let x = 1500; x <= 1700; x += 5) {
      const current = selectChunks(index, { x, z: ROW_Z }, LOAD);
      if (previous) {
        let changed = 0;
        for (const key of current) if (!previous.has(key)) changed += 1;
        for (const key of previous) if (!current.has(key)) changed += 1;
        // A few chunks enter and leave per 5 m step at most, never the whole set.
        expect(changed, `x=${x}`).toBeLessThanOrEqual(12);
      }
      expect(current.has(chunkKey(chunkOfPoint(x, ROW_Z, SIZE))), `car chunk at x=${x}`).toBe(true);
      previous = current;
    }
  });

  it('keeps the road across the seam loaded on both sides', () => {
    // H-9-0 is owned by logical chunk (3, -1). Just past the seam the car is in logical chunk (4, -1), so the owner must
    // still be wanted, at its own image.
    expect(selectChunks(index, { x: 1595, z: ROW_Z }, LOAD).has('C-3--1')).toBe(true);
    expect(selectChunks(index, { x: 1605, z: ROW_Z }, LOAD).has('C-3--1')).toBe(true);
    // The west street H--4-0 sits at logical x -1200..-1010, and at 1600..1790 one period east.
    expect(selectChunks(index, { x: 1605, z: ROW_Z }, LOAD).has('C-4--1')).toBe(true);
  });

  it('names the owner of an urgent footprint at the image of the car', () => {
    const owners = footprintOwnersAt(index.footprints, index.period!, 1605, ROW_Z);
    expect(owners).toContain('C-4--1');
  });
});

describe('streaming reach', () => {
  it('fits in half a period with the shipped configuration', () => {
    const period = chunkPeriodFor(PERIOD, SIZE, ORIGIN);
    expect(() => assertStreamingFitsPeriod(period, WORLD_STREAMING_CONFIG.maxLoadRadiusMeters + WORLD_STREAMING_CONFIG.keepMarginMeters)).not.toThrow();
  });

  it('refuses a reach of half a period or more', () => {
    const period = chunkPeriodFor(PERIOD, SIZE, ORIGIN);
    expect(() => assertStreamingFitsPeriod(period, PERIOD / 2)).toThrow(RangeError);
  });

  it('has a ground plane larger than twice the streaming reach', () => {
    const reach = WORLD_STREAMING_CONFIG.maxLoadRadiusMeters + WORLD_STREAMING_CONFIG.keepMarginMeters;
    expect(WORLD_WRAP_CONFIG.loopGroundSizeMeters).toBeGreaterThan(2 * reach);
  });
});

