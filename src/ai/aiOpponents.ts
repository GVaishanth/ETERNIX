import type { InputState, VehicleState } from '../core/types';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { createVehicleState, stepVehicle } from '../simulation/vehicle';
import { configOnSegment } from '../simulation/surfaceModel';
import { groundBoxFromPose, groundBoxOverlap, type GroundBox } from '../simulation/obb';
import { constrainVehicleToRoad, type ConstraintFootprint, type RoadBoundary } from '../simulation/roadBoundary';
import { applyVehicleContact, vehicleVelocity } from '../simulation/vehicleContact';
import { laneSample, type LaneGraph } from '../traffic/laneGraph';
import { roadElevationFor, slopeAccelerationUnder, standOnRoad, type RoadElevation } from '../world/roadElevation';
import { ContactLog } from '../traffic/contactLog';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { AI_CONFIG } from '../config/aiConfig';
import { findTrafficType, trafficDimensions, type TrafficTypeId } from '../traffic/trafficTypes';
import { AiDriver, type AiDecision, type AiDriverPolicy, type AiObstacle } from './aiController';

/*
 * Opponent vehicles (Part 4, step 9). Each opponent is a driven car. It runs the same stepVehicle model as the player,
 * with inputs from its AI controller, and the same road constraint. Opponents have their own state and footprint, and
 * they do not duplicate the player's code path. Only the input source differs.
 *
 * Handling: all opponents use the player's handling config (VEHICLE_CONFIG). Collision size and the model come from
 * the opponent's type. This is a known simplification: per-type handling is a later step.
 */

export interface OpponentSpec {
  typeId: TrafficTypeId;
  laneId: string;
  s: number;
  speedMps: number;
  colourIndex: number;
  /** Target speed cap for the AI, m/s. Null keeps the lane limit (traffic). Races set it from the event. */
  speedCapMps?: number | null;
  /**
   * Whether a stalled opponent may be teleported back to its spawn. Traffic-style opponents are recyclable. Race
   * opponents are not: a teleport would be an unfair jump in a race, so they stay where they are. Defaults to true.
   */
  recyclable?: boolean;
  /**
   * Whether a long stop behind an obstacle may be released (ignored for a short window). Race opponents are released.
   * Police are not: their stops are handled by the pursuit (re-route, then removal), never by ignoring a car. Defaults to true.
   */
  releasable?: boolean;
}

/** Contact kinds this system records. Traffic uses opponent kinds; police use their own, so the logs stay separate. */
export interface OpponentContactKinds {
  traffic: 'opponent-traffic' | 'police-traffic';
  player: 'opponent-player' | 'police-player';
  boundary: 'opponent-boundary' | 'police-boundary';
}

export const OPPONENT_CONTACT_KINDS: OpponentContactKinds = {
  traffic: 'opponent-traffic',
  player: 'opponent-player',
  boundary: 'opponent-boundary',
};

export const POLICE_CONTACT_KINDS: OpponentContactKinds = {
  traffic: 'police-traffic',
  player: 'police-player',
  boundary: 'police-boundary',
};

/** Opponent-wide options. Races pass their route's successor map here. */
export interface OpponentSystemOptions {
  nextLaneOf?: AiDriverPolicy['nextLaneOf'];
  /** Contact kinds for this system's contacts. Defaults to the opponent kinds. */
  contactKinds?: OpponentContactKinds;
}

/**
 * Per-step input override for an opponent. Returns the input to use instead of the AI's decision, or null to keep the
 * AI's decision. The override goes through the same vehicle model; it never sets the car's transform.
 */
export type OpponentInputOverride = (opponent: AiOpponent) => InputState | null;

