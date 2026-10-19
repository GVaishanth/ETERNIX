import type { OpponentSystem } from '../ai/aiOpponents';
import type { TrafficRuntime } from '../traffic/trafficRuntime';
import { CONTACT_KINDS, type ContactKind } from '../traffic/contactLog';
import type { SpawnRejection } from '../traffic/trafficSystem';

/*
 * Read-only traffic and opponent state for the snapshot and the DEV panel (Part 4 debug). Built at the diagnostics
 * publish rate. It never writes to the simulation. Segment ids are derived from lane ids: the lane id prefix before the
 * first colon, for example `S1:F:0` gives `S1`.
 */

export interface TrafficVehicleDiagnostics {
  kind: 'traffic' | 'opponent';
  id: number;
  typeId: string | null;
  laneId: string | null;
  segmentId: string | null;
  speedMps: number;
  targetSpeedMps: number;
  followingGapMeters: number | null;
  /** AI state for opponents: follow, brake, recover, lost. Null for traffic. */
  aiState: string | null;
  /** Route point an opponent steers toward, or null. */
  aiTarget: { x: number; z: number } | null;
  /** Traffic only: base-domain position of the vehicle, for seam checks. Read-only, DEV diagnostics. */
  position?: { x: number; z: number };
  /** Opponents only: body centre and heading, plus the stall and release counters. Read-only, DEV diagnostics. */
  pose?: { x: number; z: number; yawDeg: number; stalledSeconds: number; releaseSeconds: number; throttle: number; brake: number; handbrake: number; src: string };
}

export interface TrafficDiagnostics {
  enabled: boolean;
  capacity: number;
  activeTraffic: number;
  opponentCount: number;
  /** Opponent recycles since the last reset. A recycle is a stalled opponent returning to its spawn. */
  opponentRecycles: number;
  vehicles: TrafficVehicleDiagnostics[];
  rejections: Partial<Record<SpawnRejection, number>>;
  contacts: Record<ContactKind, number> | null;
  stats: { spawned: number; recycled: number; stallRecycled: number; invalidTransitions: number } | null;
}

function segmentOf(laneId: string | null): string | null {
  return laneId ? laneId.split(':')[0] ?? null : null;
}

/** Sums the traffic and opponent contact logs. Each kind is recorded in exactly one of them. */
function mergeContactCounts(traffic: TrafficRuntime | null, opponents: OpponentSystem | null): Record<ContactKind, number> {
  const merged = { ...(traffic?.system.contacts.counts ?? emptyCounts()) };
  const opp = opponents?.contacts.counts;
  if (opp) {
    for (const kind of Object.keys(opp) as ContactKind[]) merged[kind] += opp[kind];
  }
  return merged;
}

function emptyCounts(): Record<ContactKind, number> {
  const counts = {} as Record<ContactKind, number>;
  for (const kind of CONTACT_KINDS) counts[kind] = 0;
  return counts;
}

export function buildTrafficDiagnostics(traffic: TrafficRuntime | null, opponents: OpponentSystem | null): TrafficDiagnostics {
  const vehicles: TrafficVehicleDiagnostics[] = [];
  let activeTraffic = 0;
  let capacity = 0;
  if (traffic) {
    capacity = traffic.system.capacity;
    for (const vehicle of traffic.system.vehicles) {
      if (!vehicle.active) continue;
      activeTraffic += 1;
      vehicles.push({
        kind: 'traffic',
        id: vehicle.id,
        typeId: vehicle.typeId,
        laneId: vehicle.laneId,
        segmentId: segmentOf(vehicle.laneId),
        speedMps: vehicle.speed,
        targetSpeedMps: vehicle.cruiseSpeed,
        followingGapMeters: vehicle.leaderGapMeters,
        aiState: null,
        aiTarget: null,
        position: { x: vehicle.x, z: vehicle.z },
      });
    }
  }
  // Retired opponents (finished racers) have left the race, so they are not listed.
  const opponentList = (opponents?.opponents ?? []).filter((opponent) => !opponent.retired);
  for (const opponent of opponentList) {
    vehicles.push({
      kind: 'opponent',
      id: opponent.id,
      typeId: opponent.typeId,
      laneId: opponent.decision?.laneId ?? null,
      segmentId: segmentOf(opponent.decision?.laneId ?? null),
      speedMps: opponent.state.speed,
      targetSpeedMps: opponent.decision?.targetSpeedMps ?? 0,
      followingGapMeters: opponent.decision?.obstacleGapMeters ?? null,
      aiState: opponent.decision?.state ?? null,
      aiTarget: opponent.decision?.target ?? null,
      pose: {
        x: opponent.state.position.x,
        z: opponent.state.position.z,
        yawDeg: (opponent.state.yaw * 180) / Math.PI,
        stalledSeconds: opponent.stalledSeconds,
        releaseSeconds: opponent.releaseSeconds,
        throttle: opponent.lastInput?.throttle ?? 0,
        brake: opponent.lastInput?.brake ?? 0,
        handbrake: opponent.lastInput?.handbrake ?? 0,
        src: opponent.lastSource,
      },
    });
  }
  return {
    enabled: traffic !== null || opponents !== null,
    capacity,
    activeTraffic,
    opponentCount: opponentList.length,
    opponentRecycles: opponents?.recycles ?? 0,
    vehicles,
    rejections: traffic ? { ...traffic.system.stats.rejections } : {},
    contacts: traffic || opponents ? mergeContactCounts(traffic, opponents) : null,
    stats: traffic
      ? {
          spawned: traffic.system.stats.spawned,
          recycled: traffic.system.stats.recycled,
          stallRecycled: traffic.system.stats.stallRecycled,
          invalidTransitions: traffic.system.stats.invalidTransitions,
        }
      : null,
  };
}
