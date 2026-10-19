import type { RoadNetwork } from '../roadTypes';
import type { ChunkCoord } from './chunkGrid';
import { anchorOf } from './worldIndex';

/*
 * Road continuity validator for the chunked world. It reads the authoritative road graph and reports problems. It does
 * not throw, so a bad network produces a readable report. Checks:
 *   - duplicate segment ids (ownership would be ambiguous)
 *   - connections whose endpoint segment does not exist (dangling reference)
 *   - connections whose port does not exist on the segment (invalid endpoint)
 *   - segments with no anchor (no centreline and no junction)
 *   - connected segments whose owning chunks are not neighbours (a gap a car could drive across unloaded)
 * Disconnected districts are checked by the city validator (cityValidation.ts), which has the lane graph.
 */

export type ContinuityIssueCode =
  | 'duplicate-segment'
  | 'dangling-connection'
  | 'invalid-endpoint'
  | 'missing-anchor'
  | 'non-adjacent-owners';

export interface ContinuityIssue {
  readonly code: ContinuityIssueCode;
  readonly detail: string;
}

export interface ContinuityReport {
  readonly valid: boolean;
  readonly issues: readonly ContinuityIssue[];
  readonly segmentCount: number;
  readonly connectionCount: number;
  readonly crossChunkConnections: number;
}

function ownerOfSegmentAnchor(x: number, z: number, size: number): ChunkCoord {
  return { kx: Math.floor(x / size), kz: Math.floor(z / size) };
}

/** Validates the network against chunk ownership of the given chunk size. */
export function validateChunkContinuity(network: RoadNetwork, sizeMeters: number): ContinuityReport {
  const issues: ContinuityIssue[] = [];
  const seen = new Map<string, number>();
  const owners = new Map<string, ChunkCoord>();

  for (const segment of network.segments) {
    seen.set(segment.id, (seen.get(segment.id) ?? 0) + 1);
    try {
      const anchor = anchorOf(segment);
      owners.set(segment.id, ownerOfSegmentAnchor(anchor.x, anchor.z, sizeMeters));
    } catch {
      issues.push({ code: 'missing-anchor', detail: `segment ${segment.id} has no centreline or junction` });
    }
  }
  for (const [id, count] of seen) {
    if (count > 1) issues.push({ code: 'duplicate-segment', detail: `segment id ${id} appears ${count} times` });
  }

  const byId = new Map(network.segments.map((segment) => [segment.id, segment] as const));
  let crossChunk = 0;
  for (const connection of network.connections) {
    const ends = [connection.a, connection.b];
    let resolved = true;
    for (const end of ends) {
      const segment = byId.get(end.segmentId);
      if (!segment) {
        issues.push({ code: 'dangling-connection', detail: `connection ${connection.id} references missing segment ${end.segmentId}` });
        resolved = false;
        continue;
      }
      if (!segment.ports.some((port) => port.id === end.portId)) {
        issues.push({ code: 'invalid-endpoint', detail: `connection ${connection.id} uses port ${end.portId} that ${segment.id} does not have` });
        resolved = false;
      }
    }
    if (!resolved) continue;
    const a = owners.get(connection.a.segmentId);
    const b = owners.get(connection.b.segmentId);
    if (!a || !b) continue;
    if (a.kx !== b.kx || a.kz !== b.kz) crossChunk += 1;
    if (Math.abs(a.kx - b.kx) > 1 || Math.abs(a.kz - b.kz) > 1) {
      issues.push({
        code: 'non-adjacent-owners',
        detail: `connection ${connection.id} joins owners ${connection.a.segmentId} and ${connection.b.segmentId} that are more than one chunk apart`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    segmentCount: network.segments.length,
    connectionCount: network.connections.length,
    crossChunkConnections: crossChunk,
  };
}
