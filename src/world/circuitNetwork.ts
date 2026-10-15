import type { Vec3 } from '../core/types';
import { buildArc, buildJunction, buildStraight, NETWORK_PROFILE, portPose } from './roadBuilders';
import type { RoadConnection, RoadNetwork, RoadSegment } from './roadTypes';

/*
 * Test circuit for Part 3. Counter-clockwise rounded rectangle with a four-way junction on its north side.
 *
 *   start (0,0,0) heading +Z, south-east corner of the loop
 *   S1  straight north 200 m                        (0,0,0)    -> (0,0,200)
 *   T1  left 90°, R 60                              (0,0,200)  -> (-60,0,260)
 *   S2a straight west, junction approach            (-60,0,260)  -> (-169.8,0,260)
 *   J1  junction pad, centre (-180,0,260), N/S spurs, E/W arms
 *   S2b straight west, junction exit                (-190.2,0,260) -> (-300,0,260)
 *   T2  left 90°, R 60                              (-300,0,260) -> (-360,0,200)
 *   S3  straight south 200 m                        (-360,0,200) -> (-360,0,0)
 *   T3  left 90°, R 60                              (-360,0,0)   -> (-300,0,-60)
 *   S4  straight east 240 m                         (-300,0,-60) -> (-60,0,-60)
 *   T4  left 90°, R 60                              (-60,0,-60)  -> (0,0,0), closing onto S1.start
 *   JN  spur north, dead end, from junction north port, heading +Z, 150 m
 *   JS  spur south, dead end, from junction south port, heading -Z, 150 m
 *
 * Length of the loop, excluding spurs: about 1257 m. Spawn is on S1 in the inner right lane at (1.8, 0, 6), facing +Z.
 * Every connection is listed below by port id. Nothing is placed by eye or snapped.
 */

export const CIRCUIT_TURN_RADIUS_M = 60;
export const CIRCUIT_JUNCTION_CENTRE: Vec3 = { x: -180, y: 0, z: 260 };
export const CIRCUIT_SPAWN = { position: { x: 1.8, y: 0, z: 6 }, yawRadians: 0 } as const;

const LEFT = -Math.PI / 2;
const SPEED_STRAIGHT = 25;
const SPEED_ARC = 18;
const SPEED_JUNCTION = 11;

export function buildCircuitNetwork(): RoadNetwork {
  const half = NETWORK_PROFILE.boundaryHalfWidthMeters;
  const jc = CIRCUIT_JUNCTION_CENTRE;
  const R = CIRCUIT_TURN_RADIUS_M;

  const s1 = buildStraight({ id: 'S1', roadType: 'circuit', start: { position: { x: 0, y: 0, z: 0 }, heading: 0 }, lengthMeters: 200, speedLimitMps: SPEED_STRAIGHT });
  const t1 = buildArc({ id: 'T1', roadType: 'circuit', start: portPose(s1, 'end'), radiusMeters: R, turnRadians: LEFT, speedLimitMps: SPEED_ARC });

  // S2a runs west from the end of T1 to the junction's east port (centre x + half width), so its length is the x drop.
  const s2aStart = portPose(t1, 'end');
  const s2a = buildStraight({
    id: 'S2a',
    roadType: 'circuit',
    start: s2aStart,
    lengthMeters: s2aStart.position.x - (jc.x + half),
    speedLimitMps: SPEED_STRAIGHT,
  });
  const j1 = buildJunction({ id: 'J1', centre: jc });
  // S2b runs west from the junction's west port to x = -300, the start of T2.
  const exitStart = { x: jc.x - half, y: 0, z: jc.z };
  const s2b = buildStraight({
    id: 'S2b',
    roadType: 'circuit',
    start: { position: exitStart, heading: LEFT },
    lengthMeters: exitStart.x - -300,
    speedLimitMps: SPEED_STRAIGHT,
  });
  const t2 = buildArc({ id: 'T2', roadType: 'circuit', start: portPose(s2b, 'end'), radiusMeters: R, turnRadians: LEFT, speedLimitMps: SPEED_ARC });
  const s3 = buildStraight({ id: 'S3', roadType: 'circuit', start: portPose(t2, 'end'), lengthMeters: 200, speedLimitMps: SPEED_STRAIGHT });
  const t3 = buildArc({ id: 'T3', roadType: 'circuit', start: portPose(s3, 'end'), radiusMeters: R, turnRadians: LEFT, speedLimitMps: SPEED_ARC });
  const s4 = buildStraight({ id: 'S4', roadType: 'circuit', start: portPose(t3, 'end'), lengthMeters: 240, speedLimitMps: SPEED_STRAIGHT });
  const t4 = buildArc({ id: 'T4', roadType: 'circuit', start: portPose(s4, 'end'), radiusMeters: R, turnRadians: LEFT, speedLimitMps: SPEED_ARC });

  const spurN = buildStraight({
    id: 'JN',
    roadType: 'spur',
    start: { position: { x: jc.x, y: 0, z: jc.z + half }, heading: 0 },
    lengthMeters: 150,
    speedLimitMps: SPEED_JUNCTION,
    startTerminal: false,
    endTerminal: true,
  });
  const spurS = buildStraight({
    id: 'JS',
    roadType: 'spur',
    start: { position: { x: jc.x, y: 0, z: jc.z - half }, heading: Math.PI },
    lengthMeters: 150,
    speedLimitMps: SPEED_JUNCTION,
    startTerminal: false,
    endTerminal: true,
  });

  const segments: RoadSegment[] = [s1, t1, s2a, j1, s2b, t2, s3, t3, s4, t4, spurN, spurS];

  const connections: RoadConnection[] = [
    { id: 'C-S1-T1', a: { segmentId: 'S1', portId: 'end' }, b: { segmentId: 'T1', portId: 'start' } },
    { id: 'C-T1-S2a', a: { segmentId: 'T1', portId: 'end' }, b: { segmentId: 'S2a', portId: 'start' } },
    { id: 'C-S2a-J1', a: { segmentId: 'S2a', portId: 'end' }, b: { segmentId: 'J1', portId: 'east' } },
    { id: 'C-J1-S2b', a: { segmentId: 'J1', portId: 'west' }, b: { segmentId: 'S2b', portId: 'start' } },
    { id: 'C-S2b-T2', a: { segmentId: 'S2b', portId: 'end' }, b: { segmentId: 'T2', portId: 'start' } },
    { id: 'C-T2-S3', a: { segmentId: 'T2', portId: 'end' }, b: { segmentId: 'S3', portId: 'start' } },
    { id: 'C-S3-T3', a: { segmentId: 'S3', portId: 'end' }, b: { segmentId: 'T3', portId: 'start' } },
    { id: 'C-T3-S4', a: { segmentId: 'T3', portId: 'end' }, b: { segmentId: 'S4', portId: 'start' } },
    { id: 'C-S4-T4', a: { segmentId: 'S4', portId: 'end' }, b: { segmentId: 'T4', portId: 'start' } },
    { id: 'C-T4-S1', a: { segmentId: 'T4', portId: 'end' }, b: { segmentId: 'S1', portId: 'start' } },
    { id: 'C-J1-JN', a: { segmentId: 'J1', portId: 'north' }, b: { segmentId: 'JN', portId: 'start' } },
    { id: 'C-J1-JS', a: { segmentId: 'J1', portId: 'south' }, b: { segmentId: 'JS', portId: 'start' } },
  ];

  return {
    id: 'circuit-test',
    name: 'Test circuit',
    segments,
    connections,
    spawn: { position: { ...CIRCUIT_SPAWN.position }, yawRadians: CIRCUIT_SPAWN.yawRadians },
  };
}

