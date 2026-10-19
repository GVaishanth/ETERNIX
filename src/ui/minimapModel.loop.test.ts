import { describe, expect, it } from 'vitest';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import {
  MINIMAP_PIXELS_PER_METER,
  MINIMAP_SIZE_PX,
  minimapBounds,
  staticTileDraws,
  wrappedViewPixels,
  type MinimapBounds,
  type StaticTile,
} from './minimapModel';

/*
 * Stage D: minimap on the loop. The static layer repeats every period, so the view must be drawn from every copy that
 * overlaps it. Each test checks the drawn geometry (no canvas). The finite case is the control.
 */

const network = buildLoopCityNetwork();
const PERIOD = network.periodMeters ?? Number.NaN;
const bounds: MinimapBounds = minimapBounds(network);

function covered(tiles: readonly StaticTile[], px: number, py: number): boolean {
  return tiles.some((t) => px >= t.px && px <= t.px + t.widthPx && py >= t.py && py <= t.py + t.heightPx);
}

describe('minimap static tiles', () => {
  it('finite control: one copy, placed where the old single draw put it', () => {
    const cx = 37;
    const cz = -210;
    const tiles = staticTileDraws(bounds, null, cx, cz);
    expect(tiles).toHaveLength(1);
    const tile = tiles[0]!;
    expect(tile.px).toBeCloseTo(MINIMAP_SIZE_PX / 2 + (bounds.minX - cx) * MINIMAP_PIXELS_PER_METER, 9);
    expect(tile.py).toBeCloseTo(MINIMAP_SIZE_PX / 2 - (bounds.maxZ - cz) * MINIMAP_PIXELS_PER_METER, 9);
  });

  it('covers every pixel of the view, for centres across the whole base domain', () => {
    let checked = 0;
    let uncovered = 0;
    // The base domain is [-1200, 1600) at 2800 m.
    for (let cx = -1200; cx <= 1600; cx += 150) {
      for (let cz = -1200; cz <= 1600; cz += 150) {
        const tiles = staticTileDraws(bounds, PERIOD, cx, cz);
        for (let py = 0; py <= MINIMAP_SIZE_PX; py += 11) {
          for (let px = 0; px <= MINIMAP_SIZE_PX; px += 11) {
            checked += 1;
            if (!covered(tiles, px, py)) uncovered += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(uncovered).toBe(0);
  });

  it('exactly one period wide, so the copies abut and never overlap', () => {
    expect(bounds.maxX - bounds.minX).toBeCloseTo(PERIOD, 9);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(PERIOD, 9);
    for (const [cx, cz] of [[1599, -401.8], [0, 0], [-1199, 1199]] as const) {
      const tiles = staticTileDraws(bounds, PERIOD, cx, cz);
      for (const a of tiles) {
        for (const b of tiles) {
          if (a === b) continue;
          const overlapX = Math.min(a.px + a.widthPx, b.px + b.widthPx) - Math.max(a.px, b.px);
          const overlapY = Math.min(a.py + a.heightPx, b.py + b.heightPx) - Math.max(a.py, b.py);
          expect(overlapX <= 1e-6 || overlapY <= 1e-6).toBe(true);
        }
      }
    }
  });

  it('draws the same picture one period away, so the view does not jump at a seam', () => {
    // Explicit seam pair: a centre at +1599 and the same spot one period away, at -1201. The seam is at 1600.
    const east = staticTileDraws(bounds, PERIOD, 1599, -401.8);
    const west = staticTileDraws(bounds, PERIOD, -1201, -401.8);
    const shifted = staticTileDraws(bounds, PERIOD, 1599 - PERIOD, -401.8);
    expect(west).toHaveLength(east.length);
    expect(shifted).toHaveLength(east.length);
    east.forEach((tile, index) => {
      expect(west[index]!.px).toBeCloseTo(tile.px, 6);
      expect(west[index]!.py).toBeCloseTo(tile.py, 6);
      expect(shifted[index]!.px).toBeCloseTo(tile.px, 6);
    });
  });

  it('gives the same tiles for a centre given unwrapped (two periods away), so the result depends only on the base position', () => {
    const base = staticTileDraws(bounds, PERIOD, 1599, -401.8);
    const unwrapped = staticTileDraws(bounds, PERIOD, 1599 + 2 * PERIOD, -401.8);
    expect(unwrapped).toHaveLength(base.length);
    base.forEach((tile, index) => {
      expect(unwrapped[index]!.px).toBeCloseTo(tile.px, 6);
      expect(unwrapped[index]!.py).toBeCloseTo(tile.py, 6);
    });
  });

  it('keeps the copies that overlap the view, and no others', () => {
    // A centre at the middle of the base domain sees the middle copy and the copies at its edges only.
    const tiles = staticTileDraws(bounds, PERIOD, 0, 0);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(9);
    for (const tile of tiles) {
      expect(tile.px).toBeLessThan(MINIMAP_SIZE_PX);
      expect(tile.px + tile.widthPx).toBeGreaterThan(0);
    }
  });
});

describe('minimap marks across the seam', () => {
  it('draws a mark on the far side of the seam beside the car', () => {
    // The car is at base +1599. A mark at base -1195 is 6 m away across the seam (1605 - 1599).
    const p = wrappedViewPixels(-1195, -401.8, 1599, -401.8, PERIOD);
    expect(p.px).toBeCloseTo(MINIMAP_SIZE_PX / 2 + 6 * MINIMAP_PIXELS_PER_METER, 9);
    expect(p.py).toBeCloseTo(MINIMAP_SIZE_PX / 2, 9);
  });

  it('finite control: the same mark is far off the view', () => {
    const p = wrappedViewPixels(-1195, -401.8, 1599, -401.8, null);
    expect(p.px).toBeLessThan(0);
  });
});
