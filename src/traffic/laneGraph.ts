import { rightFromYaw } from '../core/coordinates';
import type { Vec3 } from '../core/types';
import { shortestAngleDelta, wrapAngle } from '../core/math';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { wrapDelta } from '../world/wrap/worldWrap';
import type { RoadNetwork, RoadPort, RoadSegment } from '../world/roadTypes';

/*
 * Directed lane graph for traffic (Part 4). Pure: built once from the road network, never changed at runtime.
 *
 * A lane is a polyline with arc-length samples, in simulation space. Lanes come from the road centerlines:
 *   - Segment lanes run along a straight or arc segment, forward (along the centerline) or reverse (against it).
 *   - Connector lanes cross a junction straight through, from one port to the opposite port.
 *
 * Lane offset rule (right-hand traffic). A lane's position is the centerline point plus the RIGHT normal of its own
 * travel heading times the lane offset. So a reverse lane sits on the opposite side of the centerline, and the offset
 * stays exact on curves. Offsets are (laneIndex + 0.5) * laneWidth, which gives 1.8 m and 5.4 m on the 3.6 m lanes.
 *
 * Routing. Spur roads are dead ends and are excluded. Junction connectors are straight-through only, so each lane has
 * one or more successors. A junction offers every turn; `successorOf` picks one deterministically.
 */

export type LaneDirection = 'F' | 'R' | 'C';

export interface LanePath {
  id: string;
  kind: 'segment' | 'connector';
  /** Segment id for segment lanes, junction id for connectors. */
  ownerId: string;
  /** 'F' forward, 'R' reverse, 'C' connector. */
  direction: LaneDirection;
  laneIndex: number;
  offsetMeters: number;
  points: Vec3[];
  /** Travel heading at each sample, radians. */
  headings: number[];
  /** Arc length at each sample, meters. Strictly increasing, starting at 0. */
  s: number[];
  lengthMeters: number;
  speedLimitMps: number;
  /** Port the lane enters through, as `${ownerId}:${portId}`. */
  entryKey: string;
  /** Port the lane leaves through, as `${ownerId}:${portId}`. */
  exitKey: string;
  /** Candidate successor ids, sorted. Use successorOf(lane) to pick the one a vehicle takes. */
  successorIds: string[];
  /**
   * Lane-change neighbours: the same road and direction on the other lane index, sorted. Only segment lanes have them.
   * Traffic never follows these (it follows successorIds only). Races and police may change lane to one of them, at
   * any point of the lane, because both lanes are sampled from the same centreline. See isLaneChange.
   */
  lateralIds: string[];
  /**
   * Period of a looping network. Set on every lane of a looping graph and absent for a finite one. Lane geometry stays in
   * its base domain. Queries are mapped to the image nearest the lane (see nearestOnLane).
   */
  periodMeters?: number;
}

export interface LaneGraph {
  lanes: LanePath[];
  byId: Map<string, LanePath>;
}

export interface LanePose {
  x: number;
  /** Height of the lane centreline at this point, metres. Interpolated between the samples. */
  y: number;
  z: number;
  heading: number;
}

/**
 * The id of the same lane on another lane index. Segment and connector ids both end in `:<laneIndex>`, and every road has
 * the same lanes per index, so the twin of a lane is its id with that suffix changed. Lanes never change index in the
 * graph, so a car uses its own index all the way. Use this to place a car on a neighbouring lane of the same road.
 */
export function twinLaneId(laneId: string, laneIndex: number): string {
  return laneId.replace(/:\d+$/, `:${laneIndex}`);
}

/** Turns a lane's centerline samples into lane samples, offset to the right of travel. */
function offsetSamples(points: Vec3[], headings: number[], offset: number): Vec3[] {
  return points.map((point, index) => {
    const right = rightFromYaw(headings[index] ?? 0);
    return { x: point.x + right.x * offset, y: point.y, z: point.z + right.z * offset };
  });
}

