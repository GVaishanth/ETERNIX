import { rightFromYaw } from '../core/coordinates';
import { RACE_CONFIG, RACE_GRID_LANES, RACE_MIN_RACERS } from '../config/raceConfig';
import { findLanePath } from '../traffic/lanePlanner';
import { laneSample, twinLaneId, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import type { RaceEventDefinition, RaceGateDef, RouteAnchor } from './raceTypes';

/*
 * Race route building and validation (Part 6). Pure: built from the road graph and an event definition, with no
 * rendering or simulation state. An event is only usable when buildRaceRoute returns valid = true. Every problem is
 * reported as an issue with the ids that caused it. Nothing is discarded silently and nothing is snapped.
 *
 * Route model. The route is an ordered list of street lanes, found by breadth-first search between the anchors in
 * travel order (findLanePath, which follows the graph's successor edges). A sprint is a path from the start lane to the
 * finish. A circuit is a closed cycle whose origin is the start/finish line, so each lap runs from that line back to it.
 * Gates sit on the anchors. Progress is measured along the route polyline, in route distance.
 */

export type RouteIssueCode =
  | 'anchor-missing-lane'
  | 'anchor-not-segment'
  | 'anchor-outside-lane'
  | 'anchor-at-lane-end'
  | 'anchor-duplicate-id'
  | 'circuit-start-mismatch'
  | 'leg-unreachable'
  | 'leg-via-count'
  | 'route-lane-repeated'
  | 'order-not-increasing'
  | 'cycle-not-closed'
  | 'laps-invalid'
  | 'grid-does-not-fit'
  | 'marker-missing-lane'
  | 'marker-too-close-to-road';

export interface RouteIssue {
  code: RouteIssueCode;
  message: string;
  /** Ids of the event, anchors, or lanes involved. */
  ids: string[];
}

export interface RoutePolyline {
  xs: Float64Array;
  zs: Float64Array;
  /** Route distance at each sample, meters, increasing from 0 at the route origin. */
  ds: Float64Array;
}

export interface RaceRoute {
  eventId: string;
  cyclic: boolean;
  /**
   * Period of a looping world, in metres. Racer positions are mapped into the route's base domain, so a car one period
   * away from a route point is the same car at the same place. Absent for a finite world, which is unchanged.
   */
  periodMeters?: number;
  /** Lanes in travel order. For a cycle the first lane is not repeated at the end. */
  laneIds: readonly string[];
  /** Successor lane on the route, for the AI. A cycle wraps. A sprint ends at its last lane. */
  nextLaneId: ReadonlyMap<string, string>;
  /** Route length: the sprint path, or one full lap. */
  totalMeters: number;
  /** Route distance of the origin on the first lane. Zero for a sprint. The finish line for a circuit. */
  originMeters: number;
  polyline: RoutePolyline;
  /** Gates for one lap, in travel order. A sprint has one lap; a circuit repeats these `laps` times. */
  gates: readonly RaceGateDef[];
  laps: number;
  /** Grid anchor on the first lane, simulation space. Row 0 of the grid sits here. */
  grid: { laneId: string; s: number; x: number; z: number; yawRadians: number };
  /** Roadside marker, simulation space. */
  marker: { x: number; z: number; yawRadians: number };
}

export interface RouteResult {
  valid: boolean;
  issues: RouteIssue[];
  route: RaceRoute | null;
}

function anchorIssue(graph: LaneGraph, anchor: RouteAnchor, eventId: string, issues: RouteIssue[]): LanePath | null {
  const lane = graph.byId.get(anchor.laneId);
  if (!lane) {
    issues.push({ code: 'anchor-missing-lane', message: `Anchor ${anchor.id} in ${eventId} names lane ${anchor.laneId}, which is not in the road graph.`, ids: [eventId, anchor.id, anchor.laneId] });
    return null;
  }
  if (lane.kind !== 'segment') {
    issues.push({ code: 'anchor-not-segment', message: `Anchor ${anchor.id} in ${eventId} is on connector lane ${lane.id}. Gates belong on street lanes.`, ids: [eventId, anchor.id, lane.id] });
    return null;
  }
  if (!(anchor.s <= lane.lengthMeters)) {
    issues.push({ code: 'anchor-outside-lane', message: `Anchor ${anchor.id} at s=${anchor.s} m is beyond lane ${lane.id} (length ${lane.lengthMeters.toFixed(1)} m).`, ids: [eventId, anchor.id, lane.id] });
    return null;
  }
  const clearance = RACE_CONFIG.anchorEdgeClearanceMeters;
  if (!(anchor.s >= clearance && anchor.s <= lane.lengthMeters - clearance)) {
    issues.push({ code: 'anchor-at-lane-end', message: `Anchor ${anchor.id} at s=${anchor.s} m is within ${clearance} m of an end of lane ${lane.id}.`, ids: [eventId, anchor.id, lane.id] });
    return null;
  }
  return lane;
}

/** Builds and validates the route for one event. Deterministic. Bad data yields issues and a null route, never a throw. */
export function buildRaceRoute(event: RaceEventDefinition, graph: LaneGraph): RouteResult {
  const issues: RouteIssue[] = [];
  const fail = (): RouteResult => ({ valid: false, issues, route: null });

  // Anchor ids are unique. A circuit's start line is its finish line, so those two must be the same anchor.
  if (event.type === 'circuit') {
    if (event.start.id !== event.finish.id || event.start.laneId !== event.finish.laneId || event.start.s !== event.finish.s) {
      issues.push({ code: 'circuit-start-mismatch', message: `Circuit ${event.id} must use one start/finish line: start ${event.start.id} and finish ${event.finish.id} differ.`, ids: [event.id, event.start.id, event.finish.id] });
    }
  }
  const idSeen = new Set<string>();
  // A circuit's finish is its start line, so it is listed once.
  const uniqueAnchors = event.type === 'circuit' ? [event.start, ...event.checkpoints] : [event.start, ...event.checkpoints, event.finish];
  for (const anchor of uniqueAnchors) {
    if (idSeen.has(anchor.id)) {
      issues.push({ code: 'anchor-duplicate-id', message: `Anchor id ${anchor.id} is used more than once in ${event.id}.`, ids: [event.id, anchor.id] });
    }
    idSeen.add(anchor.id);
  }
  if (!Number.isInteger(event.laps) || event.laps < 1) {
    issues.push({ code: 'laps-invalid', message: `Event ${event.id} has an invalid lap count ${event.laps}.`, ids: [event.id] });
  }
  if (event.type === 'circuit' && event.laps < 2) {
    issues.push({ code: 'laps-invalid', message: `Circuit ${event.id} must have at least 2 laps, not ${event.laps}.`, ids: [event.id] });
  }
  if (event.type === 'sprint' && event.laps !== 1) {
    issues.push({ code: 'laps-invalid', message: `Sprint ${event.id} must have 1 lap, not ${event.laps}.`, ids: [event.id] });
  }
  if (event.checkpoints.length < 1 && event.type === 'circuit') {
    issues.push({ code: 'order-not-increasing', message: `Circuit ${event.id} needs at least one checkpoint besides its start/finish line.`, ids: [event.id] });
  }
  if (issues.length > 0) return fail();

  // Every anchor must be a valid street position.
  const viaAnchors = (event.legVia ?? []).flat();
  const laneChecks = [...uniqueAnchors, event.finish, ...viaAnchors].map((anchor) => anchorIssue(graph, anchor, event.id, issues));
  if (laneChecks.some((lane) => lane === null)) return fail();
  const legCount = event.checkpoints.length + 1; // start or finish to first checkpoint, and so on to the finish
  if ((event.legVia?.length ?? 0) > legCount) {
    issues.push({ code: 'leg-via-count', message: `Event ${event.id} gives ${event.legVia?.length} via lists for ${legCount} legs.`, ids: [event.id] });
    return fail();
  }

  // Waypoints in travel order. A circuit's waypoints start and end on the finish line.
  const waypoints: RouteAnchor[] = event.type === 'circuit'
    ? [event.finish, ...event.checkpoints, event.finish]
    : [event.start, ...event.checkpoints, event.finish];

  // Legs: the shortest lane path between consecutive waypoints. Each leg must exist in the graph.
  const laneIds: string[] = [];
  let legIndex = 0;
  for (let k = 0; k + 1 < waypoints.length; k += 1) {
    const from = waypoints[k];
    const to = waypoints[k + 1];
    if (!from || !to) return fail();
    // The leg goes through its via points, in order, so the designed streets are the ones driven.
    const chain: RouteAnchor[] = [from, ...(event.legVia?.[legIndex] ?? []), to];
    legIndex += 1;
    for (let c = 0; c + 1 < chain.length; c += 1) {
      const a = chain[c];
      const b = chain[c + 1];
      if (!a || !b) return fail();
      const leg = findLanePath(graph, a.laneId, b.laneId);
      if (!leg) {
        issues.push({ code: 'leg-unreachable', message: `No drivable path in ${event.id} from ${a.id} (${a.laneId}) to ${b.id} (${b.laneId}).`, ids: [event.id, a.id, b.id] });
        return fail();
      }
      // The first lane of a leg is the last lane of the previous leg, so it is not repeated.
      laneIds.push(...(laneIds.length === 0 ? leg : leg.slice(1)));
    }
  }

  const cyclic = event.type === 'circuit';
  if (cyclic) {
    // The last leg arrives on the start/finish lane, which is also the first lane. Drop that closing repeat.
    if (laneIds[laneIds.length - 1] === laneIds[0]) laneIds.pop();
    else issues.push({ code: 'cycle-not-closed', message: `Circuit ${event.id} does not return to lane ${laneIds[0]}.`, ids: [event.id] });
  }
  if (issues.length > 0) return fail();

  // A lane may appear once, or the successor map would be ambiguous.
  const laneIndex = new Map<string, number>();
  laneIds.forEach((id, at) => {
    if (laneIndex.has(id)) {
      issues.push({ code: 'route-lane-repeated', message: `Route in ${event.id} visits lane ${id} more than once.`, ids: [event.id, id] });
    }
    laneIndex.set(id, at);
  });
  if (issues.length > 0) return fail();

  const lanes: LanePath[] = [];
  for (const id of laneIds) {
    const lane = graph.byId.get(id);
    if (!lane) return fail();
    lanes.push(lane);
  }
  const first = lanes[0];
  if (!first) return fail();

  // Route distance of the start of each lane, and the total length.
  const prefix: number[] = [];
  let total = 0;
  for (const lane of lanes) {
    prefix.push(total);
    total += lane.lengthMeters;
  }
  const originMeters = cyclic ? event.finish.s : 0;
  // Circuit distances are measured from the finish line and wrap at one lap. Sprint distances are plain.
  const wrap = (d: number): number => (cyclic ? (((d - originMeters) % total) + total) % total : d);
  const routeDistanceOf = (anchor: RouteAnchor): number => {
    const at = laneIndex.get(anchor.laneId) ?? 0;
    return wrap((prefix[at] ?? 0) + anchor.s);
  };

  // Travel order. Sprint: start < checkpoints < finish. Circuit: 0 (finish line) < checkpoints < lap length.
  if (cyclic) {
    let previous = 0;
    for (const cp of event.checkpoints) {
      const d = routeDistanceOf(cp);
      if (!(d > previous && d < total)) {
        issues.push({ code: 'order-not-increasing', message: `Checkpoint ${cp.id} in ${event.id} sits at ${d.toFixed(1)} m on the lap, which is out of order (it must follow ${previous.toFixed(1)} m and come before the ${total.toFixed(1)} m lap end).`, ids: [event.id, cp.id] });
      }
      previous = d;
    }
  } else {
    let previous = routeDistanceOf(event.start);
    for (const anchor of [...event.checkpoints, event.finish]) {
      const d = routeDistanceOf(anchor);
      if (!(d > previous)) {
        issues.push({ code: 'order-not-increasing', message: `Anchor ${anchor.id} in ${event.id} sits at ${d.toFixed(1)} m along the route, not after the previous gate at ${previous.toFixed(1)} m. Checkpoints must follow travel order.`, ids: [event.id, anchor.id] });
      }
      previous = d;
    }
  }
  if (issues.length > 0) return fail();

  // Gates for one lap. The circuit's finish gate closes each lap.
  const lapAnchors = [...event.checkpoints, event.finish];
  const gates: RaceGateDef[] = lapAnchors.map((anchor) => {
    const lane = graph.byId.get(anchor.laneId);
    const pose = lane ? laneSample(lane, anchor.s) : { x: 0, z: 0, heading: 0 };
    const right = rightFromYaw(pose.heading);
    const offset = lane?.offsetMeters ?? 0;
    return {
      id: anchor.id,
      label: anchor.label,
      // The lane is offset to the right of its centre line. The gate is on the road centre, so take the offset back.
      x: pose.x - right.x * offset,
      z: pose.z - right.z * offset,
      headingRadians: pose.heading,
      routeDistanceMeters: routeDistanceOf(anchor),
      closesLap: anchor.id === event.finish.id,
    };
  });

  // Polyline with route distances. A circuit starts at its origin (the first sample at or after the finish line).
  const xs: number[] = [];
  const zs: number[] = [];
  const ds: number[] = [];
  lanes.forEach((lane, at) => {
    lane.points.forEach((p, i) => {
      xs.push(p.x);
      zs.push(p.z);
      ds.push(wrap((prefix[at] ?? 0) + (lane.s[i] ?? 0)));
    });
  });
  let rot = 0;
  if (cyclic) {
    // Wrapped distances run from the origin upward, then wrap to 0 at the origin. Start at the smallest one.
    let best = Infinity;
    ds.forEach((d, i) => {
      if (d < best) {
        best = d;
        rot = i;
      }
    });
  }
  const n = xs.length;
  const polyline: RoutePolyline = { xs: new Float64Array(n), zs: new Float64Array(n), ds: new Float64Array(n) };
  for (let i = 0; i < n; i += 1) {
    const from = (i + rot) % n;
    polyline.xs[i] = xs[from] ?? 0;
    polyline.zs[i] = zs[from] ?? 0;
    polyline.ds[i] = ds[from] ?? 0;
  }

  // Successor map along the route, for the AI. A cycle wraps. Every link must exist in the road graph.
  const nextLaneId = new Map<string, string>();
  for (let i = 0; i < laneIds.length; i += 1) {
    const here = laneIds[i];
    const next = laneIds[i + 1] ?? (cyclic ? laneIds[0] : undefined);
    if (here === undefined || next === undefined) continue;
    nextLaneId.set(here, next);
    if (!(graph.byId.get(here)?.successorIds ?? []).includes(next)) {
      issues.push({ code: 'cycle-not-closed', message: `Lane ${here} does not lead to ${next} in the road graph (route ${event.id}).`, ids: [event.id, here, next] });
    }
  }
  if (issues.length > 0) return fail();

  // Grid: row k sits k rows behind the start anchor. The grid has RACE_GRID_LANES columns: the route's first lane (lane
  // index 0) and its twins on the other forward lanes. Every row must fit on every grid lane. Validated for the full
  // field, so a route's validity does not change with the opponent count.
  const rows = Math.ceil(RACE_MIN_RACERS / RACE_GRID_LANES);
  const gridBack = (rows - 1) * RACE_CONFIG.gridRowSpacingMeters;
  const gridLanes = Array.from({ length: RACE_GRID_LANES }, (_, column) => (column === 0 ? first : graph.byId.get(twinLaneId(first.id, column))));
  const gridFits = first.laneIndex === 0
    && first.id === event.start.laneId
    && gridLanes.every((lane) => lane !== undefined && event.start.s - gridBack >= RACE_CONFIG.anchorEdgeClearanceMeters);
  if (!gridFits) {
    issues.push({
      code: 'grid-does-not-fit',
      message: `Grid for ${event.id} needs ${gridBack.toFixed(0)} m behind the start on the ${RACE_GRID_LANES} grid lanes of ${first.id}, but only ${event.start.s.toFixed(0)} m are available.`,
      ids: [event.id, first.id],
    });
    return fail();
  }
  const startPose = laneSample(first, event.start.s);

  // Roadside marker: on a lane that exists, and at least the configured distance from the road centre.
  const markerLane = graph.byId.get(event.marker.laneId);
  if (!markerLane) {
    issues.push({ code: 'marker-missing-lane', message: `Marker of ${event.id} names lane ${event.marker.laneId}, which is not in the road graph.`, ids: [event.id, event.marker.laneId] });
    return fail();
  }
  if (Math.abs(event.marker.sideOffsetMeters) < RACE_CONFIG.markerMinSideOffsetMeters) {
    issues.push({
      code: 'marker-too-close-to-road',
      message: `Marker of ${event.id} is ${Math.abs(event.marker.sideOffsetMeters)} m from the road centre. It must be at least ${RACE_CONFIG.markerMinSideOffsetMeters} m, outside the drivable boundary.`,
      ids: [event.id, markerLane.id],
    });
    return fail();
  }
  const markerPose = laneSample(markerLane, event.marker.s);
  const markerRight = rightFromYaw(markerPose.heading);

  return {
    valid: true,
    issues: [],
    route: {
      eventId: event.id,
      cyclic,
      ...(first.periodMeters !== undefined ? { periodMeters: first.periodMeters } : {}),
      laneIds,
      nextLaneId,
      totalMeters: total,
      originMeters,
      polyline,
      gates,
      laps: event.laps,
      grid: { laneId: first.id, s: event.start.s, x: startPose.x, z: startPose.z, yawRadians: startPose.heading },
      marker: {
        // sideOffsetMeters is from the road centre. The lane pose already sits at the lane offset, so take that out.
        x: markerPose.x + markerRight.x * (event.marker.sideOffsetMeters - markerLane.offsetMeters),
        z: markerPose.z + markerRight.z * (event.marker.sideOffsetMeters - markerLane.offsetMeters),
        yawRadians: markerPose.heading,
      },
    },
  };
}

/** One line per issue, for development diagnostics. */
export function formatRouteIssues(result: RouteResult): string[] {
  return result.issues.map((issue) => `[${issue.code}] ${issue.message}`);
}
