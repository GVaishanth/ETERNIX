import { describe, expect, it } from 'vitest';
import { buildLaneGraph, laneSample, type LanePath } from '../../traffic/laneGraph';
import { buildRoadBoundary, signedDistance } from '../../simulation/roadBoundary';
import { NETWORK_PROFILE } from '../roadBuilders';
import type { RoadNetwork } from '../roadTypes';
import { validateRoadNetwork } from '../roadValidation';
import { buildCityNetwork, junctionArms } from './cityNetwork';
import {
  CITY_CELL_INDEX_MAX,
  CITY_CELL_INDEX_MIN,
  CITY_HIGHWAY_COLUMN,
  CITY_NODE_INDEX_MAX,
  CITY_NODE_INDEX_MIN,
  CITY_SPAWN,
  DISTRICT_LABELS,
  cellCentre,
  districtOfCell,
  type DistrictId,
  nodeX,
  nodeZ,
} from './cityLayout';

/** Nodes per side of the populated grid, and the counts that follow from it. */
const NODES_PER_SIDE = CITY_NODE_INDEX_MAX - CITY_NODE_INDEX_MIN + 1;
const EXPECTED_JUNCTIONS = NODES_PER_SIDE * NODES_PER_SIDE;
const EXPECTED_STREETS = 2 * NODES_PER_SIDE * (NODES_PER_SIDE - 1);
const EXPECTED_CONNECTIONS = 2 * EXPECTED_STREETS;
import { validateCityNetwork } from './cityValidation';

/*
 * City road graph (Part 5). Tests A (structure and validation), B (negative cases), C (district connectivity),
 * and D (spawn and drivable boundary). Every number here comes from the layout, not from the built network.
 */

function cloneNetwork(network: RoadNetwork): RoadNetwork {
  return JSON.parse(JSON.stringify(network)) as RoadNetwork;
}

/** District of the populated cell containing (x, z). Cell (i, j) spans x in [(i-2)*200, (i-1)*200). */
function districtOfPoint(x: number, z: number): DistrictId | null {
  const i = Math.floor((x + 400) / 200);
  const j = Math.floor((z + 400) / 200);
  if (i < CITY_CELL_INDEX_MIN || j < CITY_CELL_INDEX_MIN || i > CITY_CELL_INDEX_MAX || j > CITY_CELL_INDEX_MAX) return null;
  return districtOfCell(i, j);
}

describe('city network structure (test A)', () => {
  const network = buildCityNetwork();
  const graph = buildLaneGraph(network);

  it('builds the populated grid: every node is a junction, every street joins two nodes', () => {
    const junctions = network.segments.filter((segment) => segment.kind === 'junction');
    const streets = network.segments.filter((segment) => segment.kind !== 'junction');
    // periodNodes + 1: node 10 is built as well as node -4, which it duplicates after wrapping.
    expect(NODES_PER_SIDE).toBe(15);
    expect(junctions).toHaveLength(EXPECTED_JUNCTIONS);
    expect(streets).toHaveLength(EXPECTED_STREETS);
    expect(network.connections).toHaveLength(EXPECTED_CONNECTIONS);
  });

  it('is deterministic: two builds are identical', () => {
    expect(buildCityNetwork()).toEqual(network);
  });

  it('has unique segment ids and unique connection ids', () => {
    const segmentIds = network.segments.map((segment) => segment.id);
    const connectionIds = network.connections.map((connection) => connection.id);
    expect(new Set(segmentIds).size).toBe(segmentIds.length);
    expect(new Set(connectionIds).size).toBe(connectionIds.length);
  });

  it('passes both the connection validator and the city validator with no issues', () => {
    const connections = validateRoadNetwork(network);
    expect(connections.valid).toBe(true);
    expect(connections.danglingPorts).toEqual([]);
    const city = validateCityNetwork(network);
    expect(city.issues).toEqual([]);
    expect(city.valid).toBe(true);
    expect(city.stronglyConnectedLaneCount).toBe(city.laneCount);
  });

  it('builds four lanes per street, and n(n-1) x 2 connectors per junction with n arms', () => {
    const connectors = graph.lanes.filter((lane) => lane.kind === 'connector');
    const streetLanes = graph.lanes.filter((lane) => lane.kind === 'segment');
    expect(streetLanes).toHaveLength(EXPECTED_STREETS * 4);
    // Each junction has n(n-1) entry/exit pairs for n arms, with two lanes per direction.
    let expectedConnectors = 0;
    for (let i = CITY_NODE_INDEX_MIN; i <= CITY_NODE_INDEX_MAX; i += 1) {
      for (let j = CITY_NODE_INDEX_MIN; j <= CITY_NODE_INDEX_MAX; j += 1) {
        const n = junctionArms(i, j).length;
        expectedConnectors += n * (n - 1) * 2;
      }
    }
    expect(connectors).toHaveLength(expectedConnectors);
    expect(graph.lanes).toHaveLength(streetLanes.length + expectedConnectors);
  });

  it('gives each junction the arms that exist on the grid (corner 2, edge 3, interior 4)', () => {
    expect(junctionArms(CITY_NODE_INDEX_MIN, CITY_NODE_INDEX_MIN)).toHaveLength(2);
    expect(junctionArms(0, CITY_NODE_INDEX_MIN)).toHaveLength(3);
    expect(junctionArms(0, 0)).toHaveLength(4);
    const corner = network.segments.find((segment) => segment.id === `J-${CITY_NODE_INDEX_MIN}-${CITY_NODE_INDEX_MIN}`);
    expect(corner?.ports.map((port) => port.id).sort()).toEqual(['east', 'north']);
  });

  it('marks the east column of vertical streets as highway and the rest as city streets', () => {
    for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
      expect(network.segments.find((segment) => segment.id === `V-${CITY_HIGHWAY_COLUMN}-${j}`)?.roadType).toBe('highway');
      expect(network.segments.find((segment) => segment.id === `V-0-${j}`)?.roadType).toBe('city');
    }
  });

  it('gives the spawn a real lane: the eastbound inner right lane of H-1-2', () => {
    const lane = graph.byId.get('H-1-2:F:0');
    expect(lane).toBeDefined();
    const pose = laneSample(lane as LanePath, 90);
    expect(Math.abs(pose.x - CITY_SPAWN.position.x)).toBeLessThan(1);
    expect(Math.abs(pose.z - CITY_SPAWN.position.z)).toBeLessThan(0.01);
  });
});

