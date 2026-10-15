import type { RoadNetwork, RoadSegment } from './roadTypes';

/*
 * Programmatic connection validation. Nothing is snapped: every mismatch is reported with the segment ids involved,
 * and the caller decides what to do. Tolerances match the contract in roadTypes.ts.
 */

export const CONNECTION_POSITION_TOLERANCE_M = 0.01;
export const CONNECTION_DIRECTION_DOT_MAX = -0.999;
export const CONNECTION_ELEVATION_TOLERANCE_M = 0.001;
export const CONNECTION_WIDTH_TOLERANCE_M = 0.01;
/** A centerline endpoint must match its port within this distance. */
export const PORT_CENTERLINE_TOLERANCE_M = 0.01;
/** Largest heading change between consecutive centerline samples, radians. */
export const MAX_SAMPLE_HEADING_STEP_RAD = 0.2;

export interface RoadValidationIssue {
  severity: 'error' | 'warning';
  /** Segment ids involved, so the caller can name them in a debug view or a test failure. */
  segmentIds: string[];
  connectionId: string | null;
  message: string;
}

export interface RoadValidationReport {
  valid: boolean;
  issues: RoadValidationIssue[];
  connectionCount: number;
  terminalPortCount: number;
  /** Ports that are neither connected nor terminal, as "segment:port" labels. */
  danglingPorts: string[];
}

function distance3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dot2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return a.x * b.x + a.z * b.z;
}

function checkSegmentInternal(segment: RoadSegment, issues: RoadValidationIssue[]): void {
  const ids = new Set<string>();
  for (const port of segment.ports) {
    if (ids.has(port.id)) {
      issues.push({ severity: 'error', segmentIds: [segment.id], connectionId: null, message: `duplicate port id ${port.id}` });
    }
    ids.add(port.id);
    const outwardLength = Math.hypot(port.outward.x, port.outward.z);
    if (Math.abs(outwardLength - 1) > 1e-6 || Math.abs(port.outward.y) > 1e-9) {
      issues.push({
        severity: 'error',
        segmentIds: [segment.id],
        connectionId: null,
        message: `port ${port.id} outward must be a horizontal unit vector`,
      });
    }
    if (port.elevationMeters !== 0 || port.position.y !== port.elevationMeters) {
      issues.push({
        severity: 'error',
        segmentIds: [segment.id],
        connectionId: null,
        message: `port ${port.id} elevation must match its position y (flat network)`,
      });
    }
  }

  const centerline = segment.centerline;
  if (centerline) {
    const first = centerline.points[0];
    const last = centerline.points[centerline.points.length - 1];
    const startPort = segment.ports.find((port) => port.id === 'start');
    const endPort = segment.ports.find((port) => port.id === 'end');
    if (startPort && first && distance3(startPort.position, first) > PORT_CENTERLINE_TOLERANCE_M) {
      issues.push({ severity: 'error', segmentIds: [segment.id], connectionId: null, message: 'start port does not match centerline start' });
    }
    if (endPort && last && distance3(endPort.position, last) > PORT_CENTERLINE_TOLERANCE_M) {
      issues.push({ severity: 'error', segmentIds: [segment.id], connectionId: null, message: 'end port does not match centerline end' });
    }
    for (let i = 1; i < centerline.s.length; i += 1) {
      const ds = (centerline.s[i] ?? 0) - (centerline.s[i - 1] ?? 0);
      if (!(ds > 0)) {
        issues.push({ severity: 'error', segmentIds: [segment.id], connectionId: null, message: 'centerline arc length is not strictly increasing' });
        break;
      }
      const dh = Math.abs((centerline.headings[i] ?? 0) - (centerline.headings[i - 1] ?? 0));
      if (dh > MAX_SAMPLE_HEADING_STEP_RAD) {
        issues.push({ severity: 'error', segmentIds: [segment.id], connectionId: null, message: `centerline heading jumps ${dh.toFixed(3)} rad between samples` });
        break;
      }
    }
  }
}

