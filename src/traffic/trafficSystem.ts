import { forwardFromYaw, rightFromYaw } from '../core/coordinates';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { groundBoxFromPose, groundBoxOverlap, type GroundBox } from '../simulation/obb';
import { signedDistance, type RoadBoundary } from '../simulation/roadBoundary';
import type { RoadNetwork } from '../world/roadTypes';
import { chainDistance, laneSample, nearestOnLane, successorOf, type LaneGraph, type LanePath } from './laneGraph';
import { findTrafficType, trafficDimensions, type PlayerFootprint, type PlayerPose, type TrafficTypeId } from './trafficTypes';
import { SpatialHash } from '../simulation/spatialHash';
import { ContactLog } from './contactLog';
import { findPlayerContact, findTrafficPairs, playerBox, shiftBox, vehicleBox, type TrafficPair } from './trafficCollision';
import { baseImage, imageNear } from '../world/wrap/worldWrap';
import {
  approachHeading,
  createInactiveTrafficVehicle,
  idmAcceleration,
  resetTrafficVehicle,
  type TrafficVehicle,
} from './trafficVehicle';

/*
 * Traffic population (Part 4). One authoritative owner of all AI traffic. Stepped by GameSimulation at the fixed step,
 * so traffic and the player always see the same tick. Pure: no React, no Three.js.
 *
 * Responsibilities: validated spawning, lane-locked motion with IDM following, lane transitions, recycling, and
 * rejection statistics for diagnostics.
 */

export type { PlayerPose, PlayerFootprint } from './trafficTypes';

/** A correction for a driven car touching traffic. Push and normal point toward the driven car. */
export interface DrivenContact {
  push: { x: number; z: number };
  normal: { x: number; z: number };
  otherVelocity: { x: number; z: number };
  vehicleId: number;
}

export interface SpawnRequest {
  typeId: TrafficTypeId;
  laneId: string;
  /** Arc length along the lane, meters, measured to the reference point. */
  s: number;
  speedMps: number;
  cruiseSpeedMps: number;
}

export type SpawnRejection =
  | 'unknown-lane'
  | 'connector-lane'
  | 'lane-end'
  | 'no-free-slot'
  | 'overlap-vehicle'
  | 'overlap-player'
  | 'visible-ahead'
  | 'too-close-ahead'
  | 'too-close-behind'
  | 'outside-road'
  | 'junction-occupied'
  | 'traffic-gap-ahead'
  | 'traffic-gap-behind';

export type SpawnResult = { ok: true; id: number } | { ok: false; reason: SpawnRejection };

export interface TrafficStats {
  spawned: number;
  recycled: number;
  /** Vehicles recycled because they stayed stopped too long. Stops permanent queues. */
  stallRecycled: number;
  /** Lane transitions where the pose did not match the next lane's start. Should always be zero. */
  invalidTransitions: number;
  rejections: Partial<Record<SpawnRejection, number>>;
}

export interface TrafficSystemOptions {
  capacity?: number;
  playerFootprint: PlayerFootprint;
}

const MAX_LANE_HOPS = 12;
const TRANSITION_TOLERANCE_METERS = 0.05;

function expandBox(box: GroundBox, margin: number): GroundBox {
  return { ...box, halfLengthMeters: box.halfLengthMeters + margin, halfWidthMeters: box.halfWidthMeters + margin };
}

function boxCorners(box: GroundBox): Array<{ x: number; z: number }> {
  const corners: Array<{ x: number; z: number }> = [];
  for (const along of [box.halfLengthMeters, -box.halfLengthMeters]) {
    for (const side of [box.halfWidthMeters, -box.halfWidthMeters]) {
      corners.push({
        x: box.cx + box.fx * along + box.rx * side,
        z: box.cz + box.fz * along + box.rz * side,
      });
    }
  }
  return corners;
}

