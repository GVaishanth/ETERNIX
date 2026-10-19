import { describe, expect, it } from 'vitest';
import { chunkBounds, chunkKey, chunkOfPoint, chunkRange, distanceToChunk, parseChunkKey } from './chunkGrid';

describe('chunk grid', () => {
  it('round-trips chunk keys, including negative coordinates', () => {
    for (const coord of [
      { kx: 0, kz: 0 },
      { kx: -4, kz: 7 },
      { kx: 12, kz: -1 },
    ]) {
      expect(parseChunkKey(chunkKey(coord))).toEqual(coord);
    }
    expect(parseChunkKey('C-x-1')).toBeNull();
    expect(parseChunkKey('junk')).toBeNull();
  });

  it('gives every point exactly one owner, with half-open edges', () => {
    expect(chunkOfPoint(0, 0, 400)).toEqual({ kx: 0, kz: 0 });
    expect(chunkOfPoint(400, 0, 400)).toEqual({ kx: 1, kz: 0 });
    expect(chunkOfPoint(399.999, 0, 400)).toEqual({ kx: 0, kz: 0 });
    expect(chunkOfPoint(-0.0001, -400, 400)).toEqual({ kx: -1, kz: -1 });
  });

  it('measures distance to a chunk as zero inside and to the nearest edge or corner outside', () => {
    const coord = { kx: 0, kz: 0 };
    expect(distanceToChunk(200, 200, coord, 400)).toBe(0);
    expect(distanceToChunk(450, 200, coord, 400)).toBeCloseTo(50, 9);
    expect(distanceToChunk(403, 404, coord, 400)).toBeCloseTo(5, 9);
  });

  it('gives chunk bounds that tile the plane without overlap', () => {
    const a = chunkBounds({ kx: 0, kz: 0 }, 400);
    const b = chunkBounds({ kx: 1, kz: 0 }, 400);
    expect(a.maxX).toBe(b.minX);
    expect(chunkRange(-1, 401, 400)).toEqual({ from: -1, to: 1 });
  });
});
