import { wrapAngle, clamp } from '../core/math';
import { rightFromYaw } from '../core/coordinates';
import type { InputState, VehicleState } from '../core/types';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { AI_CONFIG } from '../config/aiConfig';
import { computeMaxSteerAngle } from '../simulation/vehicle';
import type { GroundBox } from '../simulation/obb';
import { isLaneChange, laneSample, nearestOnLane, successorOf, type LaneGraph, type LanePath } from '../traffic/laneGraph';

/*
 * Opponent AI controller (Part 4). Outputs the same input fields as the player (steer, throttle, brake). It drives the
 * shared vehicle model through those inputs, so it has no separate physics. Pure: it reads the state and the lane
 * graph, and returns a decision. It never writes to the simulation.
 *
 * Path following: pure pursuit on the route, with a speed-based look-ahead. The route is the lane chain (successors),
 * so it is deterministic. Speed: the lane limit, the curvature ahead, and any obstacle on the route.
 */

/** An obstacle the AI can see: any vehicle box on the road. */
export interface AiObstacle {
  /** Unique key, such as `traffic:3`, `player`, or `opp:1`. A vehicle never treats its own key as an obstacle. */
  key: string;
  box: GroundBox;
  speedMps: number;
}

export type AiState = 'follow' | 'brake' | 'recover' | 'lost';

/** The obstacle key of the player's car. Shared by the simulation (which builds it) and the pursuit (which exempts it). */
export const PLAYER_OBSTACLE_KEY = 'player';

export interface AiDecision {
  input: InputState;
  state: AiState;
  laneId: string;
  s: number;
  /** Lateral distance from the lane centre, meters. Positive is right of the lane. */
  lateralErrorMeters: number;
  targetSpeedMps: number;
  /** Route point the AI is steering toward. */
  target: { x: number; z: number };
  /** Gap to the nearest obstacle on the route, meters, or null when the route is clear. */
  obstacleGapMeters: number | null;
}

interface RoutePoint {
  x: number;
  z: number;
  heading: number;
  laneId: string;
  s: number;
  lane: LanePath;
}

/** True when (x, z) is inside the box, with the box's half width widened by `margin`. */
function pointInBox(x: number, z: number, box: GroundBox, margin: number): boolean {
  const dx = x - box.cx;
  const dz = z - box.cz;
  const along = dx * box.fx + dz * box.fz;
  const across = dx * box.rx + dz * box.rz;
  return Math.abs(along) <= box.halfLengthMeters && Math.abs(across) <= box.halfWidthMeters + margin;
}

/** Which lane comes next on the route. Defaults to the graph's successor, which is what traffic uses. */
export type NextLaneOf = (lane: LanePath) => string | undefined;

/**
 * The driving rules a driver follows. Traffic and race rivals use the defaults, which are the AI_CONFIG values. Pursuing
 * police replace them (see PURSUIT_CONFIG.drive): they do not stop for traffic, they corner at their own limit, and they
 * do not ease off when they lose the line.
 */
export interface AiDriverRules {
  /** Whether obstacles on the route (traffic, other units) slow or stop the driver. */
  respectObstacles: boolean;
  /** Lateral acceleration the driver allows in a curve, m/s^2. Sets the curve speed. */
  curveLateralAccelMps2: number;
  /** Whether the driver crawls, and eases off, when it is lost or well off the line. */
  easeWhenLost: boolean;
}

export const DEFAULT_AI_DRIVER_RULES: AiDriverRules = {
  respectObstacles: true,
  curveLateralAccelMps2: AI_CONFIG.curveLateralAccelMps2,
  easeWhenLost: true,
};

/** Optional route policy for a driver. Races pass the event's route and a pace cap. Traffic passes nothing. */
export interface AiDriverPolicy {
  /** Next lane on the route. A race uses its route map, and falls back to the graph beyond the route. */
  nextLaneOf?: NextLaneOf;
  /** Target speed cap, m/s. When set, it replaces the lane speed limit as the cruise target. */
  speedCapMps?: number | null;
  /** Driving rules. Absent means the defaults (traffic and races). */
  rules?: AiDriverRules | null;
}