export interface AiOpponent {
  /** Segment the car was last constrained to. Null before the first constraint. Selects the surface for the next step. */
  roadSegment?: string | null;
  /** Stable index, 0..n-1. Used for ids and contact labels. */
  id: number;
  typeId: TrafficTypeId;
  colourIndex: number;
  state: VehicleState;
  driver: AiDriver;
  decision: AiDecision | null;
  footprint: ConstraintFootprint;
  spec: OpponentSpec;
  /** Seconds spent stopped with the AI holding for an obstacle. Drives the recycle rule. */
  stalledSeconds: number;
  /** Seconds left in a race release window, during which the opponent ignores obstacles. Zero otherwise. */
  releaseSeconds: number;
  /** The input applied on the last step (after any override). Diagnostics only. */
  lastInput: InputState | null;
  /** Where the last input came from: the AI decision, or the race override. Diagnostics only. */
  lastSource: 'ai' | 'override';
  /** A retired opponent has left the race (it finished). It is not stepped, not an obstacle, and not drawn. */
  retired: boolean;
}

/** Spawn state for one opponent, on its lane at its start position. */
function spawnStateFor(graph: LaneGraph, spec: OpponentSpec): VehicleState {
  const lane = graph.byId.get(spec.laneId);
  if (!lane) throw new Error(`Opponent lane ${spec.laneId} is not in the graph`);
  const pose = laneSample(lane, spec.s);
  const state = createVehicleState({ x: pose.x, y: pose.y, z: pose.z }, pose.heading);
  return { ...state, speed: spec.speedMps };
}

function footprintFor(typeId: TrafficTypeId): ConstraintFootprint {
  const dims = trafficDimensions(findTrafficType(typeId));
  return {
    rearMeters: dims.rearMeters,
    frontMeters: dims.noseMeters,
    halfWidthMeters: dims.halfWidthMeters,
    tangentialRetentionPerStep: VEHICLE_CONFIG.wallTangentialRetentionPerStep,
  };
}

export class OpponentSystem {
  readonly opponents: AiOpponent[];
  /** Number of stall recycles since creation or the last reset. Diagnostics only. */
  recycles = 0;
  /** Opponent contacts, recorded once per event. Read by diagnostics and tests. */
  readonly contacts = new ContactLog(TRAFFIC_CONFIG.collision.eventLogCapacity);
  private readonly graph: LaneGraph;
  private readonly boundary: RoadBoundary | null;
  private readonly specs: OpponentSpec[];
  private readonly options: OpponentSystemOptions;
  /** Road height and grade for this graph. Shared with every other host that uses it. */
  private readonly elevation: RoadElevation;
  readonly contactKinds: OpponentContactKinds;
  private inputOverride: OpponentInputOverride | null = null;
  /** Per unit: the key of one obstacle the unit does not treat as an obstacle (null for none). Set by the pursuit. */
  private readonly exemptKeys: Array<string | null>;

  constructor(graph: LaneGraph, boundary: RoadBoundary | null, specs: readonly OpponentSpec[], options: OpponentSystemOptions = {}) {
    this.graph = graph;
    this.boundary = boundary;
    this.specs = [...specs];
    this.options = options;
    this.elevation = roadElevationFor(graph);
    this.contactKinds = options.contactKinds ?? OPPONENT_CONTACT_KINDS;
    this.opponents = this.specs.map((spec, id) => this.createOpponent(id, spec));
    this.exemptKeys = this.specs.map(() => null);
  }

  /**
   * Stops one unit treating the obstacle with `key` as an obstacle. A pursuing unit exempts the player, since the
   * player is its target: without it the unit brakes behind the player and never reaches it. Contacts still apply, so
   * the unit is pushed apart from the player and never moves through it. Null restores the normal rule.
   */
  setObstacleExemption(id: number, key: string | null): void {
    if (id < 0 || id >= this.exemptKeys.length) return;
    this.exemptKeys[id] = key;
  }

  /**
   * Replaces one unit's spec and re-creates it at the spec's lane and position, active. Used by the pursuit to deploy a
   * unit at a validated spawn. It is a placement, not a drive, so it is only called after a spawn check has passed.
   */
  place(id: number, spec: OpponentSpec): void {
    if (!this.specs[id]) throw new Error(`Opponent ${id} does not exist`);
    this.specs[id] = spec;
    this.opponents[id] = this.createOpponent(id, spec);
    this.exemptKeys[id] = null;
  }

  /** Sets a unit's route policy and speed cap. The unit keeps its position and speed. */
  setDriverPolicy(id: number, policy: AiDriverPolicy): void {
    this.opponents[id]?.driver.setPolicy(policy);
  }

