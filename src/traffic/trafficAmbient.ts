import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { pickFrom, seededRandom } from '../core/random';
import { laneSample, type LaneGraph, type LanePath } from './laneGraph';
import type { PlayerPose, SpawnRequest } from './trafficSystem';
import { TRAFFIC_ROSTER, type TrafficVehicleType } from './trafficTypes';
import { baseImage, imageNear } from '../world/wrap/worldWrap';

/*
 * Ambient traffic generator (Part 5). Keeps the population near a target by proposing spawn requests on lanes between
 * the configured distances from the player. It proposes only; the spawner and the traffic system decide, through the
 * same validated spawn path as scenario requests. Deterministic: the same seed and the same player path give the same
 * requests. Work per decision is bounded by candidatesPerDecision.
 */

export interface AmbientOptions {
  seed: number;
}

/** Proposals stay this far from either end of the lane, metres. */
const LANE_END_MARGIN_METERS = 15;

/** Lanes long enough to hold a vehicle with room to spare. Connectors are excluded: spawns go on street lanes. */
function candidateLanes(graph: LaneGraph): LanePath[] {
  return graph.lanes.filter((lane) => lane.kind === 'segment' && lane.lengthMeters >= 2 * LANE_END_MARGIN_METERS + 10);
}

/** A lane's bounding box in its own base domain, with its period. Used to find the lanes near a player. */
interface LaneBox {
  readonly lane: LanePath;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly period: number | null;
}

function laneBoxOf(lane: LanePath): LaneBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of lane.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { lane, minX, maxX, minZ, maxZ, period: lane.periodMeters ?? null };
}

/** Lanes whose bounding box lies within maxDistance of the player, in any image of a periodic loop. */
function lanesNearOf(boxes: readonly LaneBox[], player: PlayerPose, maxDistance: number): LanePath[] {
  const out: LanePath[] = [];
  for (const box of boxes) {
    // The player in the base domain of this lane, and the lane's images one period either side of it.
    const px = box.period === null ? player.x : baseImage(player.x, box.period);
    const pz = box.period === null ? player.z : baseImage(player.z, box.period);
    const shifts = box.period === null ? [0] : [-1, 0, 1];
    let near = false;
    for (const kx of shifts) {
      for (const kz of shifts) {
        const offX = kx * (box.period ?? 0);
        const offZ = kz * (box.period ?? 0);
        const gapX = Math.max(0, box.minX + offX - px, px - (box.maxX + offX));
        const gapZ = Math.max(0, box.minZ + offZ - pz, pz - (box.maxZ + offZ));
        if (Math.hypot(gapX, gapZ) <= maxDistance) near = true;
      }
    }
    if (near) out.push(box.lane);
  }
  return out;
}

export class AmbientTrafficGenerator {
  private random: () => number;
  private readonly seed: number;
  private readonly boxes: LaneBox[];
  private elapsed = 0;

  constructor(graph: LaneGraph, options: AmbientOptions) {
    this.seed = options.seed;
    this.random = seededRandom(options.seed);
    this.boxes = candidateLanes(graph).map(laneBoxOf);
  }

  /** Restarts the sequence from the seed. Used when the scenario is reset. */
  reset(): void {
    this.random = seededRandom(this.seed);
    this.elapsed = 0;
  }

  /**
   * Returns one request when a decision is due, the population is below target, and a candidate fits. Otherwise null.
   * `population` counts active vehicles plus pending requests, so the generator never over-requests.
   */
  next(player: PlayerPose, population: number, dtSeconds: number): SpawnRequest | null {
    this.elapsed += dtSeconds;
    if (this.elapsed < TRAFFIC_CONFIG.ambient.intervalSeconds) return null;
    this.elapsed = 0;
    if (population >= TRAFFIC_CONFIG.ambient.targetCount || this.boxes.length === 0) return null;

    const forwardX = Math.sin(player.yaw);
    const forwardZ = Math.cos(player.yaw);
    const { minDistanceMeters, maxDistanceMeters, candidatesPerDecision, maxForwardCosine } = TRAFFIC_CONFIG.ambient;
    // Only lanes that can be in the spawn band are candidates. Picking from the whole network would thin the traffic
    // around the player as the map grows, because most lanes are far away.
    const near = this.lanesNear(player, maxDistanceMeters);
    if (near.length === 0) return null;
    for (let attempt = 0; attempt < candidatesPerDecision; attempt += 1) {
      const lane = pickFrom(this.random, near);
      // Keep proposals clear of both lane ends, so a vehicle is never placed on a lane end.
      const s = LANE_END_MARGIN_METERS + this.random() * (lane.lengthMeters - 2 * LANE_END_MARGIN_METERS);
      const point = laneSample(lane, s);
      // The point in the image nearest the player (a loop can put the lane across a seam from the car).
      const period = lane.periodMeters ?? null;
      const dx = imageNear(player.x, point.x, period) - player.x;
      const dz = imageNear(player.z, point.z, period) - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance < minDistanceMeters || distance > maxDistanceMeters) continue;
      // Cosine of the angle between the player's heading and the direction to the point. Skip points ahead of the car.
      const cosine = (dx * forwardX + dz * forwardZ) / distance;
      if (cosine > maxForwardCosine) continue;
      const type: TrafficVehicleType = pickWeighted(this.random);
      const cruise = type.cruiseSpeedMinMps + (type.cruiseSpeedMaxMps - type.cruiseSpeedMinMps) * this.random();
      const limit = lane.speedLimitMps;
      const cruiseSpeedMps = Math.min(cruise, limit);
      return {
        typeId: type.id,
        laneId: lane.id,
        s,
        speedMps: cruiseSpeedMps * 0.9,
        cruiseSpeedMps,
      };
    }
    return null;
  }

  private lanesNear(player: PlayerPose, maxDistance: number): LanePath[] {
    return lanesNearOf(this.boxes, player, maxDistance);
  }
}

function pickWeighted(random: () => number): TrafficVehicleType {
  const total = TRAFFIC_ROSTER.reduce((sum, type) => sum + type.spawnWeight, 0);
  let roll = random() * total;
  for (const type of TRAFFIC_ROSTER) {
    roll -= type.spawnWeight;
    if (roll < 0) return type;
  }
  return pickFrom(random, TRAFFIC_ROSTER);
}