export class TrafficSystem {
  readonly capacity: number;
  readonly vehicles: TrafficVehicle[];
  readonly stats: TrafficStats = { spawned: 0, recycled: 0, stallRecycled: 0, invalidTransitions: 0, rejections: {} };
  /** Contacts recorded once per event, with ids. Read by diagnostics and tests. */
  readonly contacts: ContactLog;
  private readonly hash: SpatialHash;
  private readonly pairs: TrafficPair[] = [];
  private readonly scratchIds: number[] = [];
  private readonly boxes: Array<GroundBox | null>;

  private readonly graph: LaneGraph;
  private readonly boundary: RoadBoundary | null;
  private readonly playerFootprint: PlayerFootprint;
  private readonly junctionBoxes: Array<{ cx: number; cz: number; halfSize: number }>;
  private readonly lanesByLaneId: Map<string, LanePath>;
  private playerPose: PlayerPose = { x: 0, z: 0, yaw: 0, speed: 0 };
  /** Period of a looping network, or null. Every distance between traffic and the driven car is measured on this. */
  private readonly period: number | null;

  constructor(network: RoadNetwork, graph: LaneGraph, boundary: RoadBoundary | null, options: TrafficSystemOptions) {
    this.capacity = options.capacity ?? TRAFFIC_CONFIG.poolCapacity;
    this.vehicles = Array.from({ length: this.capacity }, (_unused, id) => createInactiveTrafficVehicle(id));
    this.boxes = Array.from({ length: this.capacity }, () => null);
    this.hash = new SpatialHash(TRAFFIC_CONFIG.collision.hashCellMeters);
    this.contacts = new ContactLog(TRAFFIC_CONFIG.collision.eventLogCapacity);
    this.boundary = boundary;
    this.period = network.periodMeters ?? null;
    this.playerFootprint = options.playerFootprint;
    this.graph = graph;
    this.lanesByLaneId = graph.byId;
    this.junctionBoxes = network.segments
      .filter((segment) => segment.junction !== null)
      .map((segment) => ({
        cx: segment.junction?.centre.x ?? 0,
        cz: segment.junction?.centre.z ?? 0,
        halfSize: segment.junction?.halfSizeMeters ?? 0,
      }));
  }

  get activeCount(): number {
    let count = 0;
    for (const vehicle of this.vehicles) if (vehicle.active) count += 1;
    return count;
  }

