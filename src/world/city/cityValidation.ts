import { buildLaneGraph, type LanePath } from '../../traffic/laneGraph';
import { buildRoadBoundary } from '../../simulation/roadBoundary';
import { NETWORK_PROFILE } from '../roadBuilders';
import type { RoadNetwork, RoadSegment } from '../roadTypes';
import { MAX_SAMPLE_HEADING_STEP_RAD } from '../roadValidation';
import { wrapDelta } from '../wrap/worldWrap';

/*
 * City-specific validation (Part 5). Complements validateRoadNetwork (connections and ports) with the rules the city
 * needs. Every issue names the segment ids involved, so nothing is discarded silently. Pure: no Three.js.
 */

export type CityIssueCode =
  | 'duplicate-segment-id'
  | 'zero-length-segment'
  | 'invalid-width'
  | 'missing-surface'
  | 'missing-boundary'
  | 'junction-centre'
  | 'junction-arm-mismatch'
  | 'missing-connector'
  | 'invalid-lane-direction'
  | 'lane-successor-gap'
  | 'lane-heading-jump'
  | 'lane-dead-end'
  | 'sample-heading-jump'
  | 'unreachable-segment';

export interface CityValidationIssue {
  code: CityIssueCode;
  segmentIds: string[];
  message: string;
}

export interface CityValidationReport {
  valid: boolean;
  issues: CityValidationIssue[];
  segmentCount: number;
  laneCount: number;
  /** Lanes that are in the strongly connected class of their lane index. Equal to laneCount when every class is connected. */
  stronglyConnectedLaneCount: number;
}

/** Successor positions must agree within this distance, metres. */
export const LANE_CONTINUITY_TOLERANCE_M = 0.05;
/** Lane heading across a connection must agree within this angle, radians. */
export const LANE_HEADING_TOLERANCE_RAD = 0.05;
/** Straight and arc lengths below this are reported as zero-length, metres. */
export const MIN_SEGMENT_LENGTH_M = 1;

function shortestDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function checkSegment(segment: RoadSegment, issues: CityValidationIssue[], boundaryIds: Set<string>): void {
  const ids = [segment.id];
  if (segment.lengthMeters < MIN_SEGMENT_LENGTH_M) {
    issues.push({ code: 'zero-length-segment', segmentIds: ids, message: `${segment.id} is ${segment.lengthMeters.toFixed(2)} m long` });
  }
  const expectedRoad = NETWORK_PROFILE.laneCount * NETWORK_PROFILE.laneWidthMeters;
  if (!(segment.laneWidthMeters > 0) || !(segment.roadWidthMeters > 0) || Math.abs(segment.roadWidthMeters - segment.laneCount * segment.laneWidthMeters) > 0.01 || Math.abs(segment.roadWidthMeters - expectedRoad) > 0.01) {
    issues.push({ code: 'invalid-width', segmentIds: ids, message: `${segment.id} width ${segment.roadWidthMeters} m does not match ${segment.laneCount} lanes of ${segment.laneWidthMeters} m` });
  }
  if (!segment.surface) {
    issues.push({ code: 'missing-surface', segmentIds: ids, message: `${segment.id} has no surface` });
  }
  if (!boundaryIds.has(segment.id)) {
    issues.push({ code: 'missing-boundary', segmentIds: ids, message: `${segment.id} has no collision boundary shape` });
  }
  if (segment.kind === 'junction' && segment.junction) {
    const centre = segment.junction.centre;
    const half = segment.junction.halfSizeMeters;
    for (const port of segment.ports) {
      const dx = port.position.x - centre.x;
      const dz = port.position.z - centre.z;
      // A junction port sits on an axis through the centre, at the footprint half size.
      const onAxis = Math.abs(dx) < 1e-6 || Math.abs(dz) < 1e-6;
      if (!onAxis || Math.hypot(dx, dz) < 1e-6 || Math.hypot(dx, dz) > half + 1e-6) {
        issues.push({ code: 'junction-centre', segmentIds: ids, message: `${segment.id} port ${port.id} is not on an axis of the junction centre` });
      }
    }
  }
}

function checkLane(lane: LanePath, segmentById: Map<string, RoadSegment>, issues: CityValidationIssue[]): void {
  for (let k = 1; k < lane.headings.length; k += 1) {
    const prev = lane.headings[k - 1] ?? 0;
    const next = lane.headings[k] ?? 0;
    if (Math.abs(shortestDelta(prev, next)) > MAX_SAMPLE_HEADING_STEP_RAD) {
      issues.push({ code: 'sample-heading-jump', segmentIds: [lane.ownerId], message: `${lane.id} heading jumps at sample ${k}` });
      break;
    }
  }
  if (lane.kind === 'segment') {
    const segment = segmentById.get(lane.ownerId);
    if (!segment || segment.kind === 'junction') return;
    const forward = lane.direction === 'F' && lane.entryKey === `${segment.id}:start` && lane.exitKey === `${segment.id}:end`;
    const reverse = lane.direction === 'R' && lane.entryKey === `${segment.id}:end` && lane.exitKey === `${segment.id}:start`;
    if (!forward && !reverse) {
      issues.push({ code: 'invalid-lane-direction', segmentIds: [segment.id], message: `${lane.id} does not run start-to-end (F) or end-to-start (R)` });
    }
  }
}

