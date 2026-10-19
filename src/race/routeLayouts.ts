import type { RaceEventDefinition, RouteAnchor } from './raceTypes';

/*
 * Route layouts for career races. A layout is only the path: its type, anchors, lap count, and (optionally) the streets
 * the route passes between anchors. Each race adds its own name, opponents, reward, and marker. Every layout is a
 * different path through the city, so no two races drive the same streets. raceEvents.test.ts and
 * raceRouteDiversity.test.ts check that no two races share a path on the looping world.
 *
 * Lane ids follow the city lattice (src/world/city/cityLayout.ts): H-i-j runs east from node (i, j), V-i-j runs north
 * from node (i, j). `:F:0` is the forward lane, `:R:0` the reverse lane. Nodes wrap on both axes (-4..9, the loop city),
 * the same way as the loop world.
 *
 * Division 1 and Division 2 layouts are written as move strings from a start node: E, W, N, S, one per street. Each
 * street gets a via anchor (legVia), so the route drives exactly those streets in that order. Checkpoints sit on the
 * listed street indices. Other layouts (rivals in later divisions) are anchors only, and their legs are the shortest
 * drivable path between anchors (buildRaceRoute).
 */

export type RouteLayout = Pick<RaceEventDefinition, 'type' | 'start' | 'checkpoints' | 'finish' | 'laps' | 'timeLimitSeconds'> &
  Partial<Pick<RaceEventDefinition, 'legVia'>>;

function anchor(id: string, label: string, laneId: string, s: number): RouteAnchor {
  return { id, label, laneId, s };
}

/** A single run. Start, checkpoints, and finish, in order. One lap. */
function sprint(start: RouteAnchor, checkpoints: RouteAnchor[], finish: RouteAnchor): RouteLayout {
  return { type: 'sprint', start, checkpoints, finish, laps: 1, timeLimitSeconds: null };
}

/**
 * One lap of a city block. The start/finish line is the start anchor again, as a circuit requires. Two checkpoints in
 * travel order, then the line closes the lap. Two laps per race.
 */
function circuit(startLane: string, startS: number, checkpointA: RouteAnchor, checkpointB: RouteAnchor): RouteLayout {
  const line = anchor('start-finish', 'Start / Finish', startLane, startS);
  return { type: 'circuit', start: line, checkpoints: [checkpointA, checkpointB], finish: line, laps: 2, timeLimitSeconds: null };
}

type Node = readonly [number, number];

/** Wraps a node index into the loop city's range (-4..9). */
function wrapNode(n: number): number {
  return (((n + 4) % 14) + 14) % 14 - 4;
}

/** The lane each move drives on, in order. */
function streetLanes(start: Node, moves: string): string[] {
  const lanes: string[] = [];
  let [i, j] = start;
  for (const move of moves) {
    if (move === 'E') {
      lanes.push(`H-${wrapNode(i)}-${wrapNode(j)}:F:0`);
      i += 1;
    } else if (move === 'W') {
      i -= 1;
      lanes.push(`H-${wrapNode(i)}-${wrapNode(j)}:R:0`);
    } else if (move === 'N') {
      lanes.push(`V-${wrapNode(i)}-${wrapNode(j)}:F:0`);
      j += 1;
    } else if (move === 'S') {
      j -= 1;
      lanes.push(`V-${wrapNode(i)}-${wrapNode(j)}:R:0`);
    } else {
      throw new Error(`Unknown move "${move}" in route layout.`);
    }
  }
  return lanes;
}

/** Street indices (into the moves) of the waypoints, in order. A circuit's last waypoint is the closing line. */
function viaFor(lanes: string[], waypointIndices: number[], prefix: string): RouteAnchor[][] {
  const legs: RouteAnchor[][] = [];
  for (let k = 0; k + 1 < waypointIndices.length; k += 1) {
    const from = waypointIndices[k] ?? 0;
    const to = waypointIndices[k + 1] ?? lanes.length;
    const via: RouteAnchor[] = [];
    for (let s = from + 1; s < to; s += 1) {
      const lane = lanes[s];
      if (lane) via.push(anchor(`${prefix}-${s}`, `Street ${s + 1}`, lane, 90));
    }
    legs.push(via);
  }
  return legs;
}

/** A sprint from a node along the move string. Checkpoints are street indices; the finish is the last street. */
function sprintFromMoves(from: Node, moves: string, checkpointStreets: [number, ...number[]]): RouteLayout {
  const lanes = streetLanes(from, moves);
  const last = lanes.length - 1;
  const first = lanes[0] ?? '';
  const checkpoints = checkpointStreets.map((index, k) =>
    anchor(`cp-${k + 1}`, `Checkpoint ${k + 1}`, lanes[index] ?? first, 90),
  );
  const waypoints = [0, ...checkpointStreets, last];
  return {
    type: 'sprint',
    start: anchor('start', 'Start', first, 65),
    checkpoints,
    finish: anchor('finish', 'Finish', lanes[last] ?? first, 90),
    laps: 1,
    timeLimitSeconds: null,
    legVia: viaFor(lanes, waypoints, 'via'),
  };
}