  /** Validates and, if allowed, places a vehicle in a free slot. Rejections are counted by reason, never silent. */
  spawn(request: SpawnRequest, player: PlayerPose): SpawnResult {
    const reject = (reason: SpawnRejection): SpawnResult => {
      this.stats.rejections[reason] = (this.stats.rejections[reason] ?? 0) + 1;
      return { ok: false, reason };
    };

    const lane = this.lanesByLaneId.get(request.laneId);
    if (!lane) return reject('unknown-lane');
    if (lane.kind === 'connector') return reject('connector-lane');

    const type = findTrafficType(request.typeId);
    const dims = trafficDimensions(type);
    if (request.s < dims.rearMeters || request.s > lane.lengthMeters - dims.noseMeters - 1) return reject('lane-end');

    const slot = this.vehicles.find((vehicle) => !vehicle.active);
    if (!slot) return reject('no-free-slot');

    const pose = laneSample(lane, request.s);
    const box = groundBoxFromPose(pose.x, pose.z, pose.heading, dims.rearMeters, dims.noseMeters, dims.halfWidthMeters);
    const margin = TRAFFIC_CONFIG.spawn.overlapMarginMeters;

    for (const other of this.vehicles) {
      if (!other.active) continue;
      const otherType = other.typeId ? findTrafficType(other.typeId) : null;
      if (!otherType) continue;
      const otherDims = trafficDimensions(otherType);
      // The other vehicle, in the image nearest the candidate (a seam can lie between them).
      const otherPose = { x: imageNear(pose.x, other.x, this.period), z: imageNear(pose.z, other.z, this.period), heading: other.heading };
      const otherBox = groundBoxFromPose(otherPose.x, otherPose.z, otherPose.heading, otherDims.rearMeters, otherDims.noseMeters, otherDims.halfWidthMeters);
      if (groundBoxOverlap(expandBox(box, margin), otherBox).overlapping) return reject('overlap-vehicle');
    }

    const playerBox = groundBoxFromPose(
      imageNear(pose.x, player.x, this.period),
      imageNear(pose.z, player.z, this.period),
      player.yaw,
      this.playerFootprint.rearMeters,
      this.playerFootprint.noseMeters,
      this.playerFootprint.halfWidthMeters,
    );
    if (groundBoxOverlap(expandBox(box, margin), playerBox).overlapping) return reject('overlap-player');

    // Position relative to the player, in the player's own frame.
    const forward = forwardFromYaw(player.yaw);
    const right = rightFromYaw(player.yaw);
    const dx = imageNear(player.x, pose.x, this.period) - player.x;
    const dz = imageNear(player.z, pose.z, this.period) - player.z;
    const ahead = dx * forward.x + dz * forward.z;
    const lateral = dx * right.x + dz * right.z;
    const spawnConfig = TRAFFIC_CONFIG.spawn;
    const closing = Math.max(0, player.speed - request.speedMps);
    if (ahead > 0) {
      const halfCone = (spawnConfig.viewConeHalfAngleDegrees * Math.PI) / 180;
      if (ahead < spawnConfig.viewConeRangeMeters && Math.abs(lateral) <= ahead * Math.tan(halfCone)) {
        return reject('visible-ahead');
      }
    }
    // Longitudinal gap rules apply inside the lane corridor only. Traffic far to the side is not in the way.
    const inCorridor = Math.abs(lateral) <= spawnConfig.corridorHalfWidthMeters;
    if (inCorridor && ahead > 0 && ahead < spawnConfig.baseAheadGapMeters + spawnConfig.reactionSeconds * closing) {
      return reject('too-close-ahead');
    }
    if (inCorridor && ahead <= 0) {
      const behindGap = -ahead;
      const closingFromBehind = Math.max(0, request.speedMps - player.speed);
      if (behindGap < spawnConfig.behindGapMeters + spawnConfig.reactionSeconds * closingFromBehind) {
        return reject('too-close-behind');
      }
    }

    // Spacing to other traffic on the lane chain, both ahead and behind. The required gap depends on the traffic
    // speed of the follower, and on both vehicle lengths (through the nose and rear distances).
    const lookahead = TRAFFIC_CONFIG.leaderLookaheadMeters;
    for (const other of this.vehicles) {
      if (!other.active || !other.typeId || !other.laneId) continue;
      const otherType = findTrafficType(other.typeId);
      const otherDims = trafficDimensions(otherType);
      const ahead = chainDistance(this.graph, lane.id, request.s, other.laneId, other.s, lookahead);
      if (ahead !== null && ahead > 0) {
        const gap = ahead - dims.noseMeters - otherDims.rearMeters;
        if (gap < type.minGapMeters + type.headwaySeconds * request.speedMps) return reject('traffic-gap-ahead');
      }
      const behind = chainDistance(this.graph, other.laneId, other.s, lane.id, request.s, lookahead);
      if (behind !== null && behind > 0) {
        const gap = behind - otherDims.noseMeters - dims.rearMeters;
        if (gap < otherType.minGapMeters + otherType.headwaySeconds * other.speed) return reject('traffic-gap-behind');
      }
    }

    const boundary = this.boundary;
    if (boundary) {
      for (const corner of boxCorners(box)) {
        if (signedDistance(boundary, corner.x, corner.z).distance > -spawnConfig.boundaryClearanceMeters) {
          return reject('outside-road');
        }
      }
    }

    for (const junction of this.junctionBoxes) {
      const reach = junction.halfSize + spawnConfig.junctionClearanceMeters;
      const jx = imageNear(junction.cx, pose.x, this.period) - junction.cx;
      const jz = imageNear(junction.cz, pose.z, this.period) - junction.cz;
      if (Math.abs(jx) < reach + dims.lengthMeters && Math.abs(jz) < reach + dims.lengthMeters) {
        return reject('junction-occupied');
      }
    }

    resetTrafficVehicle(slot);
    slot.active = true;
    slot.typeId = request.typeId;
    slot.laneId = lane.id;
    slot.s = request.s;
    slot.speed = request.speedMps;
    slot.cruiseSpeed = Math.min(request.cruiseSpeedMps, lane.speedLimitMps);
    slot.x = pose.x;
    slot.y = pose.y;
    slot.z = pose.z;
    slot.heading = pose.heading;
    this.stats.spawned += 1;
    return { ok: true, id: slot.id };
  }