/** A point `distance` meters further along the route from (laneId, s). Null if the route ends. */
function routePointAt(graph: LaneGraph, laneId: string, s: number, distance: number, nextOf: NextLaneOf): RoutePoint | null {
  let lane = graph.byId.get(laneId);
  let at = s;
  let remaining = distance;
  for (let hop = 0; lane && hop < 32; hop += 1) {
    const available = lane.lengthMeters - at;
    if (remaining <= available) {
      const pose = laneSample(lane, at + remaining);
      return { x: pose.x, z: pose.z, heading: pose.heading, laneId: lane.id, s: at + remaining, lane };
    }
    remaining -= available;
    const next = nextOf(lane);
    const successor = next !== undefined ? graph.byId.get(next) : undefined;
    if (successor && isLaneChange(lane, successor)) {
      // A lane change at this lane's end: the route goes on along the neighbour, at the same place along the road.
      const end = laneSample(lane, lane.lengthMeters);
      lane = successor;
      at = nearestOnLane(successor, end.x, end.z)?.s ?? 0;
      continue;
    }
    lane = successor;
    at = 0;
  }
  return null;
}

export class AiDriver {
  private laneId: string;
  private s: number;
  /** A lane change asked for by the caller, applied on the next step if it is a neighbour of the current lane. */
  private pendingLane: string | null = null;
  private nextOf: NextLaneOf;
  private speedCap: number | null;
  private rules: AiDriverRules;

  constructor(private readonly graph: LaneGraph, startLaneId: string, startS: number, policy: AiDriverPolicy = {}) {
    if (!graph.byId.has(startLaneId)) throw new Error(`AI start lane ${startLaneId} is not in the graph`);
    this.laneId = startLaneId;
    this.s = startS;
    this.nextOf = policy.nextLaneOf ?? successorOf;
    this.speedCap = policy.speedCapMps ?? null;
    this.rules = policy.rules ?? DEFAULT_AI_DRIVER_RULES;
  }

  /** Current route position, for diagnostics and tests. */
  get route(): { laneId: string; s: number } {
    return { laneId: this.laneId, s: this.s };
  }

  /** The speed cap in force, m/s, or null when the lane limit applies. Diagnostics and tests read it. */
  get capMps(): number | null {
    return this.speedCap;
  }

  /** The driving rules in force. Diagnostics and tests read it. */
  get drivingRules(): AiDriverRules {
    return this.rules;
  }

  /**
   * Replaces the route policy and the speed cap for the following steps. Police use it to re-route. The vehicle keeps
   * its position and speed: a policy change is never a teleport. An absent field falls back to the traffic default.
   */
  setPolicy(policy: AiDriverPolicy): void {
    this.nextOf = policy.nextLaneOf ?? successorOf;
    this.speedCap = policy.speedCapMps ?? null;
    this.rules = policy.rules ?? DEFAULT_AI_DRIVER_RULES;
  }

  /**
   * Changes only the speed cap, keeping the route and the rules. A race uses it to set a rival's pace from its place,
   * as the standings change. Null removes the cap (the lane limit applies).
   */
  setSpeedCap(capMps: number | null): void {
    this.speedCap = capMps;
  }

  /** Re-anchors the driver on the route. Used when a vehicle is spawned or recycled. */
  reset(laneId: string, s: number): void {
    this.laneId = laneId;
    this.s = s;
    this.pendingLane = null;
  }

  /**
   * Asks the driver to change to a neighbouring lane (the same road, on the other lane index) on its next step. The
   * driver moves there at its own position along the road. Any other lane is ignored.
   */
  requestLaneChange(laneId: string): void {
    this.pendingLane = laneId;
  }

