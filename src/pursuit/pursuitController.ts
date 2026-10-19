import type { InputState, VehicleState } from '../core/types';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { lockedDriveInput, startRamLockout, tickRamLockout } from './ramLockout';
import { POLICE_CONTACT_KINDS, OpponentSystem, type OpponentSpec } from '../ai/aiOpponents';
import type { PursuitStepHost } from '../engine/gameSimulation';
import type { GroundBox } from '../simulation/obb';
import type { RoadBoundary } from '../simulation/roadBoundary';
import { laneSample, successorOf, type LaneGraph } from '../traffic/laneGraph';
import type { TrafficSystem } from '../traffic/trafficSystem';
import { boxAt, chooseDeployment, type DeployCandidate, type DeployFootprint, type DeployRules } from './deployment';
import { LaneRouter, type LaneHit } from './policeRouting';
import { chaseAimPoint } from './chaseAim';
import type { AiDriverRules } from '../ai/aiController';
import { PursuitSession, type OffenceResult, type SessionInput } from './pursuitSession';
import { canSee } from './sight';
import { PLAYER_OBSTACLE_KEY } from '../ai/aiController';
import { isEngagedState } from './pursuitStateMachine';
import type { OffenceKind, PursuitEndReason, PursuitSnapshot, UnitRole } from './pursuitTypes';
import { usePursuitStore } from '../state/pursuitStore';
import { baseImage, imageNear } from '../world/wrap/worldWrap';

/*
 * Police pursuit controller (Part 7). The bridge between the pure session and the shared AI vehicle movement.
 *
 *  - Owns the police pool: a fixed number of OpponentSystem units, reused, never created during play.
 *  - Judges offences from what patrols see (speeding over the lane limit; collisions with traffic), and reports them to
 *    the session. A witnessed offence is the only way a pursuit starts.
 *  - Assigns each unit a role from the session state, and plans its route over the lane graph on a timer, not per frame.
 *  - Runs stuck handling: a unit that stops making progress is re-planned once, then removed. Units are never teleported
 *    toward the player; they only ever move through the shared vehicle model and the AI controller.
 *  - Is suspended while a race is on: the police are not stepped, judged, or drawn, and no session advances.
 *
 * It implements the simulation's PursuitStepHost. The simulation calls afterStep() once per fixed step, after the
 * player's state is final, and onPlayerReset() when the player is reset.
 */

/** Per unit state the controller keeps. Plain data, reset on placement. */
interface UnitRecord {
  role: UnitRole;
  /** Next-lane map of the current plan, or null when there is no plan. */
  routeNext: Map<string, string> | null;
  /** Lane indices of the current plan. Used to give an intercept unit a different approach. */
  routeLanes: number[];
  planTarget: { x: number; z: number } | null;
  planAgeSeconds: number;
  stuckSeconds: number;
  /** The speed cap last given to this unit's driver while it pursues. Null while on patrol. Read by diagnostics. */
  capMps: number | null;
  replannedWhileStuck: boolean;
  routeFailed: boolean;
}

/** One unit as the renderer reads it. Written in place each frame, so no allocation per frame. */
export interface PoliceVisualUnit {
  id: number;
  active: boolean;
  typeId: 'sedan';
  x: number;
  /** Height of the road under the unit, metres. */
  y: number;
  z: number;
  heading: number;
  lightsOn: boolean;
}

/** Diagnostic counters and per-unit detail for the DEV surface. Read only. */
export interface PursuitDiagnostics {
  witnessId: number | null;
  /** The last offence the controller judged itself (not reported from outside), and how many it has judged. */
  lastOffence: OffenceKind | null;
  judgedOffences: number;
  deployments: number;
  deployPostponed: number;
  planFailures: number;
  stuckReplans: number;
  stuckRemovals: number;
  patrolRespawns: number;
  rejectedTransitions: number;
  playerLane: string | null;
  units: Array<{
    id: number;
    active: boolean;
    role: UnitRole;
    /** The light bar is on: active, engaged, and not suspended. Same rule as visualUnits(). */
    lightsOn: boolean;
    x: number;
    z: number;
    yaw: number;
    laneId: string | null;
    speedMps: number;
    routeLanes: number;
    planAgeSeconds: number;
    stuckSeconds: number;
    routeFailed: boolean;
    targetDistanceMeters: number | null;
    capMps: number | null;
  }>;
}

export interface PursuitControllerOptions {
  graph: LaneGraph;
  boundary: RoadBoundary | null;
  traffic: TrafficSystem | null;
  /** Footprint of the player, for the deployment overlap checks. */
  playerFootprint: DeployFootprint;
  /** Where the player starts. Patrols are placed relative to it at construction. */
  spawn: { x: number; z: number; yaw: number };
  /** Called when a pursuit ends, with the reason. Optional. The career uses it to count escapes. */
  onSessionEnd?: (reason: PursuitEndReason) => void;
}