  /** Advances all active traffic by one fixed step. */
  step(dtSeconds: number, player: PlayerPose): void {
    this.playerPose = player;
    if (!(dtSeconds > 0)) return;

    const leaders = this.computeLeaders();
    for (const vehicle of this.vehicles) {
      if (!vehicle.active || !vehicle.typeId || !vehicle.laneId) continue;
      const type = findTrafficType(vehicle.typeId);
      const lane = this.lanesByLaneId.get(vehicle.laneId);
      if (!lane) continue;

      const leader = leaders.get(vehicle.id) ?? null;
      vehicle.leaderId = leader && !leader.isPlayer ? leader.vehicleId : null;
      vehicle.leaderIsPlayer = leader?.isPlayer ?? false;
      vehicle.leaderGapMeters = leader?.gapMeters ?? null;
      vehicle.leaderSpeed = leader?.speedMps ?? null;

      const desired = Math.min(vehicle.cruiseSpeed, lane.speedLimitMps);
      const raw = idmAcceleration(
        {
          desiredSpeedMps: desired,
          minGapMeters: type.minGapMeters,
          headwaySeconds: type.headwaySeconds,
          comfortAccelMps2: type.comfortAccelMps2,
          comfortDecelMps2: type.comfortDecelMps2,
        },
        vehicle.speed,
        leader?.gapMeters ?? null,
        leader?.speedMps ?? 0,
      );
      const accel = Math.max(-TRAFFIC_CONFIG.idm.emergencyDecelMps2, Math.min(type.comfortAccelMps2, raw));
      vehicle.accel = accel;

      const previousSpeed = vehicle.speed;
      const nextSpeed = Math.max(0, previousSpeed + accel * dtSeconds);
      const distance = ((previousSpeed + nextSpeed) / 2) * dtSeconds;
      vehicle.speed = nextSpeed;
      this.advanceAlongLanes(vehicle, distance);
      this.refreshPose(vehicle, dtSeconds);
    }

    this.resolveTrafficOverlaps();
    this.checkBoundaryContacts();
    this.updateStalls(dtSeconds);
    this.recycleFarVehicles();
  }

  /**
   * Player contact. Called by GameSimulation after the player's own step. Returns the push-out and the approach
   * velocity to remove, for the player's state to apply. Traffic is kinematic and lane-locked, so it is never moved
   * by the player. Returns null when there is no contact.
   */
  resolvePlayerContact(player: PlayerPose): DrivenContact | null {
    return this.resolveDrivenContact(playerBox(player, this.playerFootprint), 'player');
  }

  /**
   * Contact between any driven car and traffic. `label` is 'player' or an opponent id. The driven car is corrected
   * by the caller. Traffic is never moved, so the correction always belongs to the driven car.
   */
  resolveDrivenContact(driven: GroundBox, label: string, kind: 'opponent-traffic' | 'police-traffic' = 'opponent-traffic'): DrivenContact | null {
    this.rebuildHash();
    // Traffic boxes live in the base domain. The driven box is moved there first; the overlap, and so the correction, is
    // unchanged by a translation.
    const box = shiftBox(driven, baseImage(driven.cx, this.period) - driven.cx, baseImage(driven.cz, this.period) - driven.cz);
    const hit = findPlayerContact(this.vehicles, this.boxes, box, this.hash, this.scratchIds, this.period);
    if (!hit) return null;
    this.contacts.touch(label === 'player' ? 'player-traffic' : kind, label, String(hit.vehicle.id));
    const maxPush = TRAFFIC_CONFIG.collision.maxPlayerPushPerStepMeters;
    const depth = Math.min(hit.overlap.depthMeters, maxPush);
    const other = this.trafficVelocity(hit.vehicle);
    return {
      push: { x: hit.overlap.normalX * depth, z: hit.overlap.normalZ * depth },
      normal: { x: hit.overlap.normalX, z: hit.overlap.normalZ },
      otherVelocity: other,
      vehicleId: hit.vehicle.id,
    };
  }