/** Cumulative horizontal arc length of a polyline. The first sample is 0. */
function cumulativeLength(points: Vec3[]): number[] {
  const s = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    s.push((s[i - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0));
  }
  return s;
}

function buildSegmentLanes(segment: RoadSegment): LanePath[] {
  const centerline = segment.centerline;
  if (!centerline || centerline.points.length < 2) return [];
  const lanesPerDirection = Math.floor(segment.laneCount / 2);
  const lanes: LanePath[] = [];

  for (const direction of ['F', 'R'] as const) {
    for (let laneIndex = 0; laneIndex < lanesPerDirection; laneIndex += 1) {
      const offset = (laneIndex + TRAFFIC_CONFIG.laneCentreFraction) * segment.laneWidthMeters;
      const forward = direction === 'F';
      const centrePoints = forward ? centerline.points : [...centerline.points].reverse();
      const travelHeadings = forward
        ? centerline.headings.slice()
        : [...centerline.headings].reverse().map((heading) => wrapAngle(heading + Math.PI));
      const points = offsetSamples(centrePoints, travelHeadings, offset);
      // Arc length is measured on the offset samples. Offset lanes are longer on turns, so the centerline's s is not reused.
      const s = cumulativeLength(points);
      lanes.push({
        id: `${segment.id}:${direction}:${laneIndex}`,
        kind: 'segment',
        ownerId: segment.id,
        direction,
        laneIndex,
        offsetMeters: offset,
        points,
        headings: travelHeadings,
        s,
        lengthMeters: s[s.length - 1] ?? 0,
        speedLimitMps: segment.speedLimitMps,
        entryKey: `${segment.id}:${forward ? 'start' : 'end'}`,
        exitKey: `${segment.id}:${forward ? 'end' : 'start'}`,
        successorIds: [],
        lateralIds: [],
      });
    }
  }
  return lanes;
}

/** Straight pairs keep the original geometry: a line between the two offset port positions. */
function straightConnector(
  junction: RoadSegment,
  entry: RoadPort,
  exit: RoadPort,
  laneIndex: number,
  entryHeading: number,
): { points: Vec3[]; headings: number[]; s: number[]; length: number; offset: number } {
  const offset = (laneIndex + TRAFFIC_CONFIG.laneCentreFraction) * junction.laneWidthMeters;
  const right = rightFromYaw(entryHeading);
  // Heights follow the ports the connector joins. A straight connector is a line, so its height is linear between them.
  const start: Vec3 = { x: entry.position.x + right.x * offset, y: entry.position.y, z: entry.position.z + right.z * offset };
  const end: Vec3 = { x: exit.position.x + right.x * offset, y: exit.position.y, z: exit.position.z + right.z * offset };
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const count = Math.max(2, Math.ceil(length / TRAFFIC_CONFIG.connectorSampleSpacingMeters) + 1);
  const points: Vec3[] = [];
  const headings: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    points.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, z: start.z + (end.z - start.z) * t });
    headings.push(entryHeading);
    s.push(length * t);
  }
  return { points, headings, s, length, offset };
}

/**
 * Turn connectors are quadratic Bezier curves. The start and end sit on the lane offsets of the entry and exit ports,
 * and the control point is where the entry and exit lines meet. A turn needs both lines to meet ahead of the entry
 * and before the exit, which holds for every 90 degree turn on the grid. Returns null when the lines are parallel.
 */