function patrolRules(): DeployRules {
  return {
    minDistanceMeters: PURSUIT_CONFIG.patrolSpawnMinMeters,
    maxDistanceMeters: PURSUIT_CONFIG.patrolSpawnMaxMeters,
    preferredDistanceMeters: (PURSUIT_CONFIG.patrolSpawnMinMeters + PURSUIT_CONFIG.patrolSpawnMaxMeters) / 2,
    forbiddenAheadRadians: degrees(PURSUIT_CONFIG.deploy.forbiddenAheadDegrees),
    preferredOutOfViewRadians: degrees(PURSUIT_CONFIG.deploy.preferredOutOfViewDegrees),
    clearanceMeters: PURSUIT_CONFIG.deploy.clearanceMeters,
    sampleStepMeters: PURSUIT_CONFIG.deploy.sampleStepMeters,
  };
}

function deployRules(): DeployRules {
  return {
    minDistanceMeters: PURSUIT_CONFIG.deploy.minDistanceMeters,
    maxDistanceMeters: PURSUIT_CONFIG.deploy.maxDistanceMeters,
    preferredDistanceMeters: PURSUIT_CONFIG.deploy.preferredDistanceMeters,
    forbiddenAheadRadians: degrees(PURSUIT_CONFIG.deploy.forbiddenAheadDegrees),
    preferredOutOfViewRadians: degrees(PURSUIT_CONFIG.deploy.preferredOutOfViewDegrees),
    clearanceMeters: PURSUIT_CONFIG.deploy.clearanceMeters,
    sampleStepMeters: PURSUIT_CONFIG.deploy.sampleStepMeters,
  };
}

/** Frames per HUD publish: at 60 fps this is about 10 Hz. */
const PUBLISH_EVERY_CALLS = 6;

/** The driving rules of a pursuing unit (PURSUIT_CONFIG.drive). A patrol keeps the defaults, which are the traffic rules. */
const PURSUING_RULES: AiDriverRules = {
  respectObstacles: PURSUIT_CONFIG.drive.respectObstacles,
  curveLateralAccelMps2: PURSUIT_CONFIG.drive.curveLateralAccelMps2,
  easeWhenLost: PURSUIT_CONFIG.drive.easeWhenLost,
};

function degrees(value: number): number {
  return (value * Math.PI) / 180;
}

function emptyUnit(role: UnitRole): UnitRecord {
  return { role, routeNext: null, routeLanes: [], planTarget: null, planAgeSeconds: Number.POSITIVE_INFINITY, stuckSeconds: 0, replannedWhileStuck: false, routeFailed: false, capMps: null };
}

/**
 * The speed cap for a pursuing unit: the heat level's cap, never below the unit minimum, times the pursuit multiplier.
 * Pure, so the rule is tested without a session. Traffic and the player never use it.
 */
export function pursuingSpeedCapMps(heatCapMps: number): number {
  return Math.max(PURSUIT_CONFIG.unit.minCapMps, heatCapMps) * PURSUIT_CONFIG.unit.pursuitSpeedMultiplier;
}

export class PursuitController implements PursuitStepHost {
  /** The police system. The simulation steps, contacts, and draws it. */
  readonly police: OpponentSystem;
  readonly session: PursuitSession;
  private readonly graph: LaneGraph;
  private readonly router: LaneRouter;
  private readonly traffic: TrafficSystem | null;
  private readonly footprint: DeployFootprint;
  private readonly spawn: { x: number; z: number; yaw: number };
  /** Loop period, or null. Read from the lanes. Bodies are kept in the base domain; distances use the nearest image. */
  private readonly period: number | null;
  /** Race probe: true while a race is on. Attached after the race exists (see attachRaceProbe). */
  private isRaceBusy: () => boolean = () => false;
  private readonly poolSize: number;
  private readonly patrolSpecs: Array<OpponentSpec | null>;
  private readonly units: UnitRecord[];
  private readonly seen: Uint8Array;
  private readonly visualBuffer: PoliceVisualUnit[];
  private readonly sightConfig = { radiusMeters: PURSUIT_CONFIG.sight.radiusMeters, halfAngleDegrees: PURSUIT_CONFIG.sight.halfAngleDegrees };

  private player: { x: number; z: number; yaw: number; speed: number } = { x: 0, z: 0, yaw: 0, speed: 0 };
  private playerLane: LaneHit | null = null;
  private laneLookupSeconds = 0;
  private overSeconds = 0;
  private captureSeconds = 0;
  private lastContactStep = -1;
  private witnessId: number | null = null;
  private lastJudged: OffenceKind | null = null;
  private judgedCount = 0;
  private patrolRespawnSeconds = 0;
  private suspendedNow = false;
  private stuckRemovalCount = 0;
  private stuckReplanCount = 0;
  private deployCount = 0;
  private deployPostponedCount = 0;
  private planFailureCount = 0;
  private patrolRespawnCount = 0;
  private publishCalls = 0;
  /** Set when a session ends busted, and read once by the simulation (takeBustReset). */
  private bustPending = false;
  /** Seconds left in the ram lockout. While it runs, the simulation brakes the player's car to a stop. */
  private ramLockoutSeconds = 0;
  /** Seconds until another ram may start a lockout. Set when a lockout starts (see PURSUIT_CONFIG.ram.cooldownSeconds). */
  private ramCooldownSeconds = 0;

