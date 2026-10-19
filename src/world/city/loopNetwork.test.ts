import { describe, expect, it } from 'vitest';
import { buildLaneGraph } from '../../traffic/laneGraph';
import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import { validateRoadNetwork } from '../roadValidation';
import { validateCityNetwork } from './cityValidation';
import { buildCityNetwork, buildLoopCityNetwork, junctionArms } from './cityNetwork';
import { buildCityScenery } from './cityScenery';
import { buildLoopScenery } from './loopScenery';

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
const N = WORLD_WRAP_CONFIG.periodNodes;

describe('looping city network', () => {
  const loop = buildLoopCityNetwork();

  it('declares the period and builds one period of the lattice', () => {
    expect(loop.periodMeters).toBe(PERIOD);
    const junctions = loop.segments.filter((segment) => segment.kind === 'junction');
    const streets = loop.segments.filter((segment) => segment.kind !== 'junction');
    expect(junctions).toHaveLength(N * N);
    expect(streets).toHaveLength(2 * N * N);
    expect(loop.connections).toHaveLength(4 * N * N);
  });

  it('gives every junction four arms, so every seam is joined on both axes', () => {
    for (const segment of loop.segments.filter((item) => item.kind === 'junction')) {
      expect(segment.ports.length).toBe(4);
    }
    // The finite layout's arm rule would give (-4, 7) three arms. The loop's arms come from its own lattice.
    expect(junctionArms(-4, 7)).toHaveLength(3);
  });

  it('joins the east edge to the west edge and the north edge to the south edge by connection id', () => {
    // The lattice runs nodes -4 to 9, so the last street on each axis is 9 to 10, and node 10 is node -4.
    const east = loop.connections.find((connection) => connection.id === 'C-H-9-0-end');
    expect(east?.a.segmentId).toBe('H-9-0');
    expect(east?.b.segmentId).toBe('J--4-0');
    const north = loop.connections.find((connection) => connection.id === 'C-V-0-9-end');
    expect(north?.b.segmentId).toBe('J-0--4');
  });

  it('validates on the torus: every port gap is measured across the period', () => {
    expect(validateRoadNetwork(loop).valid).toBe(true);
    expect(validateCityNetwork(loop).valid).toBe(true);
  });

  it('keeps the literal lane ids that the existing race and traffic tests name', () => {
    const graph = buildLaneGraph(loop);
    for (const id of ['H-0-0:F:0', 'H-2-0:F:0', 'V-3-1:F:0', 'H-0-1:R:0', 'V-0-0:R:0', 'V-4-1:F:0', 'H-1-4:R:0']) {
      expect(graph.byId.has(id), id).toBe(true);
    }
  });

  it('does not change the finite city', () => {
    const finite = buildCityNetwork();
    expect(finite.periodMeters).toBeUndefined();
    // The finite city builds its nodes from CITY_NODE_INDEX_MIN to CITY_NODE_INDEX_MAX inclusive: periodNodes + 1 per axis.
    expect(finite.segments.filter((segment) => segment.kind === 'junction')).toHaveLength((N + 1) * (N + 1));
  });
});

describe('loop scenery', () => {
  const loop = buildLoopScenery(PERIOD);
  const full = buildCityScenery();
  // The base domain is [origin, origin + period), aligned to the lattice.
  const origin = WORLD_WRAP_CONFIG.baseOriginMeters;
  const inside = (x: number, z: number): boolean =>
    x >= origin && x < origin + PERIOD && z >= origin && z < origin + PERIOD;

  it('places every object inside the base domain, so each has one canonical chunk', () => {
    for (const tree of loop.trees) expect(inside(tree.x, tree.z)).toBe(true);
    for (const lamp of loop.lamps) expect(inside(lamp.x, lamp.z)).toBe(true);
    for (const sign of loop.signs) expect(inside(sign.x, sign.z)).toBe(true);
    for (const building of loop.buildings) {
      expect(inside((building.footprint.x0 + building.footprint.x1) / 2, (building.footprint.z0 + building.footprint.z1) / 2)).toBe(true);
    }
  });

  it('builds each seam object once: no two lamps share a position', () => {
    const seen = new Set<string>();
    for (const lamp of loop.lamps) {
      const key = `${lamp.x.toFixed(4)},${lamp.z.toFixed(4)}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('builds fewer street lamps than the finite city, which has the far row and column too', () => {
    expect(loop.lamps.length).toBeLessThan(full.lamps.length);
    expect(loop.lamps.length).toBeGreaterThan(0);
  });

  it('keeps every landmark part with a kept building, and nothing else', () => {
    const keptIds = new Set(loop.buildings.map((building) => building.id));
    for (const part of loop.landmarkParts) expect(keptIds.has(part.landmarkId)).toBe(true);
  });
});
