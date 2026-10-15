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