function turnConnector(
  junction: RoadSegment,
  entry: RoadPort,
  exit: RoadPort,
  laneIndex: number,
  entryHeading: number,
  exitHeading: number,
): { points: Vec3[]; headings: number[]; s: number[]; length: number; offset: number } | null {
  const offset = (laneIndex + TRAFFIC_CONFIG.laneCentreFraction) * junction.laneWidthMeters;
  const rightIn = rightFromYaw(entryHeading);
  const rightOut = rightFromYaw(exitHeading);
  const p0 = { x: entry.position.x + rightIn.x * offset, y: entry.position.y, z: entry.position.z + rightIn.z * offset };
  const p2 = { x: exit.position.x + rightOut.x * offset, y: exit.position.y, z: exit.position.z + rightOut.z * offset };
  const dirIn = { x: Math.sin(entryHeading), z: Math.cos(entryHeading) };
  const dirOut = { x: Math.sin(exitHeading), z: Math.cos(exitHeading) };
  const det = dirIn.x * dirOut.z - dirOut.x * dirIn.z;
  if (Math.abs(det) < 1e-6) return null;
  const dx = p2.x - p0.x;
  const dz = p2.z - p0.z;
  const a = (dx * dirOut.z - dirOut.x * dz) / det;
  const p1 = { x: p0.x + dirIn.x * a, z: p0.z + dirIn.z * a };
  // The control point's height is the midpoint of the two ends, so the curve rises or falls evenly between them.
  const midY = (p0.y + p2.y) / 2;
  const approx = Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z);
  const count = Math.max(8, Math.ceil(approx / TRAFFIC_CONFIG.connectorSampleSpacingMeters) + 1);
  const points: Vec3[] = [];
  const headings: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const u = 1 - t;
    points.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * midY + t * t * p2.y,
      z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
    });
    // Tangent of the quadratic: 2(1-t)(P1-P0) + 2t(P2-P1).
    const tx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
    const tz = 2 * u * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
    headings.push(Math.atan2(tx, tz));
  }
  const s = [0];
  for (let i = 1; i < points.length; i += 1) {
    const pa = points[i - 1];
    const pb = points[i];
    s.push((s[i - 1] ?? 0) + (pa && pb ? Math.hypot(pb.x - pa.x, pb.z - pa.z) : 0));
  }
  return { points, headings, s, length: s[s.length - 1] ?? 0, offset };
}

/**
 * Connector lanes across a junction, for every entry-to-exit pair between roads (spurs excluded). Straight pairs keep
 * their original ids and geometry. U-turns are not built. Deterministic: pairs are visited in a fixed order.
 */
function buildJunctionLanes(junction: RoadSegment, network: RoadNetwork, partnerOf: Map<string, string>): LanePath[] {
  const footprint = junction.junction;
  if (!footprint) return [];
  const lanesPerDirection = Math.floor(junction.laneCount / 2);
  const lanes: LanePath[] = [];
  const isRoadPort = (portId: string): boolean => {
    const partner = partnerOf.get(`${junction.id}:${portId}`);
    if (!partner) return false;
    const ownerId = partner.split(':')[0] ?? '';
    const owner = network.segments.find((segment) => segment.id === ownerId);
    return owner !== undefined && owner.roadType !== 'spur';
  };
  const portOrder = ['north', 'east', 'south', 'west'];
  for (const entryPort of portOrder) {
    for (const exitPort of portOrder) {
      if (entryPort === exitPort) continue;
      if (!isRoadPort(entryPort) || !isRoadPort(exitPort)) continue;
      const entry = junction.ports.find((port) => port.id === entryPort);
      const exit = junction.ports.find((port) => port.id === exitPort);
      if (!entry || !exit) continue;
      // Travel heading at the entry is the inward direction; at the exit it is the outward direction.
      const entryHeading = Math.atan2(-entry.outward.x, -entry.outward.z);
      const exitHeading = Math.atan2(exit.outward.x, exit.outward.z);
      const straight = Math.abs(shortestAngleDelta(entryHeading, exitHeading)) < 1e-6;
      for (let laneIndex = 0; laneIndex < lanesPerDirection; laneIndex += 1) {
        const geometry = straight
          ? straightConnector(junction, entry, exit, laneIndex, entryHeading)
          : turnConnector(junction, entry, exit, laneIndex, entryHeading, exitHeading);
        if (!geometry) continue;
        lanes.push({
          id: `${junction.id}:${entryPort}>${exitPort}:${laneIndex}`,
          kind: 'connector',
          ownerId: junction.id,
          direction: 'C',
          laneIndex,
          offsetMeters: geometry.offset,
          points: geometry.points,
          headings: geometry.headings,
          s: geometry.s,
          lengthMeters: geometry.length,
          speedLimitMps: junction.speedLimitMps,
          entryKey: `${junction.id}:${entryPort}`,
          exitKey: `${junction.id}:${exitPort}`,
          successorIds: [],
          lateralIds: [],
        });
      }
    }
  }
  return lanes;
}

