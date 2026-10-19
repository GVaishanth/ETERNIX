import type { Vec3 } from '../../core/types';
import { buildJunction, buildStraight, NETWORK_PROFILE, type JunctionArm } from '../roadBuilders';
import type { RoadConnection, RoadNetwork, RoadSegment } from '../roadTypes';
import { validateRoadNetwork } from '../roadValidation';
import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import { wrapIndex } from '../wrap/worldWrap';
import {
  CITY_CELL_INDEX_MAX,
  CITY_CELL_INDEX_MIN,
  CITY_HIGHWAY_COLUMN,
  CITY_HIGHWAY_ROW,
  CITY_HIGHWAY_SPEED_MPS,
  CITY_ID,
  CITY_NODE_INDEX_MAX,
  CITY_NODE_INDEX_MIN,
  CITY_NODE_SPACING_METERS,
  CITY_SPAWN,
  CITY_STREET_SPEED_MPS,
  isDirtStreet,
  nodeExists,
  nodeHeightMeters,
  nodeX,
  nodeZ,
} from './cityLayout';
import { validateCityNetwork } from './cityValidation';

/*
 * Builds the logical road network of the populated city from cityLayout.ts with the Part 3 builders. The same segment,
 * port, and connection model as the test circuit is used. Pure: no Three.js, no randomness.
 *
 * Segment ids: junctions J-i-j, east-west streets H-i-j, north-south streets V-i-j, using the index space of
 * cityLayout.ts (negative indices outside the original core). Connection ids C-<segment>-<port> for each street end.
 *
 * Two lattices share one builder. The finite city (buildCityNetwork) is unchanged. The looping city
 * (buildLoopCityNetwork) builds one period of the lattice and joins its east edge to its west edge and its north edge to
 * its south edge. Its network declares periodMeters, so validation compares ports on the torus.
 */

const EAST = Math.PI / 2;
const NORTH = 0;

/** Lattice description. The finite city and the loop differ only in range, node wrapping, and period. */
interface LatticeSpec {
  id: string;
  name: string;
  /** Lowest and highest node index built on each axis (inclusive). */
  nodeMin: number;
  nodeMax: number;
  /** Lowest and highest cell index built on each axis (inclusive). A cell's lower-left node is (i, j). */
  cellMin: number;
  cellMax: number;
  /** Maps a node index to the node a street reaches. Identity for the finite city, a period wrap for the loop. */
  wrapNode: (index: number) => number;
  /** True when a node exists in the lattice, before wrapping. */
  nodeExists: (i: number, j: number) => boolean;
  /** Torus period in metres, or undefined for a finite network. */
  periodMeters?: number;
}

const FINITE_SPEC: LatticeSpec = {
  id: CITY_ID,
  name: 'Veldmoor',
  nodeMin: CITY_NODE_INDEX_MIN,
  nodeMax: CITY_NODE_INDEX_MAX,
  cellMin: CITY_CELL_INDEX_MIN,
  cellMax: CITY_CELL_INDEX_MAX,
  wrapNode: (index) => index,
  nodeExists,
};

/**
 * The looping city. Nodes and cells run over one period, nodeMin .. nodeMin + periodNodes - 1. The node one past the
 * last is the first node again, so the duplicate node the finite layout builds at the far edge is not built here.
 */
const LOOP_FIRST_NODE = WORLD_WRAP_CONFIG.firstNodeIndex;
const LOOP_LAST_NODE = WORLD_WRAP_CONFIG.firstNodeIndex + WORLD_WRAP_CONFIG.periodNodes - 1;
const LOOP_SPEC: LatticeSpec = {
  id: `${CITY_ID}-loop`,
  name: 'Veldmoor Loop',
  nodeMin: LOOP_FIRST_NODE,
  nodeMax: LOOP_LAST_NODE,
  cellMin: LOOP_FIRST_NODE,
  cellMax: LOOP_LAST_NODE,
  wrapNode: (index) => wrapIndex(index, LOOP_FIRST_NODE, WORLD_WRAP_CONFIG.periodNodes),
  nodeExists: (i, j) => i >= LOOP_FIRST_NODE && i <= LOOP_LAST_NODE && j >= LOOP_FIRST_NODE && j <= LOOP_LAST_NODE,
  periodMeters: WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters,
};

/** Arms that connect at node (i, j). Each arm is the street leaving the node in that direction. */
export function junctionArms(i: number, j: number): JunctionArm[] {
  return armsOf(FINITE_SPEC, i, j);
}

function armsOf(spec: LatticeSpec, i: number, j: number): JunctionArm[] {
  const arms: JunctionArm[] = [];
  if (spec.nodeExists(i, spec.wrapNode(j + 1))) arms.push('north');
  if (spec.nodeExists(spec.wrapNode(i + 1), j)) arms.push('east');
  if (spec.nodeExists(i, spec.wrapNode(j - 1))) arms.push('south');
  if (spec.nodeExists(spec.wrapNode(i - 1), j)) arms.push('west');
  return arms;
}