  /** Active traffic boxes and speeds, for the AI's obstacle sensing. Allocates a small list per call. */
  activeObstacles(): Array<{ key: string; box: GroundBox; speedMps: number }> {
    this.refreshBoxes();
    const out: Array<{ key: string; box: GroundBox; speedMps: number }> = [];
    for (const vehicle of this.vehicles) {
      const box = this.boxes[vehicle.id];
      if (vehicle.active && box) out.push({ key: `traffic:${vehicle.id}`, box, speedMps: vehicle.speed });
    }
    return out;
  }

  /** Ends the contact step. Call once per fixed step after all contact checks. */
  endContactStep(): void {
    this.contacts.endStep();
  }

  /** Ground velocity of a traffic vehicle, along its heading. */
  private trafficVelocity(vehicle: TrafficVehicle): { x: number; z: number } {
    return { x: Math.sin(vehicle.heading) * vehicle.speed, z: Math.cos(vehicle.heading) * vehicle.speed };
  }

  private refreshBoxes(): void {
    for (const vehicle of this.vehicles) this.boxes[vehicle.id] = vehicle.active ? vehicleBox(vehicle) : null;
  }

  /** Rebuilds the broad-phase grid from the current boxes. Called before every pair or contact query. */
  private rebuildHash(): void {
    this.refreshBoxes();
    this.hash.clear();
    for (const vehicle of this.vehicles) {
      const box = this.boxes[vehicle.id];
      if (vehicle.active && box) this.hash.insert(vehicle.id, box.cx, box.cz);
    }
  }

  /**
   * Traffic-traffic overlaps. Lane-locked vehicles should never overlap, but a spawn or a braking error could leave
   * them overlapping. The rear vehicle is set back along its lane, and its speed is capped at the leader's. Pure
   * lane-locked correction: no sideways motion, no forces.
   */
  private resolveTrafficOverlaps(): void {
    this.rebuildHash();
    findTrafficPairs(this.vehicles, this.boxes, this.hash, this.pairs, this.scratchIds, this.period);
    for (const pair of this.pairs) {
      this.contacts.touch('traffic-traffic', String(pair.a.id), String(pair.b.id));
      const aBehind = this.isBehind(pair.a, pair.b);
      const follower = aBehind === null ? null : aBehind ? pair.a : pair.b;
      const leader = follower === pair.a ? pair.b : pair.a;
      if (!follower) continue;
      const lane = this.lanesByLaneId.get(follower.laneId ?? '');
      if (!lane) continue;
      follower.s = Math.max(0, follower.s - pair.overlap.depthMeters - TRAFFIC_CONFIG.collision.separationMarginMeters);
      follower.speed = Math.min(follower.speed, leader.speed);
      this.refreshPose(follower, 0);
    }
    this.refreshBoxes();
  }

  /** True when `a` is behind `b` on the lane chain, false when ahead, null when they are not on one chain. */
  private isBehind(a: TrafficVehicle, b: TrafficVehicle): boolean | null {
    if (!a.laneId || !b.laneId) return null;
    const ahead = chainDistance(this.graph, a.laneId, a.s, b.laneId, b.s, TRAFFIC_CONFIG.leaderLookaheadMeters);
    if (ahead !== null && ahead > 0) return true;
    const back = chainDistance(this.graph, b.laneId, b.s, a.laneId, a.s, TRAFFIC_CONFIG.leaderLookaheadMeters);
    if (back !== null && back > 0) return false;
    return null;
  }