  constructor(options: PursuitControllerOptions) {
    this.graph = options.graph;
    this.router = new LaneRouter(options.graph);
    this.traffic = options.traffic;
    this.footprint = options.playerFootprint;
    this.spawn = options.spawn;
    this.period = options.graph.lanes.find((lane) => lane.periodMeters !== undefined)?.periodMeters ?? null;
    this.poolSize = PURSUIT_CONFIG.unitPoolSize;
    // A level that wants more units than the pool holds is a configuration error, found at start-up.
    for (const level of PURSUIT_CONFIG.heatLevels) {
      if (level.maxUnits > this.poolSize) throw new Error(`Heat level ${level.level} wants ${level.maxUnits} units, but the pool holds ${this.poolSize}`);
    }
    this.session = new PursuitSession({
      onEnd: (reason) => {
        if (reason === 'busted') this.bustPending = true;
        options.onSessionEnd?.(reason);
      },
    });
    this.units = Array.from({ length: this.poolSize }, () => emptyUnit('patrol'));
    this.seen = new Uint8Array(this.poolSize);
    this.visualBuffer = Array.from({ length: this.poolSize }, (_, id) => ({ id, active: false, typeId: 'sedan' as const, x: 0, y: 0, z: 0, heading: 0, lightsOn: false }));

    // Patrol placement is deterministic, from the spawn. Each patrol is placed outside view, clear of the others.
    const fallbackLane = options.graph.lanes.find((lane) => lane.kind === 'segment');
    if (!fallbackLane) throw new Error('The pursuit needs at least one segment lane');
    const bodies: GroundBox[] = [boxAt(baseImage(this.spawn.x, this.period), baseImage(this.spawn.z, this.period), this.spawn.yaw, this.footprint)];
    this.patrolSpecs = [];
    // Each patrol takes a lane no earlier patrol uses, while one is free, so the patrols spread over the road's lanes.
    const patrolLanes = new Set<string>();
    for (let id = 0; id < this.poolSize; id += 1) {
      const candidate = id < PURSUIT_CONFIG.patrolUnits ? chooseDeployment({ graph: options.graph, player: { x: this.spawn.x, z: this.spawn.z, yaw: this.spawn.yaw }, bodies, footprint: this.footprint, rules: patrolRules(), period: this.period, usedLaneIds: patrolLanes }) : null;
      if (candidate) {
        bodies.push(this.boxFor(candidate.x, candidate.z, candidate.yaw));
        patrolLanes.add(candidate.laneId);
      }
      this.patrolSpecs.push(candidate ? this.specFor(candidate) : null);
    }
    const specs: OpponentSpec[] = this.patrolSpecs.map((spec) => spec ?? this.specFor({ laneId: fallbackLane.id, s: 0 }));
    this.police = new OpponentSystem(options.graph, options.boundary, specs, { contactKinds: POLICE_CONTACT_KINDS });
    for (let id = 0; id < this.poolSize; id += 1) {
      if (!this.patrolSpecs[id]) this.police.retire(id);
    }
  }

  /**
   * Connects the race probe. The race is created after the simulation, so the probe is attached later. While it reports a
   * race, the pursuit is frozen. Pass null to detach.
   */
  attachRaceProbe(probe: (() => boolean) | null): void {
    this.isRaceBusy = probe ?? (() => false);
  }

  /** The pool size. The renderer sizes its visual pool from it. */
  get capacity(): number {
    return this.poolSize;
  }

  /** The step host hook: true while a race freezes the police. */
  isSuspended(): boolean {
    return this.isRaceBusy();
  }

  /** The trigger interface for other systems: reports an offence. It counts only if a patrol sees the player now. */
  reportOffence(kind: OffenceKind): OffenceResult | 'unwitnessed' {
    // A race freezes the pursuit, so an offence reported during a race is refused: racing never starts a pursuit.
    if (this.isRaceBusy()) return 'ignored';
    const witness = this.findWitness();
    if (witness === null) return 'unwitnessed';
    this.witnessId = witness;
    return this.session.reportOffence(kind);
  }

  /**
   * A pursuing unit touched the player (the simulation reports it once per step of contact). A ram during an active
   * pursuit locks driving input for the configured time. It does not end the capture hold.
   */
  onRam(): void {
    if (this.suspendedNow || this.session.currentState === 'INACTIVE') return;
    // A ram during the cooldown is ignored, so continuous contact cannot keep the input locked.
    if (this.ramCooldownSeconds > 0) return;
    this.ramLockoutSeconds = startRamLockout(this.ramLockoutSeconds, PURSUIT_CONFIG.ram.lockoutSeconds);
    this.ramCooldownSeconds = PURSUIT_CONFIG.ram.lockoutSeconds + PURSUIT_CONFIG.ram.cooldownSeconds;
  }

