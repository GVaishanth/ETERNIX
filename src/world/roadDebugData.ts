import type { Vec3 } from '../core/types';
import { NETWORK_BOUNDARY_HALF_WIDTH_METERS, NETWORK_LANE_COUNT, ROAD_NETWORK_CONFIG } from '../config/roadConfig';
import { offsetPoint, sampleAtDistance } from './roadGeometry';
import type { RoadNetwork, RoadSegment } from './roadTypes';
import { validateRoadNetwork } from './roadValidation';

/*
 * Debug geometry for the road network (DEV only). Pure: it reads the network and produces line segments and labels.
 * It never changes the road, the boundary, or the vehicle. The overlay in the render layer draws the result.
 *
 * Line kinds, one colour each:
 *   centerline     segment centrelines
 *   lane           lane centre lines (each lane, both directions)
 *   boundary       collision boundary, the outer shoulder edge (guardrail line)
 *   junction       junction pad outlines
 *   segmentCut     ticks at every segment start and end, across the full boundary width
 *   heading        short forward ticks at every segment start (travel direction)
 *   portConnected  connected port markers (green)
 *   portTerminal   terminal port markers (blue)
 *   portOutward    outward direction of every port
 *   connection     a line between the two ports of each connection
 *   issue          validation issues: red lines between the involved ports, or on dangling ports
 */

export type DebugLineKind =
  | 'centerline'
  | 'lane'
  | 'boundary'
  | 'junction'
  | 'segmentCut'
  | 'heading'
  | 'portConnected'
  | 'portTerminal'
  | 'portOutward'
  | 'connection'
  | 'issue';

export interface DebugLineBuffer {
  kind: DebugLineKind;
  /** Pairs of XYZ vertices: each consecutive pair of points is one segment. */
  positions: Float32Array;
  pointCount: number;
}

export interface DebugLabel {
  text: string;
  position: Vec3;
}

export interface RoadDebugData {
  lines: DebugLineBuffer[];
  labels: DebugLabel[];
  issueCount: number;
}

const LIFT_Y = 0.08;
const OUTWARD_LENGTH_METERS = 6;
const HEADING_LENGTH_METERS = 8;
const PORT_MARK_HEIGHT_METERS = 2.5;
const PORT_MARK_HALF_METERS = 0.6;

class LineCollector {
  private readonly buckets = new Map<DebugLineKind, number[]>();

  add(kind: DebugLineKind, a: Vec3, b: Vec3): void {
    let bucket = this.buckets.get(kind);
    if (!bucket) {
      bucket = [];
      this.buckets.set(kind, bucket);
    }
    bucket.push(a.x, a.y + LIFT_Y, a.z, b.x, b.y + LIFT_Y, b.z);
  }

  polyline(kind: DebugLineKind, points: Vec3[]): void {
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a && b) this.add(kind, a, b);
    }
  }

  build(): DebugLineBuffer[] {
    const order: DebugLineKind[] = [
      'centerline',
      'lane',
      'boundary',
      'junction',
      'segmentCut',
      'heading',
      'portConnected',
      'portTerminal',
      'portOutward',
      'connection',
      'issue',
    ];
    const out: DebugLineBuffer[] = [];
    for (const kind of order) {
      const values = this.buckets.get(kind);
      if (!values || values.length === 0) continue;
      out.push({ kind, positions: new Float32Array(values), pointCount: values.length / 3 });
    }
    return out;
  }
}

function polylineOffset(segment: RoadSegment, offset: number): Vec3[] {
  const line = segment.centerline;
  if (!line) return [];
  return line.points.map((p, i) => {
    const q = offsetPoint(p, line.headings[i] ?? 0, offset);
    return { x: q.x, y: 0, z: q.z };
  });
}

function portMark(collector: LineCollector, kind: DebugLineKind, position: Vec3): void {
  const top = { x: position.x, y: PORT_MARK_HEIGHT_METERS, z: position.z };
  collector.add(kind, position, top);
  collector.add(kind, { x: position.x - PORT_MARK_HALF_METERS, y: 0, z: position.z }, { x: position.x + PORT_MARK_HALF_METERS, y: 0, z: position.z });
  collector.add(kind, { x: position.x, y: 0, z: position.z - PORT_MARK_HALF_METERS }, { x: position.x, y: 0, z: position.z + PORT_MARK_HALF_METERS });
}