  /** Vehicle-boundary contacts. A traffic footprint corner outside the drivable region is recorded once per event. */
  private checkBoundaryContacts(): void {
    const boundary = this.boundary;
    if (!boundary) return;
    for (const vehicle of this.vehicles) {
      const box = this.boxes[vehicle.id];
      if (!vehicle.active || !box) continue;
      for (const [along, side] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const x = box.cx + box.fx * box.halfLengthMeters * along + box.rx * box.halfWidthMeters * side;
        const z = box.cz + box.fz * box.halfLengthMeters * along + box.rz * box.halfWidthMeters * side;
        if (signedDistance(boundary, x, z).distance > 0) {
          this.contacts.touch('traffic-boundary', String(vehicle.id), null);
          break;
        }
      }
    }
  }

  /** Recycles traffic that has stayed stopped for too long, so a blocked lane cannot stay blocked forever. */
  private updateStalls(dtSeconds: number): void {
    for (const vehicle of this.vehicles) {
      if (!vehicle.active) continue;
      if (vehicle.speed < TRAFFIC_CONFIG.obstacle.stoppedSpeedMps) {
        vehicle.stoppedSeconds += dtSeconds;
      } else {
        vehicle.stoppedSeconds = 0;
      }
      if (vehicle.stoppedSeconds >= TRAFFIC_CONFIG.obstacle.stallRecycleSeconds) {
        resetTrafficVehicle(vehicle);
        this.stats.stallRecycled += 1;
        this.stats.recycled += 1;
      }
    }
  }

  /** Moves a vehicle forward along its lanes, crossing into successors as needed. */
  private advanceAlongLanes(vehicle: TrafficVehicle, distance: number): void {
    let lane: LanePath | undefined = this.lanesByLaneId.get(vehicle.laneId ?? '');
    if (!lane) return;
    let s = vehicle.s + distance;
    let guard = 0;
    while (lane && s >= lane.lengthMeters && guard < MAX_LANE_HOPS) {
      guard += 1;
      const overshoot = s - lane.lengthMeters;
      const successorId: string | undefined = successorOf(lane);
      const successor: LanePath | undefined = successorId !== undefined ? this.lanesByLaneId.get(successorId) : undefined;
      if (!successor) {
        // A dead end cannot be entered. Recycle the vehicle rather than leaving it stranded.
        this.stats.invalidTransitions += 1;
        resetTrafficVehicle(vehicle);
        this.stats.recycled += 1;
        return;
      }
      // Continuity check: the lane end must meet the successor start. A mismatch is counted, never snapped.
      // The successor's start is compared in the image nearest the lane end, so a seam between them is not a mismatch.
      const end = laneSample(lane, lane.lengthMeters);
      const start = laneSample(successor, 0);
      const startX = imageNear(end.x, start.x, this.period);
      const startZ = imageNear(end.z, start.z, this.period);
      if (Math.hypot(end.x - startX, end.z - startZ) > TRANSITION_TOLERANCE_METERS) {
        this.stats.invalidTransitions += 1;
      }
      lane = successor;
      s = overshoot;
      vehicle.laneId = successor.id;
    }
    vehicle.s = s;
  }

  private refreshPose(vehicle: TrafficVehicle, dtSeconds: number): void {
    const lane = this.lanesByLaneId.get(vehicle.laneId ?? '');
    if (!lane) return;
    const pose = laneSample(lane, vehicle.s);
    vehicle.x = pose.x;
    vehicle.y = pose.y;
    vehicle.z = pose.z;
    vehicle.heading = approachHeading(vehicle.heading, pose.heading, TRAFFIC_CONFIG.headingRateLimitRadPerSecond, dtSeconds);
  }