  /** The player's input for this step. Locked by a ram, it brakes the car and ignores the keys. Never locks in a race. */
  driveInput(frameInput: InputState): InputState {
    if (this.ramLockoutSeconds <= 0 || this.isRaceBusy()) return frameInput;
    return lockedDriveInput();
  }

  /** One fixed step, after the player and the police have moved. */
  afterStep(state: VehicleState, dtSeconds: number): void {
    this.ramLockoutSeconds = tickRamLockout(this.ramLockoutSeconds, dtSeconds);
    this.ramCooldownSeconds = tickRamLockout(this.ramCooldownSeconds, dtSeconds);
    this.suspendedNow = this.isRaceBusy();
    if (this.suspendedNow) return;
    this.player = { x: state.position.x, z: state.position.z, yaw: state.yaw, speed: state.speed };
    this.updatePlayerLane(dtSeconds);
    const seenCount = this.perceive();
    this.judgeOffences(dtSeconds);
    this.session.step(dtSeconds, this.sessionInput(seenCount, dtSeconds));
    this.assignRoles(dtSeconds);
    this.updateRouting(dtSeconds);
  }

  /**
   * True once after a session ends busted. The simulation then sends the car back to the spawn. Reading it clears it, so
   * one capture gives one reset.
   */
  takeBustReset(): boolean {
    const pending = this.bustPending;
    this.bustPending = false;
    return pending;
  }

  /** The player was reset (R or DEV). The pursuit ends and every unit returns to its starting state. */
  onPlayerReset(): void {
    this.session.abort('aborted-reset');
    this.ramLockoutSeconds = 0;
    this.ramCooldownSeconds = 0;
    this.witnessId = null;
    this.overSeconds = 0;
    this.captureSeconds = 0;
    this.lastContactStep = this.traffic ? this.traffic.contacts.recent.reduce((max, event) => Math.max(max, event.step), -1) : -1;
    for (let id = 0; id < this.poolSize; id += 1) {
      const spec = this.patrolSpecs[id];
      if (spec) {
        this.police.place(id, spec);
        this.units[id] = emptyUnit('patrol');
      } else {
        this.police.retire(id);
        this.units[id] = emptyUnit('patrol');
      }
    }
    this.patrolRespawnSeconds = 0;
  }

  /** Fills the visual buffer for the renderer. Returns the same array every call. Lights flash only for pursuing units. */
  visualUnits(): readonly PoliceVisualUnit[] {
    const engaged = isEngagedState(this.session.currentState);
    for (let id = 0; id < this.poolSize; id += 1) {
      const out = this.visualBuffer[id]!;
      const opponent = this.police.opponents[id];
      out.active = opponent !== undefined && !opponent.retired && !this.suspendedNow;
      if (!opponent) continue;
      out.x = opponent.state.position.x;
      out.y = opponent.state.position.y;
      out.z = opponent.state.position.z;
      out.heading = opponent.state.yaw;
      out.lightsOn = out.active && engaged && this.units[id]!.role !== 'patrol';
    }
    return this.visualBuffer;
  }

  /**
   * Writes the snapshot to the HUD store at about 10 Hz. Called once per rendered frame. It is never called from the
   * simulation step, so the store causes no work inside the fixed-step loop.
   */
  publish(): void {
    this.publishCalls += 1;
    if (this.publishCalls % PUBLISH_EVERY_CALLS !== 1) return;
    usePursuitStore.getState().setSnapshot(this.snapshot());
  }

  /** The snapshot for the HUD. Plain values. Built on demand; the caller decides how often. */
  snapshot(): PursuitSnapshot {
    const view = this.session.view();
    let pursuing = 0;
    let patrol = 0;
    let idle = 0;
    for (let id = 0; id < this.poolSize; id += 1) {
      if (!this.police.isActive(id)) idle += 1;
      else if (this.units[id]!.role === 'patrol') patrol += 1;
      else pursuing += 1;
    }
    const { noticeText, noticeId, ...rest } = view;
    return {
      ...rest,
      pursuingUnits: pursuing,
      patrolUnits: patrol,
      idleUnits: idle,
      poolSize: this.poolSize,
      captureProgress: Math.min(1, this.captureSeconds / PURSUIT_CONFIG.capture.holdSeconds),
      notice: noticeText !== null ? { text: noticeText, id: noticeId } : null,
    };
  }

