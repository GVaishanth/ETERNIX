import { findShortestLanePath } from '../traffic/lanePlanner';
import { laneSample, nearestOnLane, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import { wrapDelta, wrapToBase } from '../world/wrap/worldWrap';

/*
 * Navigation route on the drivable lane graph. Pure: no React and no three.js.
 *
 * Coordinates are simulation x and z. On a looping world the route is unwrapped from the car: its points start at the
 * car's logical position and continue across a seam, so they are continuous in the same frame as the car. A car one
 * period away from a lane point is the same car, so the route never jumps.
 */

/** Spacing of route samples along a lane, metres. */
export const NAVIGATION_SAMPLE_METERS = 5;
/** Lanes within this distance of the nearest lane are all tried as a start, so a car on a two-way street can use either way. */
const START_CANDIDATE_METERS = 2;

export interface NavigationPoint {
  readonly x: number;
  readonly z: number;
}

export interface NavigationGoal {
  readonly kind: 'career' | 'garage' | 'checkpoint';
  /** Player-facing name of the destination. */
  readonly label: string;
  readonly laneId: string;
  /** Distance along the goal lane, metres. */
  readonly s: number;
  /** The goal point in the base domain. The minimap and the garage ring read it. */
  readonly x: number;
  readonly z: number;
}

export interface NavigationRoute {
  readonly goal: NavigationGoal;
  /** Lanes in travel order, from the car's lane to the goal's lane. */
  readonly laneIds: readonly string[];
  /** Route points in simulation coordinates, starting at the car. */
  readonly points: readonly NavigationPoint[];
  readonly lengthMeters: number;
}

export interface LaneHit {
  readonly laneId: string;
  readonly s: number;
  readonly distance: number;
}

/** The base-domain value of a coordinate on a looping world. Finite worlds (null period) are unchanged. */
export function baseOf(value: number, periodMeters: number | null): number {
  return periodMeters === null ? value : wrapToBase(value, periodMeters);
}

/** The nearest point on every lane to (x, z), in the base domain. */
function laneHits(graph: LaneGraph, x: number, z: number): LaneHit[] {
  const hits: LaneHit[] = [];
  for (const lane of graph.lanes) {
    const hit = nearestOnLane(lane, x, z);
    if (hit !== null) hits.push({ laneId: lane.id, s: hit.s, distance: hit.distance });
  }
  return hits;
}

/** The nearest lane to (x, z) in the base domain, or null when the graph has no lanes. */
export function nearestLane(graph: LaneGraph, x: number, z: number): LaneHit | null {
  let best: LaneHit | null = null;
  for (const hit of laneHits(graph, x, z)) {
    if (best === null || hit.distance < best.distance) best = hit;
  }
  return best;
}

/**
 * Metres a car drives along a lane route from its start point to the goal point. The first lane counts from the start
 * point to its end, the last lane from its beginning to the goal point. A single-lane route is the gap between them.
 */
export function routeMeters(graph: LaneGraph, laneIds: readonly string[], start: LaneHit, goal: NavigationGoal): number {
  const first = graph.byId.get(laneIds[0] ?? '');
  const last = graph.byId.get(laneIds[laneIds.length - 1] ?? '');
  if (!first || !last) return Number.POSITIVE_INFINITY;
  if (laneIds.length === 1) return goal.s - start.s;
  let metres = first.lengthMeters - start.s + goal.s;
  for (let i = 1; i < laneIds.length - 1; i += 1) metres += graph.byId.get(laneIds[i] ?? '')?.lengthMeters ?? 0;
  return metres;
}

/**
 * Lanes to a goal from a start lane, the shortest by metres. A goal behind the start on the same lane is reached by
 * going round through a successor, because the lane itself only runs forward.
 */
function routeLaneIds(graph: LaneGraph, start: LaneHit, goal: NavigationGoal): string[] | null {
  if (start.laneId !== goal.laneId || start.s <= goal.s) {
    return findShortestLanePath(graph, start.laneId, goal.laneId);
  }
  const lane = graph.byId.get(start.laneId);
  if (!lane) return null;
  let best: string[] | null = null;
  let bestMetres = Number.POSITIVE_INFINITY;
  for (const next of lane.successorIds) {
    const tail = findShortestLanePath(graph, next, goal.laneId);
    if (tail === null) continue;
    const laneIds = [start.laneId, ...tail];
    const metres = routeMeters(graph, laneIds, start, goal);
    if (metres < bestMetres) {
      best = laneIds;
      bestMetres = metres;
    }
  }
  return best;
}

/** The start candidate with the shortest route (in metres) to the goal, or null when none reaches it. */
function bestStart(graph: LaneGraph, hits: readonly LaneHit[], goal: NavigationGoal): { start: LaneHit; laneIds: string[] } | null {
  let chosen: { start: LaneHit; laneIds: string[]; metres: number } | null = null;
  for (const start of hits) {
    const laneIds = routeLaneIds(graph, start, goal);
    if (laneIds === null) continue;
    const metres = routeMeters(graph, laneIds, start, goal);
    if (chosen === null || metres < chosen.metres) chosen = { start, laneIds, metres };
  }
  return chosen === null ? null : { start: chosen.start, laneIds: chosen.laneIds };
}

function appendLaneSamples(out: NavigationPoint[], lane: LanePath, from: number, to: number): void {
  const span = to - from;
  if (span < 0) return;
  const steps = Math.max(1, Math.ceil(span / NAVIGATION_SAMPLE_METERS));
  for (let k = 0; k <= steps; k += 1) {
    const pose = laneSample(lane, from + (span * k) / steps);
    out.push({ x: pose.x, z: pose.z });
  }
}

/**
 * The route from a car to a goal. Null when no lane route exists. The points are unwrapped from the car's logical
 * position, so a route across a seam continues past the seam instead of jumping back by a period.
 */
export function buildNavigationRoute(
  graph: LaneGraph,
  car: NavigationPoint,
  periodMeters: number | null,
  goal: NavigationGoal,
): NavigationRoute | null {
  const base = { x: baseOf(car.x, periodMeters), z: baseOf(car.z, periodMeters) };
  const all = laneHits(graph, base.x, base.z);
  if (all.length === 0) return null;
  const nearest = Math.min(...all.map((hit) => hit.distance));
  const nearHits = all.filter((hit) => hit.distance <= nearest + START_CANDIDATE_METERS);
  let chosen = bestStart(graph, nearHits, goal);
  if (chosen === null) {
    // The nearest lanes are in one circuit of the two-way road, and the goal is not reachable from it. The car turns
    // round on its own segment: the other lanes of that segment start the route, which joins the other circuit.
    const owner = nearHits.map((hit) => graph.byId.get(hit.laneId)?.ownerId).find((id) => id !== undefined);
    if (owner !== undefined) {
      chosen = bestStart(graph, all.filter((hit) => graph.byId.get(hit.laneId)?.ownerId === owner), goal);
    }
  }
  if (chosen === null) return null;

  const { start, laneIds } = chosen;
  const basePoints: NavigationPoint[] = [];
  for (let i = 0; i < laneIds.length; i += 1) {
    const laneId = laneIds[i];
    const lane = laneId === undefined ? undefined : graph.byId.get(laneId);
    if (lane === undefined) return null;
    const from = i === 0 ? start.s : 0;
    const to = i === laneIds.length - 1 ? goal.s : lane.lengthMeters;
    appendLaneSamples(basePoints, lane, from, to);
  }

  // Unwrap from the car's logical position: each step adds the short way round the period.
  const points: NavigationPoint[] = [{ x: car.x, z: car.z }];
  let logical: NavigationPoint = { x: car.x, z: car.z };
  let previous = base;
  for (const point of basePoints) {
    if (periodMeters === null) {
      logical = point;
    } else {
      logical = {
        x: logical.x + wrapDelta(previous.x, point.x, periodMeters),
        z: logical.z + wrapDelta(previous.z, point.z, periodMeters),
      };
    }
    previous = point;
    points.push(logical);
  }

  let lengthMeters = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) lengthMeters += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return { goal, laneIds, points, lengthMeters };
}