/**
 * The one successor rule used by traffic, the AI, and the lane-chain look-ahead. When a lane has several successors
 * (a junction offers straight, left, and right), the choice depends only on the lane id, so every vehicle and every
 * look-ahead agrees on the route through the junction. FNV-1a hash over the id, then modulo the sorted list.
 */
export function successorOf(lane: LanePath): string | undefined {
  const list = lane.successorIds;
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  let hash = 0x811c9dc5;
  for (let i = 0; i < lane.id.length; i += 1) {
    hash ^= lane.id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return list[hash % list.length];
}

/** Builds the directed lane graph for all circuit roads. Spurs are excluded. Deterministic. */
export function buildLaneGraph(network: RoadNetwork): LaneGraph {
  // Port partner lookup, in both directions: `${segment}:${port}` -> `${segment}:${port}`.
  const partnerOf = new Map<string, string>();
  for (const connection of network.connections) {
    const a = `${connection.a.segmentId}:${connection.a.portId}`;
    const b = `${connection.b.segmentId}:${connection.b.portId}`;
    partnerOf.set(a, b);
    partnerOf.set(b, a);
  }

  // Circuit roads and junctions. Spurs are dead ends and are excluded from routing.
  const included = network.segments.filter((segment) => segment.roadType !== 'spur');
  const lanes: LanePath[] = [];
  for (const segment of included) {
    if (segment.kind === 'junction') {
      lanes.push(...buildJunctionLanes(segment, network, partnerOf));
    } else {
      lanes.push(...buildSegmentLanes(segment));
    }
  }

  const byId = new Map<string, LanePath>();
  for (const lane of lanes) {
    if (byId.has(lane.id)) throw new Error(`Duplicate lane id: ${lane.id}`);
    byId.set(lane.id, lane);
  }

  // Successors: the lane that enters at the partner of this lane's exit port, on the same lane index.
  const entriesByKey = new Map<string, LanePath[]>();
  for (const lane of lanes) {
    const list = entriesByKey.get(lane.entryKey) ?? [];
    list.push(lane);
    entriesByKey.set(lane.entryKey, list);
  }
  for (const lane of lanes) {
    const partner = partnerOf.get(lane.exitKey);
    if (!partner) continue;
    lane.successorIds = (entriesByKey.get(partner) ?? [])
      .filter((candidate) => candidate.laneIndex === lane.laneIndex)
      .map((candidate) => candidate.id)
      .sort();
  }

  // Lane-change neighbours: the other lane index of the same road and direction. Junction connectors never change lane.
  const segmentLanesByRoad = new Map<string, LanePath[]>();
  for (const lane of lanes) {
    if (lane.kind !== 'segment') continue;
    const key = `${lane.ownerId}:${lane.direction}`;
    const list = segmentLanesByRoad.get(key) ?? [];
    list.push(lane);
    segmentLanesByRoad.set(key, list);
  }
  for (const group of segmentLanesByRoad.values()) {
    for (const lane of group) {
      lane.lateralIds = group
        .filter((other) => other.laneIndex !== lane.laneIndex)
        .map((other) => other.id)
        .sort();
    }
  }

  if (network.periodMeters !== undefined) {
    for (const lane of lanes) lane.periodMeters = network.periodMeters;
  }
  return { lanes, byId };
}

/**
 * True when `to` is a lane-change neighbour of `from`: a segment lane on the same road and direction, on the other lane
 * index. A car may move between them at any point, keeping its place along the road.
 */
export function isLaneChange(from: LanePath, to: LanePath): boolean {
  return from.kind === 'segment' && to.kind === 'segment' && from.ownerId === to.ownerId && from.direction === to.direction && from.laneIndex !== to.laneIndex;
}

/** Pose at arc length `s` along a lane, clamped to the lane. Position is interpolated; heading uses the shortest turn. */
export function laneSample(lane: LanePath, s: number): LanePose {
  const clamped = Math.min(Math.max(s, 0), lane.lengthMeters);
  // Binary search for the sample interval containing `clamped`.
  let low = 0;
  let high = lane.s.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((lane.s[mid] ?? 0) <= clamped) low = mid;
    else high = mid;
  }
  const s0 = lane.s[low] ?? 0;
  const s1 = lane.s[high] ?? s0;
  const t = s1 > s0 ? (clamped - s0) / (s1 - s0) : 0;
  const p0 = lane.points[low];
  const p1 = lane.points[high] ?? p0;
  const h0 = lane.headings[low] ?? 0;
  const h1 = lane.headings[high] ?? h0;
  if (!p0 || !p1) throw new Error(`Lane ${lane.id} has no samples`);
  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
    heading: wrapAngle(h0 + shortestAngleDelta(h0, h1) * t),
  };
}