  /** Diagnostics for the DEV surface. Allocates; not for the frame loop. */
  diagnostics(): PursuitDiagnostics {
    const target = this.lastTargetFor();
    return {
      witnessId: this.witnessId,
      lastOffence: this.lastJudged,
      judgedOffences: this.judgedCount,
      deployments: this.deployCount,
      deployPostponed: this.deployPostponedCount,
      planFailures: this.planFailureCount,
      stuckReplans: this.stuckReplanCount,
      stuckRemovals: this.stuckRemovalCount,
      patrolRespawns: this.patrolRespawnCount,
      rejectedTransitions: this.session.rejectedTransitions,
      playerLane: this.playerLane ? this.graph.lanes[this.playerLane.laneIndex]?.id ?? null : null,
      units: this.units.map((unit, id) => {
        const opponent = this.police.opponents[id];
        return {
          id,
          active: this.police.isActive(id),
          role: unit.role,
          lightsOn: this.police.isActive(id) && !this.suspendedNow && isEngagedState(this.session.currentState) && unit.role !== 'patrol',
          x: opponent ? opponent.state.position.x : 0,
          z: opponent ? opponent.state.position.z : 0,
          yaw: opponent ? opponent.state.yaw : 0,
          laneId: opponent ? opponent.driver.route.laneId : null,
          speedMps: opponent ? opponent.state.speed : 0,
          capMps: unit.capMps,
          routeLanes: unit.routeLanes.length,
          planAgeSeconds: Number.isFinite(unit.planAgeSeconds) ? unit.planAgeSeconds : -1,
          stuckSeconds: unit.stuckSeconds,
          routeFailed: unit.routeFailed,
          targetDistanceMeters: target && unit.planTarget ? Math.hypot(unit.planTarget.x - target.x, unit.planTarget.z - target.z) : null,
        };
      }),
    };
  }

  /** The point the pursuit is aimed at: the last known position, else the player. Diagnostics only. */
  private lastTargetFor(): { x: number; z: number } {
    return this.session.lastKnownPosition ?? { x: this.player.x, z: this.player.z };
  }

  private updatePlayerLane(dtSeconds: number): void {
    this.laneLookupSeconds -= dtSeconds;
    if (this.laneLookupSeconds > 0) return;
    this.laneLookupSeconds = PURSUIT_CONFIG.trigger.laneLookupSeconds;
    this.playerLane = this.router.nearestLane(
      this.player.x,
      this.player.z,
      this.player.yaw,
      degrees(PURSUIT_CONFIG.routing.laneHeadingToleranceDegrees),
      PURSUIT_CONFIG.routing.laneSearchMaxMeters,
    );
  }

  /** Which units can see the player this step. Fills `seen` and returns the count. Read-only with respect to units. */
  private perceive(): number {
    let count = 0;
    for (let id = 0; id < this.poolSize; id += 1) {
      this.seen[id] = 0;
      const opponent = this.police.opponents[id];
      if (!opponent || opponent.retired) continue;
      if (canSee({ x: opponent.state.position.x, z: opponent.state.position.z, yaw: opponent.state.yaw }, this.player, this.sightConfig, this.period)) {
        this.seen[id] = 1;
        count += 1;
      }
    }
    return count;
  }

  /** A patrol that sees the player now, or null. The first in pool order, so the choice is deterministic. */
  private findWitness(): number | null {
    for (let id = 0; id < this.poolSize; id += 1) {
      if (this.seen[id] === 1 && this.units[id]!.role === 'patrol') return id;
    }
    return null;
  }

  /** Speeding and collision offences, each judged from a witnessing patrol. Reported to the session once per event. */
  private judgeOffences(dtSeconds: number): void {
    const witness = this.findWitness();
    const limit = this.playerLane ? this.graph.lanes[this.playerLane.laneIndex]?.speedLimitMps ?? null : null;
    const over = limit !== null && Math.abs(this.player.speed) > limit * PURSUIT_CONFIG.trigger.speedingFactor;
    if (over && witness !== null) this.overSeconds += dtSeconds;
    else this.overSeconds = 0;
    if (this.overSeconds >= PURSUIT_CONFIG.trigger.speedingSeconds && witness !== null) {
      this.overSeconds = 0;
      this.witnessId = witness;
      this.lastJudged = 'speeding';
      this.judgedCount += 1;
      this.session.reportOffence('speeding');
    }
    if (this.traffic && PURSUIT_CONFIG.trigger.collisionWitnessed) {
      // Each contact event is judged once: the high-water mark is the newest step already seen.
      let newest = this.lastContactStep;
      for (const event of this.traffic.contacts.recent) {
        if (event.step <= this.lastContactStep) continue;
        newest = Math.max(newest, event.step);
        if (event.kind === 'player-traffic' && witness !== null) {
          this.witnessId = witness;
          this.lastJudged = 'collision';
          this.judgedCount += 1;
          this.session.reportOffence('collision');
        }
      }
      this.lastContactStep = newest;
    }
  }