  /** Sets only a unit's speed cap (null removes it). The route and rules stay. Races re-pace rivals with it. */
  setSpeedCap(id: number, capMps: number | null): void {
    this.opponents[id]?.driver.setSpeedCap(capMps);
  }

  /** The spec a unit was last placed with. */
  specOf(id: number): OpponentSpec | undefined {
    return this.specs[id];
  }

  /** Sets (or clears, with null) the per-step input override. Races use it for the grid hold and the finish stop. */
  setInputOverride(override: OpponentInputOverride | null): void {
    this.inputOverride = override;
  }

  private createOpponent(id: number, spec: OpponentSpec): AiOpponent {
    return {
      id,
      typeId: spec.typeId,
      colourIndex: spec.colourIndex,
      state: spawnStateFor(this.graph, spec),
      driver: new AiDriver(this.graph, spec.laneId, spec.s, { nextLaneOf: this.options.nextLaneOf, speedCapMps: spec.speedCapMps ?? null }),
      decision: null,
      footprint: footprintFor(spec.typeId),
      spec,
      stalledSeconds: 0,
      releaseSeconds: 0,
      lastInput: null,
      lastSource: 'ai',
      retired: false,
    };
  }

  /** Restores every opponent to its spawn state. Used by the development reset. */
  reset(): void {
    for (let i = 0; i < this.opponents.length; i += 1) {
      const spec = this.specs[i];
      if (!spec) continue;
      this.opponents[i] = this.createOpponent(i, spec);
    }
    this.recycles = 0;
  }

  /** Ground box of an opponent, from its state and its type's dimensions. */
  boxOf(opponent: AiOpponent): GroundBox {
    const { rearMeters, frontMeters, halfWidthMeters } = opponent.footprint;
    return groundBoxFromPose(opponent.state.position.x, opponent.state.position.z, opponent.state.yaw, rearMeters, frontMeters, halfWidthMeters);
  }

  /**
   * One fixed step for every opponent: decide, then integrate with the shared vehicle model, then the road constraint.
   * `obstacles` is every other body on the road (traffic and the player). Opponents are never their own obstacles.
   */
  /** Removes an opponent from the system: it stops taking part in driving, contacts, and obstacles. Not drawn. */
  retire(id: number): void {
    const opponent = this.opponents[id];
    if (opponent) opponent.retired = true;
  }

  /** True when the unit is taking part (not retired). */
  isActive(id: number): boolean {
    const opponent = this.opponents[id];
    return opponent !== undefined && !opponent.retired;
  }

  integrate(dtSeconds: number, obstacles: readonly AiObstacle[]): void {
    for (const opponent of this.opponents) {
      if (opponent.retired) continue;
      const recyclable = opponent.spec.recyclable !== false;
      if (recyclable && opponent.stalledSeconds >= TRAFFIC_CONFIG.obstacle.stallRecycleSeconds && this.spawnIsClear(opponent, obstacles)) {
        // A queue behind a stopped obstacle must not last forever. The recycle uses the same stall time as traffic.
        this.recycle(opponent);
      }
      const releasable = opponent.spec.releasable !== false;
      if (!recyclable && releasable && opponent.releaseSeconds <= 0 && opponent.stalledSeconds >= AI_CONFIG.raceReleaseStallSeconds) {
        // A race opponent cannot be recycled, so a long stop behind an obstacle is released for a short window.
        opponent.releaseSeconds = AI_CONFIG.raceReleaseWindowSeconds;
        opponent.stalledSeconds = 0;
      }
      const released = opponent.releaseSeconds > 0;
      if (released) opponent.releaseSeconds = Math.max(0, opponent.releaseSeconds - dtSeconds);
      const exempt = this.exemptKeys[opponent.id] ?? null;
      const visible = exempt === null ? obstacles : obstacles.filter((obstacle) => obstacle.key !== exempt);
      const seen = released ? [] : visible.concat(this.opponentObstacles(opponent.id));
      const decision = opponent.driver.decide(opponent.state, seen);
      opponent.decision = decision;
      // An override replaces the AI's pedals for this step (grid hold, or a stop after the finish). The AI still decides.
      const overridden = this.inputOverride?.(opponent) ?? null;
      const input: InputState = overridden ?? decision.input;
      opponent.lastInput = input;
      opponent.lastSource = overridden ? 'override' : 'ai';
      // The slope under the unit at the start of the step. The same model as the player's car.
      const onSurface = configOnSegment(VEHICLE_CONFIG, this.boundary, opponent.roadSegment ?? null);
      let next = stepVehicle(opponent.state, input, onSurface, dtSeconds, slopeAccelerationUnder(opponent.state, this.elevation));
      next = standOnRoad(this.constrain(next, opponent), this.elevation);
      opponent.state = next;
      const stopped = Math.abs(opponent.state.speed) < TRAFFIC_CONFIG.obstacle.stoppedSpeedMps;
      const waiting = decision.obstacleGapMeters !== null || decision.state === 'brake';
      // A race opponent that wants to move but is stopped (for any reason, such as a body in contact) counts as stalled too.
      const wantsToMove = !recyclable && decision.targetSpeedMps > 0.5;
      opponent.stalledSeconds = stopped && (waiting || wantsToMove) ? opponent.stalledSeconds + dtSeconds : 0;
    }
  }