describe('city validation rejects bad input and names the segments (test B)', () => {
  const base = buildCityNetwork();

  it('reports a duplicate segment id', () => {
    const network = cloneNetwork(base);
    const second = network.segments[1];
    const first = network.segments[0];
    if (!second || !first) throw new Error('fixture');
    second.id = first.id;
    const report = validateCityNetwork(network);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'duplicate-segment-id' && issue.segmentIds.includes(first.id))).toBe(true);
  });

  it('reports a zero-length street by segment id', () => {
    const network = cloneNetwork(base);
    const street = network.segments.find((segment) => segment.id === 'H-2-3');
    if (!street) throw new Error('fixture');
    street.lengthMeters = 0;
    const report = validateCityNetwork(network);
    expect(report.issues.some((issue) => issue.code === 'zero-length-segment' && issue.segmentIds[0] === 'H-2-3')).toBe(true);
  });

  it('reports an invalid road width', () => {
    const network = cloneNetwork(base);
    const street = network.segments.find((segment) => segment.id === 'V-1-1');
    if (!street) throw new Error('fixture');
    street.roadWidthMeters = 0;
    const report = validateCityNetwork(network);
    expect(report.issues.some((issue) => issue.code === 'invalid-width' && issue.segmentIds[0] === 'V-1-1')).toBe(true);
  });

  it('reports a missing surface', () => {
    const network = cloneNetwork(base);
    const street = network.segments.find((segment) => segment.id === 'H-0-0');
    if (!street) throw new Error('fixture');
    (street as { surface: unknown }).surface = undefined;
    const report = validateCityNetwork(network);
    expect(report.issues.some((issue) => issue.code === 'missing-surface' && issue.segmentIds[0] === 'H-0-0')).toBe(true);
  });

  it('reports a removed segment that a connection still names, with its id in the message', () => {
    const network = cloneNetwork(base);
    network.segments = network.segments.filter((segment) => segment.id !== 'V-2-2');
    const report = validateRoadNetwork(network);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.segmentIds.includes('V-2-2'))).toBe(true);
  });

  it('reports a junction whose port is not on an axis of its centre', () => {
    const network = cloneNetwork(base);
    const junction = network.segments.find((segment) => segment.id === 'J-2-2');
    const port = junction?.ports[0];
    if (!junction || !port) throw new Error('fixture');
    port.position = { ...port.position, x: port.position.x + 3, z: port.position.z + 3 };
    const report = validateCityNetwork(network);
    expect(report.issues.some((issue) => issue.code === 'junction-centre' && issue.segmentIds[0] === 'J-2-2')).toBe(true);
  });
});