  private sessionInput(seenCount: number, dtSeconds: number): SessionInput {
    let nearest: number | null = null;
    let pursuing = 0;
    let inRange = false;
    for (let id = 0; id < this.poolSize; id += 1) {
      const unit = this.units[id]!;
      const opponent = this.police.opponents[id];
      if (!opponent || opponent.retired || unit.role === 'patrol') continue;
      pursuing += 1;
      const distance = this.distanceToPlayer(opponent.state.position.x, opponent.state.position.z);
      if (nearest === null || distance < nearest) nearest = distance;
      if (distance <= PURSUIT_CONFIG.capture.rangeMeters) inRange = true;
    }
    const state = this.session.currentState;
    const captureActive = state === 'PURSUING' || state === 'ESCALATING' || state === 'SEARCHING';
    const slow = Math.abs(this.player.speed) < PURSUIT_CONFIG.capture.playerSpeedMaxMps;
    this.captureSeconds = captureActive && inRange && slow ? this.captureSeconds + dtSeconds : 0;
    let witnessInView = false;
    if (this.witnessId !== null) {
      const witness = this.police.opponents[this.witnessId];
      witnessInView = witness !== undefined && !witness.retired && this.seen[this.witnessId] === 1;
    }
    return {
      seenCount,
      witnessInView,
      nearestPursuerMeters: nearest,
      pursuingUnits: pursuing,
      captured: this.captureSeconds >= PURSUIT_CONFIG.capture.holdSeconds,
      playerX: this.player.x,
      playerZ: this.player.z,
    };
  }

  /** Roles follow the session state. Units are changed only here, and only by role; nothing is moved. */
  private assignRoles(dtSeconds: number): void {
    const state = this.session.currentState;
    if (state === 'INACTIVE') {
      for (let id = 0; id < this.poolSize; id += 1) {
        if (id >= PURSUIT_CONFIG.patrolUnits && this.police.isActive(id)) this.retire(id);
        else if (this.police.isActive(id)) this.setRole(id, 'patrol');
      }
      this.ensurePatrols(dtSeconds);
      return;
    }
    if (state === 'COOLDOWN' || state === 'BUSTED' || state === 'DETECTION') {
      for (let id = 0; id < this.poolSize; id += 1) {
        if (this.units[id]!.role !== 'patrol' && this.police.isActive(id)) this.setRole(id, 'patrol');
      }
      return;
    }
    // Engaged: INITIATING, PURSUING, ESCALATING, or SEARCHING.
    const searching = state === 'SEARCHING';
    for (let id = 0; id < this.poolSize; id += 1) {
      const role = this.units[id]!.role;
      if (!this.police.isActive(id) || role === 'patrol') continue;
      if (searching && role !== 'search') this.setRole(id, 'search');
      else if (!searching && role === 'search') this.setRole(id, 'intercept');
    }
    if (this.chaserId() === null) {
      const promoted = this.nearestWithRole(['intercept', 'search']) ?? this.nearestWithRole(['patrol']);
      if (promoted !== null) this.setRole(promoted, 'chase');
      else if (this.session.deployReady) this.deployUnit(searching ? 'search' : 'chase');
    }
    while (this.pursuingCount() < this.session.wantedUnits) {
      if (!this.session.deployReady) break;
      if (!this.deployUnit(searching ? 'search' : 'intercept')) {
        this.deployPostponedCount += 1;
        break;
      }
    }
  }

  /**
   * Adds one unit to the pursuit: the nearest patrol first (it is already on the road), else a deployment from the idle
   * pool at a validated spawn. Returns false when neither is possible, and the caller postpones.
   */
  private deployUnit(role: UnitRole): boolean {
    const patrol = this.nearestWithRole(['patrol']);
    if (patrol !== null) {
      this.setRole(patrol, role);
      this.session.noteDeployed();
      return true;
    }
    const idle = this.firstIdle();
    if (idle === null) return false;
    const candidate = this.spawnCandidate();
    if (!candidate) return false;
    this.police.place(idle, { ...this.specFor(candidate), speedMps: PURSUIT_CONFIG.unit.deploySpeedMps, speedCapMps: this.capFor() });
    this.units[idle] = emptyUnit(role);
    this.units[idle]!.capMps = this.capFor();
    this.police.setObstacleExemption(idle, role === 'patrol' ? null : PLAYER_OBSTACLE_KEY);
    this.deployCount += 1;
    this.session.noteDeployed();
    return true;
  }

  /** A deployment spawn that never overlaps a body, and is never ahead of the player. Null when none is valid now. */
  private spawnCandidate(): DeployCandidate | null {
    const bodies: GroundBox[] = [this.boxFor(baseImage(this.player.x, this.period), baseImage(this.player.z, this.period), this.player.yaw)];
    // The lanes the units on the road already use. A new unit prefers a lane none of them uses, so all four lanes are used.
    const usedLaneIds = new Set<string>();
    for (let id = 0; id < this.poolSize; id += 1) {
      if (this.police.isActive(id)) {
        const opponent = this.police.opponents[id]!;
        bodies.push(this.police.boxOf(opponent));
        usedLaneIds.add(opponent.driver.route.laneId);
      }
    }
    if (this.traffic) {
      for (const obstacle of this.traffic.activeObstacles()) bodies.push(obstacle.box);
    }
    return chooseDeployment({
      graph: this.graph,
      player: { x: this.player.x, z: this.player.z, yaw: this.player.yaw },
      bodies,
      footprint: this.footprint,
      rules: deployRules(),
      period: this.period,
      usedLaneIds,
    });
  }