/**
 * A circuit from a node along the move string, closing back on its start. The start/finish line sits on the first
 * street at s 65. Checkpoints are street indices. The moves must return to the start node.
 */
function circuitFromMoves(from: Node, moves: string, checkpointA: number, checkpointB: number): RouteLayout {
  const lanes = streetLanes(from, moves);
  const line = anchor('start-finish', 'Start / Finish', lanes[0] ?? '', 65);
  return {
    type: 'circuit',
    start: line,
    checkpoints: [
      anchor('cp-a', 'Checkpoint A', lanes[checkpointA] ?? '', 100),
      anchor('cp-b', 'Checkpoint B', lanes[checkpointB] ?? '', 100),
    ],
    finish: line,
    laps: 2,
    timeLimitSeconds: null,
    legVia: viaFor(lanes, [0, checkpointA, checkpointB, lanes.length], 'via'),
  };
}

/** Harbour Warm-Up (Division 1): east along the south edge, north, then west back across the south. 16 streets, 3.2 km. */
export const LAYOUT_WARMUP: RouteLayout = sprintFromMoves([-2, -4], 'EEEEEEENNWWWWWWW', [7]);

/** Mara's run (Division 1): west along the south, north through the west residential streets, then east. 16 streets, 3.2 km. */
export const LAYOUT_MARA: RouteLayout = sprintFromMoves([5, -1], 'WWWWWWWNNEEEEEEE', [7]);

/** Checkpoint Run (Division 1): north up the west edge with two checkpoints, then east. 17 streets, 3.4 km. */
export const LAYOUT_CHECKPOINT_WEST: RouteLayout = sprintFromMoves([-2, -3], 'NNNNNNEENNNNEEEEE', [5, 11]);

/** Clock Run (Division 1): a countryside run, east then north then west, driven alone. 17 streets, 3.4 km. */
export const LAYOUT_CLOCK_COUNTRY: RouteLayout = sprintFromMoves([-2, 4], 'EEEEEEENNNWWWWWWW', [8]);

/** Block Laps (Division 1): two laps of a residential block on the west side. 10 streets (2 km) per lap. */
export const LAYOUT_BLOCK_WEST: RouteLayout = circuitFromMoves([0, 0], 'NNEEESSWWW', 3, 7);

/** Warehouse Circuit (Division 2): two laps of a block in the hillside's south, with traffic on the road. 2 km per lap. */
export const LAYOUT_WAREHOUSE: RouteLayout = circuitFromMoves([6, -4], 'EENNNWWSSS', 3, 7);

/** Ren's circuit (Division 2): two laps of the hillside's upper block, the tower of the Syndicate, with traffic. 2 km per lap. */
export const LAYOUT_REN_TOWER: RouteLayout = circuitFromMoves([6, 4], 'EENNNWWSSS', 3, 7);

/**
 * Seam Run (Division 2): east along the hillside's crest row, across the loop seam (node 9 to node -4), and on into the
 * flat city. 13 streets, 2.6 km. Loop world only.
 */
export const LAYOUT_SEAM_RIDGE: RouteLayout = sprintFromMoves([6, 2], 'EEEEEEEEEENNN', [4]);

/** Tight Corners (Division 2): a switchback run across the hillside's middle rows, with several turns and traffic. 14 streets, 2.8 km. */
export const LAYOUT_TIGHT_CORNERS: RouteLayout = sprintFromMoves([6, 3], 'EESSWWNNWWNNEE', [3, 9]);

/** Teo's circuit: two laps of a commercial block in the north. */
export const LAYOUT_TEO_COMMERCIAL: RouteLayout = circuit(
  'H-1-3:F:0',
  65,
  anchor('cp-a', 'Checkpoint A', 'V-2-3:F:0', 100),
  anchor('cp-b', 'Checkpoint B', 'H-1-4:R:0', 100),
);

/** Juno's run: north on the highway column, then east onto the highway row. */
export const LAYOUT_JUNO_HIGHWAY: RouteLayout = sprint(
  anchor('start', 'Start', 'V-4--3:F:0', 65),
  [anchor('cp-1', 'Checkpoint 1', 'V-4-3:F:0', 90)],
  anchor('finish', 'Finish', 'H-5-6:F:0', 90),
);

/** Kai's circuit: two laps of a downtown block. */
export const LAYOUT_KAI_DOWNTOWN: RouteLayout = circuit(
  'H-1-1:F:0',
  65,
  anchor('cp-a', 'Checkpoint A', 'V-2-1:F:0', 100),
  anchor('cp-b', 'Checkpoint B', 'H-1-2:R:0', 100),
);

/** The marker for a race: a roadside beacon on the start line, on the verge, like the other races. */
export function routeMarker(layout: RouteLayout): { laneId: string; s: number; sideOffsetMeters: number } {
  return { laneId: layout.start.laneId, s: layout.start.s, sideOffsetMeters: -11.5 };
}