  /** Puts one opponent back at its spawn. The spawn is only used after spawnIsClear has passed. */
  private recycle(opponent: AiOpponent): void {
    this.opponents[opponent.id] = this.createOpponent(opponent.id, opponent.spec);
    this.recycles += 1;
  }

  /**
   * True when the spawn pose is free of the other bodies and at least the clearance distance from the player.
   * The player is the first entry in the obstacle list, with key 'player'.
   */
  private spawnIsClear(opponent: AiOpponent, obstacles: readonly AiObstacle[]): boolean {
    const probe = spawnStateFor(this.graph, opponent.spec);
    const dims = footprintFor(opponent.spec.typeId);
    const box = groundBoxFromPose(probe.position.x, probe.position.z, probe.yaw, dims.rearMeters, dims.frontMeters, dims.halfWidthMeters);
    for (const obstacle of obstacles) {
      if (groundBoxOverlap(box, obstacle.box).overlapping) return false;
      if (obstacle.key === 'player') {
        const distance = Math.hypot(obstacle.box.cx - box.cx, obstacle.box.cz - box.cz);
        if (distance < AI_CONFIG.recycleClearanceMeters) return false;
      }
    }
    for (const other of this.opponents) {
      if (other.id === opponent.id) continue;
      if (groundBoxOverlap(box, this.boxOf(other)).overlapping) return false;
    }
    return true;
  }

  /** Other opponents, as obstacles for one opponent. */
  private opponentObstacles(selfId: number): AiObstacle[] {
    return this.opponents
      .filter((other) => other.id !== selfId && !other.retired)
      .map((other) => ({ key: `opp:${other.id}`, box: this.boxOf(other), speedMps: other.state.speed }));
  }

  /** Applies a contact correction to an opponent, then runs the road constraint again. */
  applyContact(opponent: AiOpponent, push: { x: number; z: number }, normal: { x: number; z: number }, otherVelocity: { x: number; z: number }): void {
    const next = applyVehicleContact(opponent.state, push, normal, otherVelocity);
    opponent.state = this.constrain(next, opponent);
  }

  /** Ground velocity of an opponent. */
  velocityOf(opponent: AiOpponent): { x: number; z: number } {
    return vehicleVelocity(opponent.state);
  }

  /** Ends the contact step for the opponents' log. Call once per fixed step. */
  endContactStep(): void {
    this.contacts.endStep();
  }

  private constrain(state: VehicleState, opponent: AiOpponent): VehicleState {
    if (!this.boundary) return state;
    const constrained = constrainVehicleToRoad(state, this.boundary, opponent.footprint);
    opponent.roadSegment = constrained.segmentId;
    if (constrained.contact) this.contacts.touch(this.contactKinds.boundary, `opp:${opponent.id}`, null);
    return constrained.state;
  }
}
