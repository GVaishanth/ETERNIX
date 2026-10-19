import { describe, expect, it } from 'vitest';
import { buildCircuitNetwork, CIRCUIT_JUNCTION_CENTRE } from './circuitNetwork';
import { validateRoadNetwork } from './roadValidation';
import type { RoadNetwork } from './roadTypes';

function cloneNetwork(network: RoadNetwork): RoadNetwork {
  return structuredClone(network);
}

describe('circuit network validation', () => {
  it('validates with no errors and reports the expected connection count', () => {
    const report = validateRoadNetwork(buildCircuitNetwork());
    expect(report.issues).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.connectionCount).toBe(12);
    expect(report.terminalPortCount).toBe(2);
    expect(report.danglingPorts).toEqual([]);
  });

  it('closes the loop: T4 ends exactly where S1 starts, with matching heading', () => {
    const network = buildCircuitNetwork();
    const t4 = network.segments.find((s) => s.id === 'T4');
    const s1 = network.segments.find((s) => s.id === 'S1');
    const t4End = t4?.ports.find((p) => p.id === 'end');
    const s1Start = s1?.ports.find((p) => p.id === 'start');
    expect(t4End?.position.x).toBeCloseTo(s1Start?.position.x ?? 99, 6);
    expect(t4End?.position.z).toBeCloseTo(s1Start?.position.z ?? 99, 6);
  });

  it('places the arc endpoints at the documented waypoints', () => {
    const network = buildCircuitNetwork();
    const endOf = (id: string) => network.segments.find((s) => s.id === id)?.ports.find((p) => p.id === 'end')?.position;
    const expected: Array<[string, number, number]> = [
      ['T1', -60, 260],
      ['T2', -360, 200],
      ['T3', -300, -60],
      ['T4', 0, 0],
    ];
    for (const [id, x, z] of expected) {
      const p = endOf(id);
      expect(p?.x).toBeCloseTo(x, 6);
      expect(p?.z).toBeCloseTo(z, 6);
    }
  });

  it('has a loop length of about 1257 m, including the 20.4 m junction pad and excluding spurs', () => {
    const network = buildCircuitNetwork();
    const loop = network.segments
      .filter((s) => s.roadType === 'circuit' || s.kind === 'junction')
      .reduce((sum, s) => sum + s.lengthMeters, 0);
    expect(loop).toBeGreaterThan(1250);
    expect(loop).toBeLessThan(1265);
  });

  it('spawns on S1 in the inner right lane facing +Z', () => {
    const network = buildCircuitNetwork();
    expect(network.spawn.position.x).toBeCloseTo(1.8, 9);
    expect(network.spawn.position.z).toBeCloseTo(6, 9);
    expect(network.spawn.yawRadians).toBe(0);
  });

  it('keeps the junction centre fixed', () => {
    expect(CIRCUIT_JUNCTION_CENTRE.x).toBe(-180);
    expect(CIRCUIT_JUNCTION_CENTRE.z).toBe(260);
  });
});

describe('connection mismatches are reported, not snapped', () => {
  it('reports a position gap with both segment ids', () => {
    const network = cloneNetwork(buildCircuitNetwork());
    const s1 = network.segments.find((s) => s.id === 'S1');
    const port = s1?.ports.find((p) => p.id === 'start');
    if (port) port.position.x += 0.5;
    const report = validateRoadNetwork(network);
    const issue = report.issues.find((i) => i.connectionId === 'C-T4-S1');
    expect(report.valid).toBe(false);
    expect(issue?.message).toMatch(/apart/);
    expect(issue?.segmentIds).toEqual(['T4', 'S1']);
  });

  it('reports non-opposed outward directions', () => {
    const network = cloneNetwork(buildCircuitNetwork());
    const s2b = network.segments.find((s) => s.id === 'S2b');
    const port = s2b?.ports.find((p) => p.id === 'start');
    if (port) port.outward = { x: 0, y: 0, z: 1 };
    const report = validateRoadNetwork(network);
    expect(report.issues.some((i) => i.connectionId === 'C-J1-S2b' && /opposite/.test(i.message))).toBe(true);
  });

  it('reports a width mismatch', () => {
    const network = cloneNetwork(buildCircuitNetwork());
    const port = network.segments.find((s) => s.id === 'T2')?.ports.find((p) => p.id === 'start');
    if (port) port.widthMeters = 12;
    const report = validateRoadNetwork(network);
    expect(report.issues.some((i) => i.connectionId === 'C-S2b-T2' && /widths/.test(i.message))).toBe(true);
  });

  it('reports an elevation mismatch', () => {
    const network = cloneNetwork(buildCircuitNetwork());
    const port = network.segments.find((s) => s.id === 'S3')?.ports.find((p) => p.id === 'start');
    if (port) {
      port.elevationMeters = 0.5;
      port.position.y = 0.5;
    }
    const report = validateRoadNetwork(network);
    expect(report.issues.some((i) => i.connectionId === 'C-T2-S3' && /elevation/.test(i.message))).toBe(true);
  });

  it('reports a dangling open port that is not marked terminal', () => {
    const network = cloneNetwork(buildCircuitNetwork());
    network.connections = network.connections.filter((c) => c.id !== 'C-J1-JS');
    const report = validateRoadNetwork(network);
    expect(report.danglingPorts).toContain('J1:south');
    expect(report.danglingPorts).toContain('JS:start');
  });

  it('reports a connection to an unknown port id', () => {
    const network = cloneNetwork(buildCircuitNetwork());
    network.connections.push({ id: 'bogus', a: { segmentId: 'S1', portId: 'nope' }, b: { segmentId: 'T4', portId: 'end' } });
    const report = validateRoadNetwork(network);
    expect(report.issues.some((i) => i.connectionId === 'bogus' && /no port/.test(i.message))).toBe(true);
  });
});

