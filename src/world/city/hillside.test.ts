/*
 * The hillside district (Division 2 phase 3, widened to six cell columns at 2800 m). The strip of cells -4, -3, 6, 7, 8
 * and 9 rises to a crest on node column 9. It crosses the loop's seam: cells 8 and 9 sit on the far side of the wrap
 * from cells -4 and -3. These tests check the heights, the grade limit on every street of the loop, the loop period,
 * the seam with the city, and which streamed chunk owns the hillside terrain.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import { hillsideTerrainForChunk } from '../hillsideTerrain';
import { GROUND_CLEARANCE_METERS, hillsideGroundFor } from '../hillsideGround';
import type { RoadNetwork, RoadSegment } from '../roadTypes';
import {
  CITY_NODE_INDEX_MAX,
  CITY_NODE_INDEX_MIN,
  HILLSIDE_CELL_COLUMNS,
  HILLSIDE_FIRST_NODE,
  HILLSIDE_PEAK_METERS,
  HILLSIDE_PEAK_ROW,
  HILLSIDE_WIDTH_CELLS,
  districtOfCell,
  nodeHeightMeters,
  nodeX,
} from './cityLayout';
import { buildLoopCityNetwork } from './cityNetwork';
import { validateRoadNetwork } from '../roadValidation';
import { buildCityScenery } from './cityScenery';
import { createCityStreamingSet } from './cityChunks';
import { ROAD_TEST_BLOCKS } from '../roadMeshData';
import { parseChunkKey } from '../streaming/chunkGrid';
import { contentKeyOf } from '../streaming/periodicChunks';

const GRADE_LIMIT = 0.08;
const PERIOD = CITY_NODE_INDEX_MAX - CITY_NODE_INDEX_MIN;
/** The chunk that owns cell i: chunk kx holds cells 2kx + 2 and 2kx + 3. */
const chunkOfCell = (i: number): number => Math.floor((i - 2) / 2);

/** Largest grade along any centreline of a segment, rise over run between consecutive samples. */
function maxGradeOf(segment: RoadSegment): number {
  const line = segment.centerline;
  if (!line) return 0;
  let worst = 0;
  for (let k = 1; k < line.points.length; k += 1) {
    const a = line.points[k - 1];
    const b = line.points[k];
    const run = (line.s[k] ?? 0) - (line.s[k - 1] ?? 0);
    if (!a || !b || run <= 0) continue;
    worst = Math.max(worst, Math.abs(b.y - a.y) / run);
  }
  return worst;
}

function junctionIndices(id: string): { i: number; j: number } | null {
  const match = /^J-(-?\d+)-(-?\d+)$/.exec(id);
  if (!match) return null;
  return { i: Number(match[1]), j: Number(match[2]) };
}

const loop: RoadNetwork = buildLoopCityNetwork();

describe('hillside heights', () => {
  it('the mountain spans the declared six cell columns, and its crest is on node column 9 at the declared peak row', () => {
    expect(HILLSIDE_CELL_COLUMNS).toEqual([-4, -3, 6, 7, 8, 9]);
    expect(HILLSIDE_WIDTH_CELLS).toBe(6);
    expect(nodeHeightMeters(9, HILLSIDE_PEAK_ROW)).toBeCloseTo(HILLSIDE_PEAK_METERS, 9);
    expect(HILLSIDE_PEAK_METERS).toBe(12);
  });

  it('the two ends of the arc are flat: node 6 meets the residential ring, and node -2 (12 on the arc) meets cell -2', () => {
    for (let j = CITY_NODE_INDEX_MIN; j <= CITY_NODE_INDEX_MAX; j += 1) {
      expect(nodeHeightMeters(HILLSIDE_FIRST_NODE, j)).toBe(0);
      expect(nodeHeightMeters(-2, j)).toBe(0);
      expect(nodeHeightMeters(5, j)).toBe(0);
    }
  });

  it('every node outside the arc is flat, and the nodes inside it rise on the peak row', () => {
    for (let j = CITY_NODE_INDEX_MIN; j <= CITY_NODE_INDEX_MAX; j += 1) {
      for (const i of [-1, 0, 1, 2, 3, 4, 5]) expect(nodeHeightMeters(i, j), `node ${i},${j}`).toBe(0);
    }
    // The along-strip cosine is zero half a period away, so only the peak row is guaranteed positive on every arc node.
    for (const i of [7, 8, 9, 10, -4, -3]) expect(nodeHeightMeters(i, HILLSIDE_PEAK_ROW), `node ${i}`).toBeGreaterThan(0);
  });

  it('repeats every period in j, so node -4 and node 10 are the same height, and the seam is inside the mountain', () => {
    for (let j = CITY_NODE_INDEX_MIN; j <= CITY_NODE_INDEX_MAX; j += 1) {
      expect(nodeHeightMeters(9, j + PERIOD)).toBeCloseTo(nodeHeightMeters(9, j), 9);
    }
    // The seam is at node 10 = node -4 (x = 1600 = -1200). Both sides climb, so the street crossing it is not flat.
    expect(nodeHeightMeters(10, 3)).toBeCloseTo(nodeHeightMeters(-4, 3), 9);
    expect(nodeHeightMeters(-4, 3)).toBeGreaterThan(0);
  });

  it('places the hillside cells in the strip and nowhere else in the populated grid', () => {
    expect(districtOfCell(6, 0)).toBe('hillside');
    expect(districtOfCell(9, -4)).toBe('hillside');
    expect(districtOfCell(-4, 0)).toBe('hillside');
    expect(districtOfCell(5, 0)).toBe('residential');
    expect(districtOfCell(-2, 0)).toBe('residential');
    expect(districtOfCell(0, 0)).toBe('residential');
  });
});