  /** Puts back a patrol that was removed while idle. Only on the road, at a validated spot, and at a slow pace. */
  private ensurePatrols(dtSeconds: number): void {
    this.patrolRespawnSeconds -= dtSeconds;
    if (this.patrolRespawnSeconds > 0) return;
    this.patrolRespawnSeconds = 2;
    let active = 0;
    for (let id = 0; id < PURSUIT_CONFIG.patrolUnits; id += 1) if (this.police.isActive(id)) active += 1;
    if (active >= PURSUIT_CONFIG.patrolUnits) return;
    const idle = this.firstIdle();
    if (idle === null || idle >= PURSUIT_CONFIG.patrolUnits) return;
    const candidate = this.spawnCandidate();
    if (!candidate) return;
    this.police.place(idle, { ...this.specFor(candidate), speedMps: PURSUIT_CONFIG.unit.deploySpeedMps, speedCapMps: null });
    this.units[idle] = emptyUnit('patrol');
    this.police.setObstacleExemption(idle, null);
    this.patrolRespawnCount += 1;
  }

  /** Re-plans routes on a timer, when the target has moved far, or when the unit is stuck. Never every step for every unit. */
  private updateRouting(dtSeconds: number): void {
    const lastKnown = this.session.lastKnownPosition;
    const chaser = this.chaserId();
    for (let id = 0; id < this.poolSize; id += 1) {
      const unit = this.units[id]!;
      const opponent = this.police.opponents[id];
      if (!opponent || opponent.retired) continue;
      if (unit.role === 'patrol') {
        if (unit.routeNext !== null) {
          unit.routeNext = null;
          this.police.setDriverPolicy(id, { speedCapMps: null });
        }
        continue;
      }
      // Stuck: a unit that wants to move and does not. It is re-planned once, then removed. A pursuit never waits on it.
      const wantsToMove = opponent.decision !== null && opponent.decision.targetSpeedMps > 1;
      unit.stuckSeconds = Math.abs(opponent.state.speed) < PURSUIT_CONFIG.stuck.speedMps && wantsToMove ? unit.stuckSeconds + dtSeconds : 0;
      if (unit.stuckSeconds === 0) unit.replannedWhileStuck = false;
      if (unit.stuckSeconds >= PURSUIT_CONFIG.stuck.removeAfterSeconds) {
        this.stuckRemovalCount += 1;
        this.retire(id);
        continue;
      }
      if (unit.stuckSeconds >= PURSUIT_CONFIG.stuck.replanAfterSeconds && !unit.replannedWhileStuck) {
        unit.replannedWhileStuck = true;
        unit.planAgeSeconds = Number.POSITIVE_INFINITY;
        this.stuckReplanCount += 1;
      }
      const target = this.targetFor(unit.role, lastKnown, chaser);
      if (!target) continue;
      unit.planAgeSeconds += dtSeconds;
      const moved = unit.planTarget ? Math.hypot(target.x - unit.planTarget.x, target.z - unit.planTarget.z) : Number.POSITIVE_INFINITY;
      const due = unit.planAgeSeconds >= PURSUIT_CONFIG.routing.replanSeconds || moved >= PURSUIT_CONFIG.routing.replanTargetMoveMeters;
      if (due || unit.routeNext === null) this.plan(id, target);
    }
  }

  /** The point a unit drives toward, by role. Null when no point is known. */
  private targetFor(role: UnitRole, lastKnown: { x: number; z: number } | null, chaser: number | null): { x: number; z: number; preferHeading: number | null; avoid: ReadonlySet<number> | null } | null {
    if (role === 'search') {
      const point = lastKnown ?? { x: this.player.x, z: this.player.z };
      return { x: point.x, z: point.z, preferHeading: null, avoid: null };
    }
    if (role === 'intercept' && this.playerLane) {
      // Intercept: a point on the player's own road, ahead of the player, approached by a route that avoids the chaser's.
      const ahead = this.router.laneAhead(this.playerLane.laneIndex, this.playerLane.s, PURSUIT_CONFIG.routing.interceptAheadMeters);
      if (ahead) {
        const lane = this.graph.lanes[ahead.laneIndex];
        if (lane) {
          const pose = laneSample(lane, ahead.s);
          const avoid = chaser !== null ? new Set(this.units[chaser]!.routeLanes) : null;
          return { x: pose.x, z: pose.z, preferHeading: pose.heading, avoid };
        }
      }
    }
    // The default aim (a chase, or an intercept with no lane ahead) sits just behind the player's centre, so the unit comes
    // up on the tail and tags it.
    const aim = chaseAimPoint(this.player.x, this.player.z, this.player.yaw, PURSUIT_CONFIG.routing.chaseBehindMeters);
    return { x: aim.x, z: aim.z, preferHeading: this.player.yaw, avoid: null };
  }