export function validateCityNetwork(network: RoadNetwork): CityValidationReport {
  const issues: CityValidationIssue[] = [];
  const seen = new Set<string>();
  const segmentById = new Map<string, RoadSegment>();
  for (const segment of network.segments) {
    if (seen.has(segment.id)) {
      issues.push({ code: 'duplicate-segment-id', segmentIds: [segment.id], message: `duplicate segment id ${segment.id}` });
    }
    seen.add(segment.id);
    segmentById.set(segment.id, segment);
  }

  // Duplicate ids make the lane graph ambiguous, so the report stops here instead of building one from bad input.
  if (issues.some((issue) => issue.code === 'duplicate-segment-id')) {
    return { valid: false, issues, segmentCount: network.segments.length, laneCount: 0, stronglyConnectedLaneCount: 0 };
  }

  const boundary = buildRoadBoundary(network);
  const boundaryIds = new Set(boundary.shapes.map((shape) => shape.segmentId));
  for (const segment of network.segments) checkSegment(segment, issues, boundaryIds);

  // Junction arms: each junction's road ports must match the connections that name it.
  for (const segment of network.segments) {
    if (segment.kind !== 'junction') continue;
    const armCount = segment.ports.length;
    const connected = network.connections.filter((c) => c.a.segmentId === segment.id || c.b.segmentId === segment.id).length;
    if (armCount < 2 || connected !== armCount) {
      issues.push({ code: 'junction-arm-mismatch', segmentIds: [segment.id], message: `${segment.id} has ${armCount} arms but ${connected} connections` });
    }
  }

  const graph = buildLaneGraph(network);
  const laneById = graph.byId;
  for (const lane of graph.lanes) checkLane(lane, segmentById, issues);

  // Successor continuity, dead ends, and heading jumps across each connection.
  for (const lane of graph.lanes) {
    const end = lane.points[lane.points.length - 1];
    const endHeading = lane.headings[lane.headings.length - 1] ?? 0;
    if (lane.successorIds.length === 0) {
      // A lane with no successor is only acceptable when it leaves through a terminal port (none exist in the city).
      issues.push({ code: 'lane-dead-end', segmentIds: [lane.ownerId], message: `${lane.id} has no successor` });
      continue;
    }
    for (const successorId of lane.successorIds) {
      const successor = laneById.get(successorId);
      if (!successor || !end) {
        issues.push({ code: 'lane-successor-gap', segmentIds: [lane.ownerId], message: `${lane.id} names unknown successor ${successorId}` });
        continue;
      }
      const start = successor.points[0];
      if (!start) continue;
      const gapX = network.periodMeters !== undefined ? wrapDelta(end.x, start.x, network.periodMeters) : start.x - end.x;
      const gapZ = network.periodMeters !== undefined ? wrapDelta(end.z, start.z, network.periodMeters) : start.z - end.z;
      const laneGap = Math.hypot(gapX, gapZ);
      if (laneGap > LANE_CONTINUITY_TOLERANCE_M) {
        issues.push({ code: 'lane-successor-gap', segmentIds: [lane.ownerId], message: `${lane.id} ends ${laneGap.toFixed(3)} m from ${successorId}` });
      }
      const successorHeading = successor.headings[0] ?? 0;
      if (Math.abs(shortestDelta(endHeading, successorHeading)) > LANE_HEADING_TOLERANCE_RAD) {
        issues.push({ code: 'lane-heading-jump', segmentIds: [lane.ownerId], message: `${lane.id} heading changes abruptly into ${successorId}` });
      }
    }
  }

  // Missing connectors: every junction needs n(n-1) entry/exit pairs times lanesPerDirection connectors.
  for (const segment of network.segments) {
    if (segment.kind !== 'junction') continue;
    const n = segment.ports.length;
    const lanesPerDirection = Math.floor(segment.laneCount / 2);
    const expected = n * (n - 1) * lanesPerDirection;
    const actual = graph.lanes.filter((lane) => lane.kind === 'connector' && lane.ownerId === segment.id).length;
    if (actual !== expected) {
      issues.push({ code: 'missing-connector', segmentIds: [segment.id], message: `${segment.id} has ${actual} connectors, expected ${expected}` });
    }
  }

  // Strong connectivity per lane index. Traffic and AI stay in their lane index through junctions (no lane changes), so
  // the graph splits into one class per index. Each class must be strongly connected: every lane reachable forward and
  // backward from the first lane of its class.
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const lane of graph.lanes) {
    forward.set(lane.id, lane.successorIds);
    for (const successorId of lane.successorIds) {
      const list = backward.get(successorId) ?? [];
      list.push(lane.id);
      backward.set(successorId, list);
    }
  }
  const reach = (start: string, edges: Map<string, string[]>): Set<string> => {
    const visited = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.pop();
      if (id === undefined) break;
      for (const next of edges.get(id) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited;
  };
  const firstByIndex = new Map<number, string>();
  for (const lane of graph.lanes) {
    if (!firstByIndex.has(lane.laneIndex)) firstByIndex.set(lane.laneIndex, lane.id);
  }
  let stronglyConnected = 0;
  for (const [laneIndex, first] of firstByIndex) {
    const fwd = reach(first, forward);
    const bwd = reach(first, backward);
    for (const lane of graph.lanes) {
      if (lane.laneIndex !== laneIndex) continue;
      if (fwd.has(lane.id) && bwd.has(lane.id)) stronglyConnected += 1;
      else issues.push({ code: 'unreachable-segment', segmentIds: [lane.ownerId], message: `${lane.id} is not on a strongly connected route for lane index ${laneIndex}` });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    segmentCount: network.segments.length,
    laneCount: graph.lanes.length,
    stronglyConnectedLaneCount: stronglyConnected,
  };
}