/** Segment order of one lap, counter-clockwise from the spawn. The junction is crossed from east to west. */
export const CIRCUIT_LOOP_ORDER = ['S1', 'T1', 'S2a', 'J1', 'S2b', 'T2', 'S3', 'T3', 'S4', 'T4'] as const;

export interface ReferencePath {
  points: Vec3[];
  /** Arc length of each point along the lap, meters. */
  s: number[];
  /** Segment id that owns each point. */
  segmentIds: string[];
  /** Length of the closed lap, meters. */
  lengthMeters: number;
}

/**
 * Centreline of one lap, as a flat list of points with segment ownership. For tests and the browser driver only.
 * Not used for gameplay: the car is never steered toward it.
 */
export function buildCircuitReferencePath(network: RoadNetwork): ReferencePath {
  const points: Vec3[] = [];
  const segmentIds: string[] = [];
  for (const id of CIRCUIT_LOOP_ORDER) {
    const segment = network.segments.find((candidate) => candidate.id === id);
    if (!segment) throw new Error(`Circuit segment ${id} is missing.`);
    if (segment.kind === 'junction') {
      const junction = segment.junction;
      if (!junction) throw new Error(`Junction ${id} has no footprint.`);
      const h = junction.halfSizeMeters;
      const steps = Math.ceil((2 * h) / 2);
      for (let i = 0; i <= steps; i += 1) {
        // Cross from the east port to the west port along the junction's centre line.
        const x = junction.centre.x + h - (2 * h * i) / steps;
        points.push({ x, y: 0, z: junction.centre.z });
        segmentIds.push(id);
      }
      continue;
    }
    const line = segment.centerline;
    if (!line) throw new Error(`Segment ${id} has no centerline.`);
    for (let i = 0; i < line.points.length; i += 1) {
      if (i === 0 && points.length > 0) continue; // The previous segment already ended at this point.
      const p = line.points[i];
      if (!p) continue;
      points.push({ x: p.x, y: 0, z: p.z });
      segmentIds.push(id);
    }
  }

  const s: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    s.push((s[i - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0));
  }
  const first = points[0];
  const last = points[points.length - 1];
  const closing = first && last ? Math.hypot(first.x - last.x, first.z - last.z) : 0;
  return { points, s, segmentIds, lengthMeters: (s[s.length - 1] ?? 0) + closing };
}