/** Hop limit for chain walks. Bounded by the distance limit as well, so a closed loop cannot run forever. */
const MAX_CHAIN_HOPS = 24;

/**
 * Distance along the forward lane chain from (fromLaneId, fromS) to (toLaneId, toS), in meters. Walks successor lanes
 * only, so it never crosses to a parallel lane. Returns null when the target is not reached within maxMeters.
 * Pure, and shared by the leader search and the spawn gap checks.
 */
export function chainDistance(
  graph: LaneGraph,
  fromLaneId: string,
  fromS: number,
  toLaneId: string,
  toS: number,
  maxMeters: number,
): number | null {
  let lane: LanePath | undefined = graph.byId.get(fromLaneId);
  let s = fromS;
  let travelled = 0;
  for (let hop = 0; lane && hop <= MAX_CHAIN_HOPS; hop += 1) {
    if (lane.id === toLaneId && toS >= s) return travelled + (toS - s);
    travelled += lane.lengthMeters - s;
    if (travelled > maxMeters) return null;
    s = 0;
    const next: string | undefined = successorOf(lane);
    lane = next !== undefined ? graph.byId.get(next) : undefined;
  }
  return null;
}

/**
 * Nearest sample of a lane to a ground point. Returns the arc length of that sample, the distance to it (a
 * lateral measure when the point is near the lane), and the lane heading there. Null for an empty lane.
 */
export function nearestOnLane(lane: LanePath, x: number, z: number): { s: number; distance: number; heading: number } | null {
  let bestIndex = -1;
  let bestSquared = Number.POSITIVE_INFINITY;
  // On a loop the query point is mapped to the image nearest the lane start. Lanes are far shorter than half a period, so
  // this is the image nearest the lane. Finite worlds use the point as given.
  const origin = lane.points[0];
  const period = lane.periodMeters;
  const qx = origin && period !== undefined ? origin.x + wrapDelta(origin.x, x, period) : x;
  const qz = origin && period !== undefined ? origin.z + wrapDelta(origin.z, z, period) : z;
  for (let i = 0; i < lane.points.length; i += 1) {
    const p = lane.points[i];
    if (!p) continue;
    const dx = p.x - qx;
    const dz = p.z - qz;
    const squared = dx * dx + dz * dz;
    if (squared < bestSquared) {
      bestSquared = squared;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;
  return {
    s: lane.s[bestIndex] ?? 0,
    distance: Math.sqrt(bestSquared),
    heading: lane.headings[bestIndex] ?? 0,
  };
}