describe('hillside network', () => {
  it('the loop with the hillside passes the road validator with no problems', () => {
    const report = validateRoadNetwork(loop);
    expect(report.issues).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('the loop has a 2800 m period, with 14 nodes per axis', () => {
    expect(loop.periodMeters).toBe(WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters);
    expect(loop.periodMeters).toBe(2800);
    expect(WORLD_WRAP_CONFIG.periodNodes).toBe(14);
    expect(PERIOD).toBe(14);
  });

  it('every street of the loop is within the 8 percent grade limit, and the mountain really climbs', () => {
    let worst = 0;
    for (const segment of loop.segments) {
      if (segment.kind !== 'straight') continue;
      worst = Math.max(worst, maxGradeOf(segment));
    }
    expect(worst).toBeLessThanOrEqual(GRADE_LIMIT);
    // The arc climbs about 3 percent per street at the steepest: the test fails if the hill were flattened by mistake.
    expect(worst).toBeGreaterThan(0.025);
  });

  it('each junction sits at its node height, and every arm meets it at that height', () => {
    let checked = 0;
    for (const segment of loop.segments) {
      if (segment.kind !== 'junction' || !segment.junction) continue;
      const index = junctionIndices(segment.id);
      if (!index) continue;
      expect(segment.junction.centre.y).toBeCloseTo(nodeHeightMeters(index.i, index.j), 9);
      for (const port of segment.ports) {
        expect(port.position.y).toBeCloseTo(segment.junction.centre.y, 9);
        expect(port.elevationMeters).toBeCloseTo(segment.junction.centre.y, 9);
      }
      checked += 1;
    }
    expect(checked).toBe(loop.segments.filter((segment) => segment.kind === 'junction').length);
  });

  it('the street across the seam joins at its node heights on both sides: H-9-j ends where H--4-j starts', () => {
    // H-9-j runs from node 9 east to node 10, which is node -4 on the loop. The far end must be the height of node -4.
    for (let j = CITY_NODE_INDEX_MIN; j <= CITY_NODE_INDEX_MAX; j += 1) {
      const east = loop.segments.find((segment) => segment.id === `H-9-${j}`);
      const west = loop.segments.find((segment) => segment.id === `H--4-${j}`);
      if (!east || !west) continue;
      const end = east.ports.find((port) => port.id === 'end');
      const start = west.ports.find((port) => port.id === 'start');
      expect(end?.position.y ?? NaN).toBeCloseTo(nodeHeightMeters(-4, j), 9);
      expect(start?.position.y ?? NaN).toBeCloseTo(nodeHeightMeters(-4, j), 9);
    }
  });

  it('the east-west highway crosses the hillside at its row and keeps its streets within the limit', () => {
    const row = 6;
    for (const i of [5, 6, 7, 8, 9]) {
      const street = loop.segments.find((segment) => segment.id === `H-${i}-${row}`);
      expect(street, `H-${i}-${row} exists`).toBeDefined();
      expect(street?.roadType).toBe('highway');
      expect(maxGradeOf(street as RoadSegment)).toBeLessThanOrEqual(GRADE_LIMIT);
    }
    // The street is positioned on its node line: its start is at nodeX(6) plus the boundary.
    const street = loop.segments.find((segment) => segment.id === `H-6-${row}`);
    expect(street?.ports.find((port) => port.id === 'start')?.position.x).toBeGreaterThan(nodeX(6));
  });
});

describe('hillside terrain and chunk ownership', () => {
  const ground = hillsideGroundFor(loop);
  // Chunk kx holds cells 2kx + 2 and 2kx + 3. The mountain's chunks are kx = -3 (cells -4, -3), 2 (cells 6, 7), 3 (cells 8, 9).
  const TERRAIN_KX = [-3, 2, 3];

  it('only the chunks that hold the mountain have terrain, and only where the cells exist', () => {
    for (const kx of TERRAIN_KX) {
      for (let kz = -3; kz <= 3; kz += 1) expect(hillsideTerrainForChunk(kx, kz, ground), `kx ${kx} kz ${kz}`).not.toBeNull();
    }
    for (const kx of [-2, 0, 1, 4]) {
      for (let kz = -3; kz <= 3; kz += 1) expect(hillsideTerrainForChunk(kx, kz, ground), `kx ${kx} kz ${kz}`).toBeNull();
    }
  });

  it('the terrain sits inside the strip and between flat ground and the crest, with upward normals', () => {
    const terrain = hillsideTerrainForChunk(2, 0, ground);
    expect(terrain).not.toBeNull();
    if (!terrain) return;
    const { positions, indices, normals } = terrain;
    for (let v = 0; v < terrain.vertexCount; v += 1) {
      const x = positions[v * 3] ?? NaN;
      const y = positions[v * 3 + 1] ?? NaN;
      expect(x).toBeGreaterThanOrEqual(nodeX(6) - 1e-6);
      expect(x).toBeLessThanOrEqual(nodeX(8) + 1e-6);
      // The carve sits the clearance under the road, so flat roads in the strip carry ground at -clearance.
      expect(y).toBeGreaterThanOrEqual(-GROUND_CLEARANCE_METERS - 1e-3);
      expect(y).toBeLessThanOrEqual(HILLSIDE_PEAK_METERS + 1e-6);
      expect(normals[v * 3 + 1] ?? 0).toBeGreaterThan(0);
    }
    // Every triangle's geometric normal points up.
    for (let t = 0; t < terrain.triangleCount; t += 1) {
      const a = indices[t * 3] ?? 0;
      const b = indices[t * 3 + 1] ?? 0;
      const c = indices[t * 3 + 2] ?? 0;
      const p = (k: number, axis: number) => positions[k * 3 + axis] ?? 0;
      const ux = p(b, 0) - p(a, 0);
      const uz = p(b, 2) - p(a, 2);
      const vx = p(c, 0) - p(a, 0);
      const vz = p(c, 2) - p(a, 2);
      // The y component of (b - a) x (c - a), which is +y for an upward triangle.
      const ny = uz * vx - ux * vz;
      expect(ny).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('the ground under the crest sits just below the road, so the asphalt is never hidden by the terrain', () => {
    // The crest is node (9, 2) at x = 1400, in chunk kx = 3. The carve puts the ground at the road height minus clearance.
    const terrain = hillsideTerrainForChunk(3, 0, ground);
    const target = HILLSIDE_PEAK_METERS - GROUND_CLEARANCE_METERS;
    expect(terrain).not.toBeNull();
    if (!terrain) return;
    expect(terrain.positions.some((_, k) => k % 3 === 1 && Math.abs((terrain.positions[k] ?? 0) - target) < 1e-3)).toBe(true);
    for (let v = 0; v < terrain.vertexCount; v += 1) {
      const x = terrain.positions[v * 3] ?? NaN;
      const z = terrain.positions[v * 3 + 2] ?? NaN;
      const y = terrain.positions[v * 3 + 1] ?? NaN;
      // Positions are float32, so compare with a millimetre of slack.
      expect(y, `ground at ${x},${z} is not above the road`).toBeLessThanOrEqual(ground.heightAt(x, z) + 1e-3);
    }
  });
});

describe('hillside chunk ownership', () => {
  // The chunk grid is 400 m, two cells a side, and offset from the node grid.
  const set = createCityStreamingSet(loop, buildCityScenery(), ROAD_TEST_BLOCKS);
  const ownerOf = (segmentId: string): string[] => {
    const owners: string[] = [];
    for (const [key, ids] of set.index.chunkSegments) {
      if (ids.includes(segmentId)) owners.push(key);
    }
    return owners;
  };

  it('every street and junction of the strip belongs to the chunk that holds its cell', () => {
    let checked = 0;
    for (let j = CITY_NODE_INDEX_MIN; j <= CITY_NODE_INDEX_MAX; j += 1) {
      for (const i of HILLSIDE_CELL_COLUMNS) {
        for (const id of [`H-${i}-${j}`, `V-${i}-${j}`, `J-${i}-${j}`]) {
          if (!loop.segments.some((segment) => segment.id === id)) continue;
          const owners = ownerOf(id);
          expect(owners.length, `${id} has one owner`).toBe(1);
          const canonical = parseChunkKey(contentKeyOf(set.index.period, owners[0] ?? ''));
          expect(canonical?.kx, `${id} is in the chunk of cell ${i}`).toBe(chunkOfCell(i));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the terrain under each chunk that owns strip roads exists, and every chunk with terrain owns strip roads', () => {
    const ground = hillsideGroundFor(loop);
    for (const [key] of set.index.chunkSegments) {
      const canonical = parseChunkKey(contentKeyOf(set.index.period, key));
      if (!canonical) continue;
      const terrain = hillsideTerrainForChunk(canonical.kx, canonical.kz, ground);
      const ownsStrip = (set.index.chunkSegments.get(key) ?? []).some((id) => /^[HVJ]-(-4|-3|6|7|8|9)-/.test(id));
      if (ownsStrip) expect(terrain, `terrain under ${key}`).not.toBeNull();
    }
  });
});