  /**
   * Nearest active vehicle ahead on the same lane chain, within the lookahead. Chains through successor lanes only,
   * so a leader on the next straight is seen at its true distance. Gap = chain distance minus both vehicle lengths.
   */
  private computeLeaders(): Map<number, { vehicleId: number; gapMeters: number; speedMps: number; isPlayer: boolean }> {
    const lookahead = TRAFFIC_CONFIG.leaderLookaheadMeters;
    const result = new Map<number, { vehicleId: number; gapMeters: number; speedMps: number; isPlayer: boolean }>();
    for (const vehicle of this.vehicles) {
      if (!vehicle.active || !vehicle.typeId || !vehicle.laneId) continue;
      const nose = trafficDimensions(findTrafficType(vehicle.typeId)).noseMeters;
      let best: { vehicleId: number; gapMeters: number; speedMps: number; isPlayer: boolean } | null = null;
      for (const other of this.vehicles) {
        if (!other.active || other.id === vehicle.id || !other.typeId || !other.laneId) continue;
        const distance = chainDistance(this.graph, vehicle.laneId, vehicle.s, other.laneId, other.s, lookahead);
        if (distance === null || distance <= 0) continue;
        const rear = trafficDimensions(findTrafficType(other.typeId)).rearMeters;
        const gap = distance - nose - rear;
        if (!best || gap < best.gapMeters) best = { vehicleId: other.id, gapMeters: gap, speedMps: other.speed, isPlayer: false };
      }
      // The player's car is an obstacle when it sits in this vehicle's lane ahead. Traffic brakes for it.
      const playerLeader = this.playerObstacle(vehicle, nose);
      if (playerLeader && (!best || playerLeader.gapMeters < best.gapMeters)) {
        best = { vehicleId: -1, gapMeters: playerLeader.gapMeters, speedMps: playerLeader.speedMps, isPlayer: true };
      }
      if (best) result.set(vehicle.id, best);
    }
    return result;
  }

  /**
   * The player's car as an obstacle on this vehicle's lane chain. Found by the nearest lane sample within the corridor.
   * Gap is measured the same way as to a traffic vehicle. Speed is the player's speed along the lane.
   */
  private playerObstacle(vehicle: TrafficVehicle, nose: number): { gapMeters: number; speedMps: number } | null {
    if (!vehicle.laneId) return null;
    const lookahead = TRAFFIC_CONFIG.leaderLookaheadMeters;
    const corridor = TRAFFIC_CONFIG.obstacle.corridorHalfWidthMeters;
    const playerRear = this.playerFootprint.rearMeters;
    let lane = this.lanesByLaneId.get(vehicle.laneId);
    let offset = -vehicle.s;
    for (let hop = 0; lane && hop < MAX_LANE_HOPS && offset <= lookahead; hop += 1) {
      const hit = nearestOnLane(lane, this.playerPose.x, this.playerPose.z);
      if (hit && hit.distance <= corridor) {
        const distance = offset + hit.s;
        if (distance > 0) {
          const alongLane = Math.cos(this.playerPose.yaw - hit.heading);
          return { gapMeters: distance - nose - playerRear, speedMps: Math.max(0, this.playerPose.speed * alongLane) };
        }
      }
      offset += lane.lengthMeters;
      const next: string | undefined = successorOf(lane);
      lane = next !== undefined ? this.lanesByLaneId.get(next) : undefined;
    }
    return null;
  }

  private recycleFarVehicles(): void {
    const radiusSquared = TRAFFIC_CONFIG.activeRadiusMeters ** 2;
    for (const vehicle of this.vehicles) {
      if (!vehicle.active) continue;
      const dx = imageNear(this.playerPose.x, vehicle.x, this.period) - this.playerPose.x;
      const dz = imageNear(this.playerPose.z, vehicle.z, this.period) - this.playerPose.z;
      if (dx * dx + dz * dz > radiusSquared) {
        resetTrafficVehicle(vehicle);
        this.stats.recycled += 1;
      }
    }
  }

  /** Clears every slot and statistics. Used by the development scenario reset. */
  clear(): void {
    for (const vehicle of this.vehicles) resetTrafficVehicle(vehicle);
    this.stats.spawned = 0;
    this.stats.recycled = 0;
    this.stats.stallRecycled = 0;
    this.contacts.clear();
    this.stats.invalidTransitions = 0;
    this.stats.rejections = {};
  }
}