  /** Plans a unit's route to a target and sets its driver policy. A failed plan leaves the unit driving, and is counted. */
  private plan(id: number, target: { x: number; z: number; preferHeading: number | null; avoid: ReadonlySet<number> | null }): void {
    const unit = this.units[id]!;
    const opponent = this.police.opponents[id]!;
    const cap = this.capFor();
    unit.capMps = cap;
    const from = this.router.indexOf(opponent.driver.route.laneId);
    unit.planAgeSeconds = 0;
    unit.planTarget = { x: target.x, z: target.z };
    const options = { maxTargetMeters: 30, preferHeading: target.preferHeading };
    let plan = from === undefined ? null : this.router.planTo(from, target.x, target.z, { ...options, avoid: target.avoid });
    if (!plan && from !== undefined && target.avoid) plan = this.router.planTo(from, target.x, target.z, options);
    if (!plan) {
      unit.routeFailed = true;
      unit.routeNext = null;
      unit.routeLanes = [];
      this.planFailureCount += 1;
      this.police.setDriverPolicy(id, { speedCapMps: cap, rules: PURSUING_RULES });
      return;
    }
    unit.routeFailed = false;
    unit.routeLanes = plan.path;
    const next = this.router.routeMap(plan.path);
    unit.routeNext = next;
    this.police.setDriverPolicy(id, {
      nextLaneOf: (lane) => next.get(lane.id) ?? successorOf(lane),
      speedCapMps: cap,
      rules: PURSUING_RULES,
    });
  }

  /** The speed cap for pursuing units at the current level. Never below the unit minimum. */
  private capFor(): number {
    return pursuingSpeedCapMps(this.session.heatLevel.speedCapMps);
  }

  private setRole(id: number, role: UnitRole): void {
    const unit = this.units[id]!;
    if (unit.role === role) return;
    unit.role = role;
    if (role === 'patrol') unit.capMps = null;
    // A pursuing unit treats the player as its target, not as an obstacle. A patrol keeps the normal rule.
    this.police.setObstacleExemption(id, role === 'patrol' ? null : PLAYER_OBSTACLE_KEY);
    // A role change needs a fresh route at once, so the unit does not keep the old target for up to the replan time.
    unit.planAgeSeconds = Number.POSITIVE_INFINITY;
    if (role === 'patrol') {
      unit.routeNext = null;
      unit.routeLanes = [];
      unit.planTarget = null;
      unit.stuckSeconds = 0;
      unit.replannedWhileStuck = false;
    }
  }

  private retire(id: number): void {
    this.police.retire(id);
    this.units[id] = emptyUnit('patrol');
  }

  private chaserId(): number | null {
    for (let id = 0; id < this.poolSize; id += 1) {
      if (this.units[id]!.role === 'chase' && this.police.isActive(id)) return id;
    }
    return null;
  }

  private pursuingCount(): number {
    let count = 0;
    for (let id = 0; id < this.poolSize; id += 1) {
      if (this.police.isActive(id) && this.units[id]!.role !== 'patrol') count += 1;
    }
    return count;
  }

  private nearestWithRole(roles: readonly UnitRole[]): number | null {
    let best: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let id = 0; id < this.poolSize; id += 1) {
      if (!this.police.isActive(id) || !roles.includes(this.units[id]!.role)) continue;
      const opponent = this.police.opponents[id]!;
      const distance = this.distanceToPlayer(opponent.state.position.x, opponent.state.position.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
    return best;
  }

  private firstIdle(): number | null {
    for (let id = 0; id < this.poolSize; id += 1) {
      if (!this.police.isActive(id)) return id;
    }
    return null;
  }

  /** Distance from a point to the player, measured to the image nearest the player (the short way across a seam). */
  private distanceToPlayer(x: number, z: number): number {
    return Math.hypot(imageNear(this.player.x, x, this.period) - this.player.x, imageNear(this.player.z, z, this.period) - this.player.z);
  }

  private boxFor(x: number, z: number, yaw: number): GroundBox {
    return boxAt(x, z, yaw, this.footprint);
  }

  /**
   * The OpponentSpec for a unit at a lane position. Police are never recycled or released: a stuck unit is removed by
   * the pursuit instead, so nothing teleports and no car is ignored. The speed cap is set by the caller.
   */
  private specFor(candidate: Pick<DeployCandidate, 'laneId' | 's'>): OpponentSpec {
    return {
      typeId: 'sedan',
      laneId: candidate.laneId,
      s: candidate.s,
      speedMps: 0,
      colourIndex: 0,
      speedCapMps: null,
      recyclable: false,
      releasable: false,
    };
  }
}
