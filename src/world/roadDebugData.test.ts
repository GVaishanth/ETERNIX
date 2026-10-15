import { describe, expect, it } from 'vitest';
import { buildCircuitNetwork } from './circuitNetwork';
import { buildRoadDebugData } from './roadDebugData';
import type { RoadNetwork } from './roadTypes';

function kinds(data: ReturnType<typeof buildRoadDebugData>): string[] {
  return data.lines.map((line) => line.kind);
}

describe('buildRoadDebugData', () => {
  it('labels every segment with its id', () => {
    const network = buildCircuitNetwork();
    const data = buildRoadDebugData(network);
    const labels = new Set(data.labels.map((label) => label.text));
    for (const segment of network.segments) expect(labels.has(segment.id), segment.id).toBe(true);
  });

  it('produces every debug layer for the circuit, and no issues', () => {
    const data = buildRoadDebugData(buildCircuitNetwork());
    for (const kind of ['centerline', 'lane', 'boundary', 'junction', 'segmentCut', 'heading', 'portConnected', 'portTerminal', 'portOutward', 'connection']) {
      expect(kinds(data), kind).toContain(kind);
    }
    expect(kinds(data)).not.toContain('issue');
    expect(data.issueCount).toBe(0);
  });

  it('draws a red issue line between the ports of a disconnected connection', () => {
    const network: RoadNetwork = structuredClone(buildCircuitNetwork());
    const s1 = network.segments.find((s) => s.id === 'S1');
    const port = s1?.ports.find((p) => p.id === 'start');
    if (port) port.position.x += 0.5;
    const data = buildRoadDebugData(network);
    expect(data.issueCount).toBeGreaterThan(0);
    expect(kinds(data)).toContain('issue');
  });

  it('is deterministic: the same network gives the same buffers', () => {
    const a = buildRoadDebugData(buildCircuitNetwork());
    const b = buildRoadDebugData(buildCircuitNetwork());
    expect(a.lines.map((line) => line.pointCount)).toEqual(b.lines.map((line) => line.pointCount));
  });
});