/** A single straight segment (no connections) that rises from startHeight over runMeters at the given grade. */
function slopedStraight(grade: number, startHeight = 0, runMeters = 200): RoadNetwork {
  const samples = 21;
  const points = Array.from({ length: samples }, (_, k) => {
    const t = k / (samples - 1);
    return { x: 0, y: startHeight + grade * runMeters * t, z: runMeters * t };
  });
  const s = points.map((_, k) => (runMeters * k) / (samples - 1));
  const headings = points.map(() => 0);
  const startPos = points[0]!;
  const endPos = points[samples - 1]!;
  const segment = {
    id: 'slope',
    kind: 'straight',
    roadType: 'circuit',
    ports: [
      { id: 'start', position: { ...startPos }, outward: { x: 0, y: 0, z: -1 }, widthMeters: 7, elevationMeters: startHeight, terminal: true },
      { id: 'end', position: { ...endPos }, outward: { x: 0, y: 0, z: 1 }, widthMeters: 7, elevationMeters: endPos.y, terminal: true },
    ],
    centerline: { s, points, headings },
    lengthMeters: runMeters,
    curvatureRadiusMeters: null,
    arc: null,
    junction: null,
    laneCount: 2,
    laneWidthMeters: 3.5,
    roadWidthMeters: 7,
    shoulderWidthMeters: 1,
    boundaryHalfWidthMeters: 4,
    elevationMeters: startHeight,
    surface: 'asphalt',
    drivingDirection: 'twoWay',
    leftBoundary: 'none',
    rightBoundary: 'none',
    speedLimitMps: 14,
  } as RoadNetwork['segments'][number];
  return { id: 'slope-test', name: 'slope test', segments: [segment], connections: [], spawn: { position: { x: 0, y: 0, z: 0 }, yawRadians: 0 } };
}

describe('elevation and grade', () => {
  it('accepts a straight at 6 percent grade', () => {
    const report = validateRoadNetwork(slopedStraight(0.06));
    expect(report.issues.filter((i) => /grade/.test(i.message))).toEqual([]);
  });

  it('accepts a straight at exactly the 8 percent limit', () => {
    const report = validateRoadNetwork(slopedStraight(0.08));
    expect(report.issues.filter((i) => /grade/.test(i.message))).toEqual([]);
  });

  it('rejects a straight at 10 percent grade and names the segment', () => {
    const report = validateRoadNetwork(slopedStraight(0.1));
    const issue = report.issues.find((i) => /grade/.test(i.message));
    expect(report.valid).toBe(false);
    expect(issue?.message).toMatch(/10\.00% exceeds the 8% limit/);
    expect(issue?.segmentIds).toEqual(['slope']);
  });

  it('accepts a road that starts above ground level', () => {
    const report = validateRoadNetwork(slopedStraight(0.05, 42));
    expect(report.issues.filter((i) => /elevation|grade/.test(i.message))).toEqual([]);
  });

  it('rejects a port whose position y differs from its elevation', () => {
    const network = slopedStraight(0.05, 10);
    const port = network.segments[0]?.ports.find((p) => p.id === 'start');
    if (port) port.position.y = 3;
    const report = validateRoadNetwork(network);
    expect(report.issues.some((i) => /port start elevation must match its position y/.test(i.message))).toBe(true);
  });

  it('rejects a segment elevation that does not match its start port', () => {
    const network = slopedStraight(0.05, 10);
    if (network.segments[0]) network.segments[0].elevationMeters = 0;
    const report = validateRoadNetwork(network);
    expect(report.issues.some((i) => /segment elevation must equal the start port elevation/.test(i.message))).toBe(true);
  });

  it('rejects a junction port that is not at the height of its flat pad', () => {
    const network = buildCircuitNetwork();
    const junction = network.segments.find((segment) => segment.kind === 'junction');
    if (!junction?.junction) throw new Error('circuit has no junction');
    junction.junction.centre = { ...junction.junction.centre, y: 4 };
    const report = validateRoadNetwork(network);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => /must sit at the pad height 4\.00 m/.test(i.message))).toBe(true);
  });

  it('keeps the circuit valid after the flat-road rule was relaxed', () => {
    expect(validateRoadNetwork(buildCircuitNetwork()).valid).toBe(true);
  });
});
