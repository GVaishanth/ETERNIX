import { describe, expect, it } from 'vitest';
import { WORLD_STREAMING_CONFIG } from '../../config/worldStreamingConfig';
import { buildCityNetwork } from '../city/cityNetwork';
import type { RoadNetwork } from '../roadTypes';
import { chunkBounds, chunkKey } from './chunkGrid';
import { validateChunkContinuity } from './continuity';
import { anchorOf, buildWorldIndex } from './worldIndex';

const SIZE = WORLD_STREAMING_CONFIG.chunkSizeMeters;
const network = buildCityNetwork();

function cloneNetwork(source: RoadNetwork): RoadNetwork {
  return JSON.parse(JSON.stringify(source)) as RoadNetwork;
}

describe('world index: ownership', () => {
  const index = buildWorldIndex(network, SIZE);

  it('gives every segment exactly one owner, and every owner lists it once', () => {
    expect(index.segmentOwner.size).toBe(network.segments.length);
    let listed = 0;
    for (const ids of index.chunkSegments.values()) listed += ids.length;
    expect(listed).toBe(network.segments.length);
  });

  it('places every anchor inside its owning chunk', () => {
    for (const segment of network.segments) {
      const key = index.segmentOwner.get(segment.id);
      expect(key, segment.id).toBeDefined();
      const coord = index.chunks.get(key ?? '');
      expect(coord, segment.id).toBeDefined();
      if (!coord) continue;
      const b = chunkBounds(coord, SIZE);
      const anchor = anchorOf(segment);
      expect(anchor.x >= b.minX && anchor.x < b.maxX, `${segment.id} x`).toBe(true);
      expect(anchor.z >= b.minZ && anchor.z < b.maxZ, `${segment.id} z`).toBe(true);
    }
  });

  it('is deterministic: two builds give identical ownership', () => {
    const again = buildWorldIndex(buildCityNetwork(), SIZE);
    expect([...again.segmentOwner.entries()]).toEqual([...index.segmentOwner.entries()]);
  });

  it('refuses a duplicate segment id instead of choosing an owner silently', () => {
    const broken = cloneNetwork(network);
    const first = broken.segments[0];
    if (!first) throw new Error('network has no segments');
    broken.segments.push({ ...JSON.parse(JSON.stringify(first)) } as typeof first);
    expect(() => buildWorldIndex(broken, SIZE)).toThrow(/Duplicate segment id/);
  });

  it('keys chunks with stable ids', () => {
    for (const key of index.chunks.keys()) expect(key).toMatch(/^C-(-?\d+)-(-?\d+)$/);
    const sample = index.chunks.get(chunkKey({ kx: 0, kz: 0 }));
    if (sample) expect(chunkKey(sample)).toBe('C-0-0');
  });
});

describe('road continuity validator', () => {
  it('passes the city network', () => {
    const report = validateChunkContinuity(network, SIZE);
    expect(report.issues).toEqual([]);
    expect(report.valid).toBe(true);
    // Connections that cross a chunk edge exist. Without them the continuity rule would be untested.
    expect(report.crossChunkConnections).toBeGreaterThan(0);
  });

  it('reports a connection to a missing segment as dangling', () => {
    const broken = cloneNetwork(network);
    const connection = broken.connections[0];
    if (!connection) throw new Error('network has no connections');
    connection.a = { ...connection.a, segmentId: 'NOT-A-SEGMENT' };
    const report = validateChunkContinuity(broken, SIZE);
    expect(report.issues.some((issue) => issue.code === 'dangling-connection')).toBe(true);
  });

  it('reports a port that the segment does not have as an invalid endpoint', () => {
    const broken = cloneNetwork(network);
    const connection = broken.connections[0];
    if (!connection) throw new Error('network has no connections');
    connection.a = { ...connection.a, portId: 'no-such-port' };
    const report = validateChunkContinuity(broken, SIZE);
    expect(report.issues.some((issue) => issue.code === 'invalid-endpoint')).toBe(true);
  });

  it('reports a duplicate segment id', () => {
    const broken = cloneNetwork(network);
    const first = broken.segments[0];
    if (!first) throw new Error('network has no segments');
    broken.segments.push(JSON.parse(JSON.stringify(first)) as typeof first);
    const report = validateChunkContinuity(broken, SIZE);
    expect(report.issues.some((issue) => issue.code === 'duplicate-segment')).toBe(true);
  });
});