  decide(state: VehicleState, obstacles: readonly AiObstacle[]): AiDecision {
    this.localise(state);
    const lane = this.graph.byId.get(this.laneId);
    const speed = state.speed;
    const lateral = this.signedLateral(state);
    const absLateral = Math.abs(lateral);

    // Pure pursuit toward a look-ahead point on the route.
    const lookahead = AI_CONFIG.lookaheadBaseMeters + AI_CONFIG.lookaheadPerSpeedSeconds * Math.max(0, speed);
    const target = routePointAt(this.graph, this.laneId, this.s, lookahead, this.nextOf);
    const aim = target ?? { x: state.position.x, z: state.position.z };
    const bearing = Math.atan2(aim.x - state.position.x, aim.z - state.position.z);
    const alpha = wrapAngle(bearing - state.yaw);
    const distance = Math.hypot(aim.x - state.position.x, aim.z - state.position.z);
    const curvature = distance > 1e-6 ? (2 * Math.sin(alpha)) / distance : 0;
    const steerAngle = Math.atan(curvature * VEHICLE_CONFIG.wheelbaseMeters);
    const maxAngle = computeMaxSteerAngle(speed, VEHICLE_CONFIG);
    const steer = clamp(steerAngle / Math.max(maxAngle, 1e-6), -1, 1);

    // Speed target: lane limit, curve limit ahead, and the nearest obstacle on the route.
    // A race caps the pace at the event's opponent speed. Traffic keeps the lane limit.
    let targetSpeed = this.speedCap ?? lane?.speedLimitMps ?? 0;
    const curveLimit = this.curveSpeedLimit();
    targetSpeed = Math.min(targetSpeed, curveLimit);

    const obstacleGap = this.rules.respectObstacles ? this.obstacleGap(obstacles) : null;
    if (obstacleGap !== null) {
      if (obstacleGap <= AI_CONFIG.stopGapMeters) {
        targetSpeed = 0;
      } else {
        const brakeSpeed = Math.sqrt(2 * AI_CONFIG.obstacleBrakeMps2 * (obstacleGap - AI_CONFIG.stopGapMeters));
        targetSpeed = Math.min(targetSpeed, brakeSpeed);
      }
    }

    // A driver whose rules do not ease off keeps its target speed. Pure pursuit still steers it back to the route.
    let aiState: AiState = 'follow';
    if (this.rules.easeWhenLost && absLateral > AI_CONFIG.lostLateralMeters) {
      // Lost: crawl, so pure pursuit can steer back to the route. A full stop here left the car parked on the route.
      aiState = 'lost';
      targetSpeed = Math.min(targetSpeed, AI_CONFIG.lostCrawlMps);
    } else if (this.rules.easeWhenLost && absLateral > AI_CONFIG.recoverLateralMeters) {
      aiState = 'recover';
      targetSpeed *= 0.7;
    } else if (obstacleGap !== null && obstacleGap < AI_CONFIG.stopGapMeters * 3) {
      aiState = 'brake';
    }

    const { throttle, brake } = this.speedControl(speed, targetSpeed);
    return {
      input: { steer, throttle, brake, handbrake: 0 },
      state: aiState,
      laneId: this.laneId,
      s: this.s,
      lateralErrorMeters: lateral,
      targetSpeedMps: targetSpeed,
      target: { x: aim.x, z: aim.z },
      obstacleGapMeters: obstacleGap,
    };
  }

  /** Finds the nearest point on the current lane or its successor, and moves the route position there. */
  private localise(state: VehicleState): void {
    const current = this.graph.byId.get(this.laneId);
    if (!current) return;
    // A lane change is taken at once: the requested lane, or the route's next lane when that is a neighbour on the same
    // road. The car's own position picks the place along the new lane, so the car steers across to it.
    const requested = this.pendingLane !== null ? this.graph.byId.get(this.pendingLane) : undefined;
    this.pendingLane = null;
    if (requested && isLaneChange(current, requested)) {
      this.changeOnto(requested, state);
      return;
    }
    const next = this.nextOf(current);
    const wanted = next !== undefined ? this.graph.byId.get(next) : undefined;
    if (wanted && isLaneChange(current, wanted)) {
      this.changeOnto(wanted, state);
      return;
    }
    const here = nearestOnLane(current, state.position.x, state.position.z);
    const successor = wanted;
    const there = successor ? nearestOnLane(successor, state.position.x, state.position.z) : null;
    // Hysteresis: the successor wins only when it is clearly nearer, and the car has passed the lane end.
    if (here && there && successor && there.distance + 0.5 < here.distance && here.s > current.lengthMeters - 8) {
      this.laneId = successor.id;
      this.s = there.s;
    } else if (here) {
      this.s = here.s;
    }
  }