/** Validates the whole network. Pure, deterministic, returns every issue instead of stopping at the first. */
export function validateRoadNetwork(network: RoadNetwork): RoadValidationReport {
  const issues: RoadValidationIssue[] = [];
  const segmentIds = new Set<string>();
  const segmentById = new Map<string, RoadSegment>();

  for (const segment of network.segments) {
    if (segmentIds.has(segment.id)) {
      issues.push({ severity: 'error', segmentIds: [segment.id], connectionId: null, message: 'duplicate segment id' });
    }
    segmentIds.add(segment.id);
    segmentById.set(segment.id, segment);
    checkSegmentInternal(segment, issues);
  }

  const usage = new Map<string, string>();
  const connectionIds = new Set<string>();
  let connectionCount = 0;

  for (const connection of network.connections) {
    if (connectionIds.has(connection.id)) {
      issues.push({ severity: 'error', segmentIds: [], connectionId: connection.id, message: 'duplicate connection id' });
    }
    connectionIds.add(connection.id);
    connectionCount += 1;

    const ends = [connection.a, connection.b];
    const resolved = ends.map((end) => {
      const segment = segmentById.get(end.segmentId);
      const port = segment?.ports.find((candidate) => candidate.id === end.portId);
      return { segment, port };
    });
    const involved = ends.map((end) => end.segmentId);

    let unknown = false;
    resolved.forEach((entry, index) => {
      const end = ends[index];
      if (!end) return;
      if (!entry.segment) {
        issues.push({ severity: 'error', segmentIds: involved, connectionId: connection.id, message: `unknown segment ${end.segmentId}` });
        unknown = true;
      } else if (!entry.port) {
        issues.push({ severity: 'error', segmentIds: involved, connectionId: connection.id, message: `segment ${end.segmentId} has no port ${end.portId}` });
        unknown = true;
      } else {
        const key = `${end.segmentId}:${end.portId}`;
        const previous = usage.get(key);
        if (previous !== undefined) {
          issues.push({ severity: 'error', segmentIds: involved, connectionId: connection.id, message: `port ${key} is used by more than one connection (${previous})` });
        }
        usage.set(key, connection.id);
        if (entry.port.terminal) {
          issues.push({ severity: 'error', segmentIds: involved, connectionId: connection.id, message: `terminal port ${key} must not be connected` });
        }
      }
    });
    if (unknown) continue;

    const [pa, pb] = resolved.map((entry) => entry.port);
    if (!pa || !pb) continue;

    const gap = distance3(pa.position, pb.position);
    if (gap > CONNECTION_POSITION_TOLERANCE_M) {
      issues.push({ severity: 'error', segmentIds: involved, connectionId: connection.id, message: `ports are ${gap.toFixed(3)} m apart (limit ${CONNECTION_POSITION_TOLERANCE_M} m)` });
    }
    const d = dot2(pa.outward, pb.outward);
    if (d > CONNECTION_DIRECTION_DOT_MAX) {
      issues.push({ severity: 'error', segmentIds: involved, connectionId: connection.id, message: `outward directions are not opposite (dot ${d.toFixed(4)})` });
    }
    const elevationGap = Math.abs(pa.elevationMeters - pb.elevationMeters);
    if (elevationGap > CONNECTION_ELEVATION_TOLERANCE_M) {
      issues.push({ severity: 'error', segmentIds: involved, connectionId: connection.id, message: `elevation differs by ${elevationGap.toFixed(3)} m` });
    }
    const widthGap = Math.abs(pa.widthMeters - pb.widthMeters);
    if (widthGap > CONNECTION_WIDTH_TOLERANCE_M) {
      issues.push({ severity: 'error', segmentIds: involved, connectionId: connection.id, message: `widths differ by ${widthGap.toFixed(3)} m` });
    }
  }

  const danglingPorts: string[] = [];
  let terminalPortCount = 0;
  for (const segment of network.segments) {
    for (const port of segment.ports) {
      const key = `${segment.id}:${port.id}`;
      if (port.terminal) {
        terminalPortCount += 1;
        continue;
      }
      if (!usage.has(key)) danglingPorts.push(key);
    }
  }
  for (const key of danglingPorts) {
    const [segmentId = '', portId = ''] = key.split(':');
    issues.push({
      severity: 'error',
      segmentIds: [segmentId],
      connectionId: null,
      message: `port ${portId} is open but not marked terminal`,
    });
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
    connectionCount,
    terminalPortCount,
    danglingPorts,
  };
}