export function buildRoadDebugData(network: RoadNetwork): RoadDebugData {
  const collector = new LineCollector();
  const labels: DebugLabel[] = [];
  const report = validateRoadNetwork(network);

  for (const segment of network.segments) {
    // Labels sit at the middle of the centreline, or at the centre of a junction.
    if (segment.centerline) {
      const mid = sampleAtDistance(segment.centerline, segment.lengthMeters / 2).point;
      labels.push({ text: segment.id, position: { x: mid.x, y: 4, z: mid.z } });
      collector.polyline('centerline', segment.centerline.points.map((p) => ({ x: p.x, y: 0, z: p.z })));

      // Lane centres: ±1 and ±3 lane widths from the centre.
      const laneOffsets: number[] = [];
      for (let lane = 1; lane <= NETWORK_LANE_COUNT / 2; lane += 1) {
        laneOffsets.push((lane - 0.5) * ROAD_NETWORK_CONFIG.laneWidthMeters, -(lane - 0.5) * ROAD_NETWORK_CONFIG.laneWidthMeters);
      }
      for (const offset of laneOffsets) collector.polyline('lane', polylineOffset(segment, offset));

      // Collision boundary: both outer edges.
      collector.polyline('boundary', polylineOffset(segment, NETWORK_BOUNDARY_HALF_WIDTH_METERS));
      collector.polyline('boundary', polylineOffset(segment, -NETWORK_BOUNDARY_HALF_WIDTH_METERS));
    }

    if (segment.junction) {
      const c = segment.junction.centre;
      const h = segment.junction.halfSizeMeters;
      labels.push({ text: segment.id, position: { x: c.x, y: 4, z: c.z } });
      const corners: Vec3[] = [
        { x: c.x - h, y: 0, z: c.z - h },
        { x: c.x + h, y: 0, z: c.z - h },
        { x: c.x + h, y: 0, z: c.z + h },
        { x: c.x - h, y: 0, z: c.z + h },
        { x: c.x - h, y: 0, z: c.z - h },
      ];
      collector.polyline('junction', corners);
    }

    // Segment cuts and headings at each end of a segment, across the full boundary width.
    for (const port of segment.ports) {
      const forward = Math.atan2(port.outward.x, port.outward.z) + Math.PI;
      const sideways = { x: Math.cos(forward), y: 0, z: -Math.sin(forward) };
      const half = NETWORK_BOUNDARY_HALF_WIDTH_METERS;
      const p = port.position;
      collector.add(
        'segmentCut',
        { x: p.x + sideways.x * half, y: 0, z: p.z + sideways.z * half },
        { x: p.x - sideways.x * half, y: 0, z: p.z - sideways.z * half },
      );
    }
    if (segment.centerline) {
      const start = segment.centerline.points[0];
      const heading = segment.centerline.headings[0] ?? 0;
      if (start) {
        collector.add('heading', start, {
          x: start.x + Math.sin(heading) * HEADING_LENGTH_METERS,
          y: 0,
          z: start.z + Math.cos(heading) * HEADING_LENGTH_METERS,
        });
      }
    }

    // Ports: connected and terminal markers, and outward direction.
    const connectedKeys = new Set<string>();
    for (const connection of network.connections) {
      connectedKeys.add(`${connection.a.segmentId}:${connection.a.portId}`);
      connectedKeys.add(`${connection.b.segmentId}:${connection.b.portId}`);
    }
    for (const port of segment.ports) {
      const key = `${segment.id}:${port.id}`;
      const kind: DebugLineKind = port.terminal ? 'portTerminal' : connectedKeys.has(key) ? 'portConnected' : 'issue';
      portMark(collector, kind, port.position);
      collector.add('portOutward', port.position, {
        x: port.position.x + port.outward.x * OUTWARD_LENGTH_METERS,
        y: 0,
        z: port.position.z + port.outward.z * OUTWARD_LENGTH_METERS,
      });
    }
  }

  // Connections: a line between the two ports. Mismatched connections are drawn in red by the issue pass below.
  const portOf = (segmentId: string, portId: string): Vec3 | null => {
    const segment = network.segments.find((candidate) => candidate.id === segmentId);
    return segment?.ports.find((port) => port.id === portId)?.position ?? null;
  };
  for (const connection of network.connections) {
    const a = portOf(connection.a.segmentId, connection.a.portId);
    const b = portOf(connection.b.segmentId, connection.b.portId);
    if (a && b) collector.add('connection', a, b);
  }

  // Validation issues: a red line between the ports of a broken connection, and a red mark on a dangling port.
  for (const issue of report.issues) {
    if (issue.connectionId) {
      const connection = network.connections.find((candidate) => candidate.id === issue.connectionId);
      if (connection) {
        const a = portOf(connection.a.segmentId, connection.a.portId);
        const b = portOf(connection.b.segmentId, connection.b.portId);
        if (a && b) collector.add('issue', a, b);
      }
    }
  }
  for (const key of report.danglingPorts) {
    const [segmentId = '', portId = ''] = key.split(':');
    const p = portOf(segmentId, portId);
    if (p) portMark(collector, 'issue', p);
  }

  return { lines: collector.build(), labels, issueCount: report.issues.length };
}