function junctionId(i: number, j: number): string {
  return `J-${i}-${j}`;
}

export function buildCityNetwork(): RoadNetwork {
  return buildLattice(FINITE_SPEC);
}

/**
 * The looping city network: one period of the populated lattice, joined into a torus. It has
 * periodNodes * periodNodes junctions, every junction has four arms, and every street end meets its neighbour through the
 * period (H-7-j ends at junction J-(-4)-j, and V-i-7 ends at J-i-(-4)).
 */
export function buildLoopCityNetwork(): RoadNetwork {
  return buildLattice(LOOP_SPEC);
}

function buildLattice(spec: LatticeSpec): RoadNetwork {
  const half = NETWORK_PROFILE.boundaryHalfWidthMeters;
  const spacing = CITY_NODE_SPACING_METERS;
  const streetLength = spacing - 2 * half;
  const segments: RoadSegment[] = [];
  const connections: RoadConnection[] = [];

  for (let j = spec.nodeMin; j <= spec.nodeMax; j += 1) {
    for (let i = spec.nodeMin; i <= spec.nodeMax; i += 1) {
      if (!spec.nodeExists(i, j)) continue;
      const centre: Vec3 = { x: nodeX(i), y: nodeHeightMeters(i, j), z: nodeZ(j) };
      segments.push(
        buildJunction({ id: junctionId(i, j), centre, arms: armsOf(spec, i, j) }),
      );
    }
  }

  // East-west streets: H-i-j from node (i, j) east to node (i + 1, j). Start is just east of the west node.
  for (let j = spec.nodeMin; j <= spec.nodeMax; j += 1) {
    for (let i = spec.cellMin; i <= spec.cellMax; i += 1) {
      const id = `H-${i}-${j}`;
      const highway = j === CITY_HIGHWAY_ROW;
      segments.push(
        buildStraight({
          id,
          roadType: highway ? 'highway' : 'city',
          surface: isDirtStreet(i, j) ? 'dirt' : 'asphalt',
          // The street rises from its west node to its east node. Nodes wrap, so the east node of the last street is node -4.
          start: { position: { x: nodeX(i) + half, y: nodeHeightMeters(i, j), z: nodeZ(j) }, heading: EAST },
          endHeightMeters: nodeHeightMeters(i + 1, j),
          lengthMeters: streetLength,
          speedLimitMps: highway ? CITY_HIGHWAY_SPEED_MPS : CITY_STREET_SPEED_MPS,
        }),
      );
      connections.push(
        { id: `C-${id}-start`, a: { segmentId: junctionId(i, j), portId: 'east' }, b: { segmentId: id, portId: 'start' } },
        { id: `C-${id}-end`, a: { segmentId: id, portId: 'end' }, b: { segmentId: junctionId(spec.wrapNode(i + 1), j), portId: 'west' } },
      );
    }
  }

  // North-south streets: V-i-j from node (i, j) north to node (i, j + 1). The highway is the east column.
  for (let i = spec.nodeMin; i <= spec.nodeMax; i += 1) {
    for (let j = spec.cellMin; j <= spec.cellMax; j += 1) {
      const id = `V-${i}-${j}`;
      const highway = i === CITY_HIGHWAY_COLUMN;
      segments.push(
        buildStraight({
          id,
          roadType: highway ? 'highway' : 'city',
          surface: isDirtStreet(i, j) ? 'dirt' : 'asphalt',
          start: { position: { x: nodeX(i), y: nodeHeightMeters(i, j), z: nodeZ(j) + half }, heading: NORTH },
          endHeightMeters: nodeHeightMeters(i, j + 1),
          lengthMeters: streetLength,
          speedLimitMps: highway ? CITY_HIGHWAY_SPEED_MPS : CITY_STREET_SPEED_MPS,
        }),
      );
      connections.push(
        { id: `C-${id}-start`, a: { segmentId: junctionId(i, j), portId: 'north' }, b: { segmentId: id, portId: 'start' } },
        { id: `C-${id}-end`, a: { segmentId: id, portId: 'end' }, b: { segmentId: junctionId(i, spec.wrapNode(j + 1)), portId: 'south' } },
      );
    }
  }

  const network: RoadNetwork = {
    id: spec.id,
    name: spec.name,
    segments,
    connections,
    spawn: { position: { ...CITY_SPAWN.position }, yawRadians: CITY_SPAWN.yawRadians },
  };
  if (spec.periodMeters !== undefined) network.periodMeters = spec.periodMeters;

  const report = validateRoadNetwork(network);
  if (!report.valid) {
    const messages = report.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
    throw new Error(`City road network ${spec.id} failed connection validation: ${messages.join('; ')}`);
  }
  const cityReport = validateCityNetwork(network);
  if (!cityReport.valid) {
    const messages = cityReport.issues.map((issue) => `${issue.code} [${issue.segmentIds.join(', ')}]: ${issue.message}`);
    throw new Error(`City road network ${spec.id} failed city validation: ${messages.join('; ')}`);
  }
  return network;
}