  private changeOnto(lane: LanePath, state: VehicleState): void {
    this.laneId = lane.id;
    this.s = nearestOnLane(lane, state.position.x, state.position.z)?.s ?? this.s;
  }

  private signedLateral(state: VehicleState): number {
    const lane = this.graph.byId.get(this.laneId);
    if (!lane) return 0;
    const pose = laneSample(lane, this.s);
    const right = rightFromYaw(pose.heading);
    return (state.position.x - pose.x) * right.x + (state.position.z - pose.z) * right.z;
  }

  /**
   * Speed limit from the sharpest curvature ahead: v = sqrt(a_lat / kappa). Curvature is the heading change over each
   * short arc along the route, so a tight junction turn is not averaged away by a long sensing window.
   */
  private curveSpeedLimit(): number {
    const arc = AI_CONFIG.curvatureArcMeters;
    let maxCurvature = 0;
    let previous = routePointAt(this.graph, this.laneId, this.s, 0, this.nextOf);
    for (let distance = arc; distance <= AI_CONFIG.sensingDistanceMeters + arc; distance += arc) {
      const next = routePointAt(this.graph, this.laneId, this.s, distance, this.nextOf);
      if (!previous || !next) break;
      const curvature = Math.abs(wrapAngle(next.heading - previous.heading)) / arc;
      if (curvature > maxCurvature) maxCurvature = curvature;
      previous = next;
    }
    if (maxCurvature < 1e-4) return Number.POSITIVE_INFINITY;
    return Math.sqrt(this.rules.curveLateralAccelMps2 / maxCurvature);
  }

  /**
   * Gap to the nearest obstacle on the route, measured from the nose. Walks the route in 1 m steps, and stops at the
   * first route point inside an obstacle widened by the corridor. The nose reaches that point after `distance - nose`.
   */
  private obstacleGap(obstacles: readonly AiObstacle[]): number | null {
    if (obstacles.length === 0) return null;
    const noseMeters = VEHICLE_CONFIG.footprintFrontMeters;
    const corridor = AI_CONFIG.obstacleCorridorHalfWidthMeters;
    for (let distance = 0; distance <= AI_CONFIG.sensingDistanceMeters; distance += 1) {
      const point = routePointAt(this.graph, this.laneId, this.s, distance, this.nextOf);
      if (!point) break;
      for (const obstacle of obstacles) {
        if (pointInBox(point.x, point.z, obstacle.box, corridor)) return Math.max(0, distance - noseMeters);
      }
    }
    return null;
  }

  /** Throttle and brake to reach the target speed, with a deadband so the pedals do not chatter. */
  private speedControl(speed: number, target: number): { throttle: number; brake: number } {
    const error = target - speed;
    const band = AI_CONFIG.speedDeadbandMps;
    // Stopped with a zero target: release both pedals. Holding the brake at standstill engages reverse in the vehicle
    // model, so the AI must never hold it here. Rolling resistance keeps the car at rest.
    if (target <= 0.01 && speed < 0.5) return { throttle: 0, brake: 0 };
    if (error > band) return { throttle: clamp(AI_CONFIG.holdThrottle + error * AI_CONFIG.throttleGainPerMps, 0, 1), brake: 0 };
    if (error < -band) return { throttle: 0, brake: clamp(-error * AI_CONFIG.brakeGainPerMps, 0, 1) };
    return { throttle: clamp(AI_CONFIG.holdThrottle, 0, 1), brake: 0 };
  }
}