describe('district connectivity (test C)', () => {
  const network = buildCityNetwork();
  const graph = buildLaneGraph(network);
  const spawn = graph.byId.get('H-1-2:F:0');

  /** Every lane reachable from the spawn lane by following any successor (routes, not one choice). */
  function reachableFromSpawn(): Set<string> {
    const seen = new Set<string>();
    const queue: string[] = [spawn?.id ?? ''];
    while (queue.length > 0) {
      const id = queue.pop();
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      for (const next of graph.byId.get(id)?.successorIds ?? []) queue.push(next);
    }
    return seen;
  }

  it('can route from the spawn to a lane in every district', () => {
    const reachable = reachableFromSpawn();
    const districtsReached = new Set<DistrictId>();
    for (const id of reachable) {
      const lane = graph.byId.get(id);
      if (!lane || lane.kind !== 'segment') continue;
      const mid = lane.points[Math.floor(lane.points.length / 2)];
      if (!mid) continue;
      const district = districtOfPoint(mid.x, mid.z);
      if (district) districtsReached.add(district);
    }
    for (const district of Object.keys(DISTRICT_LABELS) as DistrictId[]) {
      expect(districtsReached.has(district), `district ${DISTRICT_LABELS[district]} reachable`).toBe(true);
    }
  });

  it('reaches the highway from the spawn', () => {
    const reachable = reachableFromSpawn();
    const highwayLanes = [...reachable].filter((id) => id.startsWith(`V-${CITY_HIGHWAY_COLUMN}-`));
    expect(highwayLanes.length).toBeGreaterThan(0);
  });

  it('every street lane belongs to a strongly connected class, so no district is cut off', () => {
    const report = validateCityNetwork(network);
    expect(report.issues.filter((issue) => issue.code === 'unreachable-segment')).toEqual([]);
  });

  it('district centres are inside their cells and the cell grid covers the whole city', () => {
    for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
      for (let i = CITY_CELL_INDEX_MIN; i <= CITY_CELL_INDEX_MAX; i += 1) {
        const c = cellCentre(i, j);
        expect(c.x).toBeGreaterThan(nodeX(i));
        expect(c.x).toBeLessThan(nodeX(i + 1));
        expect(c.z).toBeGreaterThan(nodeZ(j));
        expect(c.z).toBeLessThan(nodeZ(j + 1));
      }
    }
  });
});

describe('spawn and drivable area (test D)', () => {
  const network = buildCityNetwork();
  const boundary = buildRoadBoundary(network);

  it('spawns on the road with clearance from both edges', () => {
    const d = signedDistance(boundary, CITY_SPAWN.position.x, CITY_SPAWN.position.z);
    expect(d.segmentId).toBe('H-1-2');
    // Lane 0 sits 1.8 m from the centreline; the boundary is 10.2 m out, so the spawn is 8.4 m inside.
    expect(d.distance).toBeLessThan(-(NETWORK_PROFILE.boundaryHalfWidthMeters - 1.8) + 0.05);
    expect(d.distance).toBeLessThan(-5);
  });

  it('keeps every street centreline and both sides of it drivable between the junction pads', () => {
    // The ends of a street sit on the edge of the junction pad, where distance is exactly zero. That seam is covered by
    // the junction test below, so this test samples the interior, at least 2 m from either end.
    for (const segment of network.segments) {
      if (!segment.centerline) continue;
      const { points, s } = segment.centerline;
      const length = s[s.length - 1] ?? 0;
      // Every centreline sample, seven offsets on each side. Full density runs in about 2 s with the grid distance.
      for (let k = 0; k < points.length; k += 1) {
        const along = s[k] ?? 0;
        if (along < 2 || along > length - 2) continue;
        const p = points[k];
        const h = points[k + 1] ?? p;
        if (!p || !h) continue;
        const heading = Math.atan2(h.x - p.x, h.z - p.z);
        for (let offset = -7.2; offset <= 7.2; offset += 2.4) {
          const x = p.x + Math.cos(heading) * offset;
          const z = p.z - Math.sin(heading) * offset;
          expect(signedDistance(boundary, x, z).distance, `${segment.id} at ${k}`).toBeLessThan(0);
        }
      }
    }
  });

  it('keeps every junction pad drivable across its full square', () => {
    for (const segment of network.segments) {
      if (segment.kind !== 'junction' || !segment.junction) continue;
      const { centre, halfSizeMeters } = segment.junction;
      for (let dx = -halfSizeMeters + 0.5; dx <= halfSizeMeters - 0.5; dx += 2) {
        for (let dz = -halfSizeMeters + 0.5; dz <= halfSizeMeters - 0.5; dz += 2) {
          const d = signedDistance(boundary, centre.x + dx, centre.z + dz);
          expect(d.distance, `${segment.id} at ${dx},${dz}`).toBeLessThan(0);
        }
      }
    }
  });
});
