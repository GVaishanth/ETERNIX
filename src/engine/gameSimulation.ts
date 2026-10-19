import type { VehicleConfig } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS, MAX_FRAME_SECONDS, MAX_SUBSTEPS_PER_FRAME, VEHICLE_SPAWN, VEHICLE_SPAWN_YAW_RADIANS } from '../config/simulationConfig';
import { lerp } from '../core/math';
import type { BodyState, InputState, VehicleState } from '../core/types';
import { createBodyState, stepBody } from '../simulation/bodyState';
import { constrainVehicleToRoad, footprintFromConfig, signedDistance, type ConstraintFootprint, type RoadBoundary } from '../simulation/roadBoundary';
import { createVehicleState, interpolateVehicleState, stepVehicle } from '../simulation/vehicle';
import { configOnSegment } from '../simulation/surfaceModel';
import type { Vec3 } from '../core/types';
import { planFixedSteps } from './fixedStep';
import type { TrafficRuntime } from '../traffic/trafficRuntime';
import type { OpponentSystem } from '../ai/aiOpponents';
import { PLAYER_OBSTACLE_KEY, type AiObstacle } from '../ai/aiController';
import { groundBoxFromPose, groundBoxOverlap } from '../simulation/obb';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import type { PlayerPose } from '../traffic/trafficTypes';
import { applyVehicleContact, vehicleVelocity as vehicleVelocityOf } from '../simulation/vehicleContact';
import type { LanePath } from '../traffic/laneGraph';
import {
  createRecoveryMonitor,
  footprintCornersOf,
  nearestRecoveryPose,
  resetRecoveryMonitor,
  stepRecoveryMonitor,
  type RecoveryMonitor,
  type RecoveryReason,
} from '../world/worldRecovery';
import { slopeAccelerationUnder, standOnRoad, type RoadElevation } from '../world/roadElevation';

export interface GameSimulationOptions {
  /** Spawn pose. Defaults to the legacy spawn (right lane, facing +Z). */
  spawn?: { position: Vec3; yawRadians: number };
  /** Road boundary. When null or omitted, the vehicle moves without any road constraint (legacy behaviour). */
  boundary?: RoadBoundary | null;
  /** Traffic population and spawn scheduler. Stepped at the same fixed step as the player. */
  traffic?: TrafficRuntime | null;
  /** Opponent AI cars. They drive the shared vehicle model with AI inputs. Null when there are none. */
  opponents?: OpponentSystem | null;
  /** Driving lanes for recovery. The car returns to the nearest one. Null falls back to the spawn pose. */
  recoveryLanes?: readonly LanePath[] | null;
  /** Road height and grade lookup for the world's lanes. Null on a flat world, where the car keeps its height. */
  elevation?: RoadElevation | null;
  /** Police pursuit host, or null when the world has no pursuit. */
  pursuit?: PursuitStepHost | null;
  /** Explicit development reset pose, used only by devReset(). Null when the world defines none. */
  devReset?: { position: Vec3; yawRadians: number } | null;
}

/**
 * Race hooks (Part 6). The race controller implements this, and the simulation calls it once per fixed step. It owns
 * no physics: inputFor() may replace the driver's input (the grid hold), and afterStep() reports the stepped car so the
 * race can advance its own clock and gate tests from the same step.
 */
/**
 * The police pursuit's hook (Part 7). The pursuit owns the police system and its timers. The simulation steps the police
 * through the same integrate, contact, and end-of-step calls as the opponents, and calls afterStep once per fixed step.
 */
export interface PursuitStepHost {
  /** The police system. The simulation steps it, resolves its contacts, and never steps it while suspended. */
  readonly police: OpponentSystem;
  /** True while the pursuit is frozen (a race is on). Then the police are not stepped and no offence is judged. */
  isSuspended(): boolean;
  /** Called after each fixed step, once the player's state is final. */
  afterStep(state: VehicleState, dtSeconds: number): void;
  /** Called when the player is reset (R, or the DEV reset). The pursuit ends and the units return to their start. */
  onPlayerReset(): void;
  /** A pursuing unit touched the player in this step. Starts the ram lockout while a pursuit is active. */
  onRam(): void;
  /** The player's input for this step. A ram lockout replaces it with a full brake. Returns the frame input otherwise. */
  driveInput(frameInput: InputState): InputState;
  /** True once after a pursuit ends busted. The simulation then sends the car back to the spawn. Reading clears it. */
  takeBustReset(): boolean;
}

export interface RaceStepHost {
  /** The input the player's car uses for this fixed step. Return `frameInput` unless the race overrides it. */
  inputFor(frameInput: InputState): InputState;
  /** Called after each fixed step, with the car's state for that step. */
  afterStep(state: VehicleState): void;
}

/**
 * Owns the authoritative simulation state. It advances only when update() is called,
 * which the render loop driver does once per frame. React rerenders never move it.
 * Rendering reads an interpolated state so motion stays smooth at any display rate.
 */
export class GameSimulation {
  /** Active vehicle's config. Replaced only through setVehicleConfig (Part 8 garage switch). */
  private config: VehicleConfig;
  private previous: VehicleState;
  private current: VehicleState;
  private previousBody: BodyState = createBodyState();
  private currentBody: BodyState = createBodyState();
  private accumulatorSeconds = 0;
  private alpha = 0;
  private stepTotal = 0;
  private droppedTotalSeconds = 0;
  private readonly spawnPosition: Vec3;
  private readonly spawnYaw: number;
  private readonly boundary: RoadBoundary | null;
  private readonly footprint: ConstraintFootprint;
  private roadContactFlag = false;
  private roadSegment: string | null = null;
  private contactStepTotal = 0;
  private readonly trafficRuntime: TrafficRuntime | null;
  private opponentSystem: OpponentSystem | null;
  private raceHost: RaceStepHost | null = null;
  private readonly pursuit: PursuitStepHost | null;
  private readonly recoveryLanes: readonly LanePath[] | null;
  private readonly devResetPose: { position: Vec3; yawRadians: number } | null;
  private readonly elevation: RoadElevation | null;
  private readonly recoveryMonitor: RecoveryMonitor = createRecoveryMonitor();
  private recoveryTotal = 0;
  private lastRecovery: RecoveryReason | null = null;
  private bustTotal = 0;

  constructor(config: VehicleConfig, options: GameSimulationOptions = {}) {
    this.config = config;
    this.spawnPosition = options.spawn?.position ?? VEHICLE_SPAWN;
    this.spawnYaw = options.spawn?.yawRadians ?? VEHICLE_SPAWN_YAW_RADIANS;
    this.boundary = options.boundary ?? null;
    this.trafficRuntime = options.traffic ?? null;
    this.opponentSystem = options.opponents ?? null;
    this.recoveryLanes = options.recoveryLanes ?? null;
    this.devResetPose = options.devReset ?? null;
    this.elevation = options.elevation ?? null;
    this.pursuit = options.pursuit ?? null;
    this.footprint = footprintFromConfig(config);
    const spawn = createVehicleState(this.spawnPosition, this.spawnYaw);
    this.previous = spawn;
    this.current = spawn;
  }

  /** The active vehicle's config. Rendering and HUD read it; only setVehicleConfig changes it. */
  get vehicleConfig(): VehicleConfig {
    return this.config;
  }

  /**
   * Part 8: swaps the active vehicle's handling. Only handling may change. The collision footprint must stay the same,
   * because traffic and pursuit read the base footprint. Speed is clamped to the new top speed. The garage requires a
   * stop, so the car normally keeps its pose and speed. Calling it with the same object is a no-op.
   */
  setVehicleConfig(config: VehicleConfig): void {
    if (config === this.config) return;
    const next = footprintFromConfig(config);
    const current = this.footprint;
    if (
      next.rearMeters !== current.rearMeters ||
      next.frontMeters !== current.frontMeters ||
      next.halfWidthMeters !== current.halfWidthMeters ||
      next.tangentialRetentionPerStep !== current.tangentialRetentionPerStep
    ) {
      throw new Error('setVehicleConfig: the collision footprint must match the active vehicle. Only handling may change.');
    }
    this.config = config;
    if (this.current.speed > config.maxForwardSpeedMps) {
      this.current = { ...this.current, speed: config.maxForwardSpeedMps };
    }
  }

  /** Advances the simulation by real frame time, using fixed steps with a single input sample. */
  update(frameSeconds: number, input: InputState): void {
    const plan = planFixedSteps({
      accumulatorSeconds: this.accumulatorSeconds,
      frameSeconds,
      stepSeconds: FIXED_STEP_SECONDS,
      maxSteps: MAX_SUBSTEPS_PER_FRAME,
      maxFrameSeconds: MAX_FRAME_SECONDS,
    });

    for (let i = 0; i < plan.steps; i += 1) {
      this.previous = this.current;
      const raceInput = this.raceHost ? this.raceHost.inputFor(input) : input;
      const stepInput = this.pursuit ? this.pursuit.driveInput(raceInput) : raceInput;
      // The slope under the car at the start of the step. A climb slows it, a descent speeds it up.
      // On a dirt segment the car is stepped with the dirt penalty. Asphalt returns the config unchanged.
      const onSurface = configOnSegment(this.config, this.boundary, this.roadSegment);
      let next = stepVehicle(this.current, stepInput, onSurface, FIXED_STEP_SECONDS, slopeAccelerationUnder(this.current, this.elevation));
      if (this.leftWorld(next)) {
        // Left the world area in this step, before the road constraint could pull it back. Recover, and skip the rest of this step.
        this.recoverTo('outside-bounds', next.position);
        continue;
      }
      next = this.constrainToRoad(next);
      const traffic = this.trafficRuntime;
      const opponents = this.opponentSystem;
      // Police are stepped only while the pursuit is not suspended (a race freezes them).
      const police = this.pursuit && !this.pursuit.isSuspended() ? this.pursuit.police : null;
      if (traffic) {
        // Traffic runs after the player's movement and road constraint, at the same fixed step.
        const pose = this.playerPose(next);
        traffic.spawner.tick(traffic.system, pose, FIXED_STEP_SECONDS);
        traffic.system.step(FIXED_STEP_SECONDS, pose);
      }
      if (opponents) {
        // Opponents decide from the traffic and player positions after the traffic step, then integrate.
        opponents.integrate(FIXED_STEP_SECONDS, this.obstaclesFor(next, traffic !== null));
      }
      if (police) {
        // Police follow the same path as opponents: the shared AI and vehicle model, with the same obstacles.
        police.integrate(FIXED_STEP_SECONDS, this.obstaclesFor(next, traffic !== null));
      }
      if (traffic) {
        // Player contact with traffic: a push-out along the normal, and removal of the approach velocity. Nothing is added.
        const contact = traffic.system.resolvePlayerContact(this.playerPose(next));
        if (contact) {
          next = applyVehicleContact(next, contact.push, contact.normal, contact.otherVelocity);
          // The push can move the car off the drivable region, so the road constraint runs again.
          next = this.constrainToRoad(next);
        }
      }
      if (opponents) {
        next = this.resolveOpponentContacts(next, opponents, traffic !== null).state;
      }
      if (police) {
        const ram = this.resolveOpponentContacts(next, police, traffic !== null);
        next = ram.state;
        // A pursuing unit touched the player: the pursuit starts the ram lockout (it ignores this outside a pursuit).
        if (ram.overlap) this.pursuit?.onRam();
      }
      if (traffic) traffic.system.endContactStep();
      if (opponents) opponents.endContactStep();
      if (police) police.endContactStep();
      // The car's height follows the road it is on, after every move in this step.
      this.current = standOnRoad(next, this.elevation);
      this.checkRecovery(FIXED_STEP_SECONDS);
      this.raceHost?.afterStep(this.current);
      this.pursuit?.afterStep(this.current, FIXED_STEP_SECONDS);
      this.previousBody = this.currentBody;
      this.currentBody = stepBody(this.currentBody, this.current, this.config, FIXED_STEP_SECONDS);
    }

    // A busted pursuit sends the car back to the spawn, the same reset R makes, once the steps for this frame are done.
    if (this.pursuit?.takeBustReset()) this.bustReset();

    this.accumulatorSeconds = plan.accumulatorSeconds;
    this.alpha = plan.alpha;
    this.stepTotal += plan.steps;
    this.droppedTotalSeconds += plan.droppedSeconds;
  }

  /** Obstacles the AI can see: the player, plus the traffic when it exists. */
  private obstaclesFor(player: VehicleState, withTraffic: boolean): AiObstacle[] {
    const obstacles: AiObstacle[] = [
      {
        key: PLAYER_OBSTACLE_KEY,
        box: groundBoxFromPose(player.position.x, player.position.z, player.yaw, this.footprint.rearMeters, this.footprint.frontMeters, this.footprint.halfWidthMeters),
        speedMps: player.speed,
      },
    ];
    if (withTraffic && this.trafficRuntime) obstacles.push(...this.trafficRuntime.system.activeObstacles());
    return obstacles;
  }

  /**
   * Opponent contacts, in a fixed order: each opponent against traffic, then each opponent against the player. Both
   * bodies of a player-opponent contact are corrected by half the overlap, and each loses its approach velocity. The
   * system's own contact kinds label the events, so race opponents and police are logged separately.
   */
  private resolveOpponentContacts(player: VehicleState, opponents: OpponentSystem, withTraffic: boolean): { state: VehicleState; overlap: boolean } {
    let playerState = player;
    let touched = false;
    const kinds = opponents.contactKinds;
    for (const opponent of opponents.opponents) {
      if (opponent.retired) continue;
      if (withTraffic && this.trafficRuntime) {
        const hit = this.trafficRuntime.system.resolveDrivenContact(opponents.boxOf(opponent), `opp:${opponent.id}`, kinds.traffic);
        if (hit) opponents.applyContact(opponent, hit.push, hit.normal, hit.otherVelocity);
      }
      const playerBox = groundBoxFromPose(playerState.position.x, playerState.position.z, playerState.yaw, this.footprint.rearMeters, this.footprint.frontMeters, this.footprint.halfWidthMeters);
      const overlap = groundBoxOverlap(playerBox, opponents.boxOf(opponent));
      if (!overlap.overlapping) continue;
      touched = true;
      // The normal points from the opponent toward the player. Each body takes half of the depth, capped per step.
      const depth = Math.min(overlap.depthMeters, TRAFFIC_CONFIG.collision.maxPlayerPushPerStepMeters) / 2;
      const nx = overlap.normalX;
      const nz = overlap.normalZ;
      const playerVelocity = vehicleVelocityOf(playerState);
      const opponentVelocity = opponents.velocityOf(opponent);
      playerState = applyVehicleContact(playerState, { x: nx * depth, z: nz * depth }, { x: nx, z: nz }, opponentVelocity);
      opponents.applyContact(opponent, { x: -nx * depth, z: -nz * depth }, { x: -nx, z: -nz }, playerVelocity);
      opponents.contacts.touch(kinds.player, `opp:${opponent.id}`, 'player');
      playerState = this.constrainToRoad(playerState);
    }
    return { state: playerState, overlap: touched };
  }

  /** Road constraint for the player. Updates the contact flags, and records a guardrail contact once per event. */
  private constrainToRoad(state: VehicleState): VehicleState {
    if (!this.boundary) return state;
    const constrained = constrainVehicleToRoad(state, this.boundary, this.footprint);
    this.roadContactFlag = constrained.contact;
    this.roadSegment = constrained.segmentId;
    if (constrained.contact) {
      this.contactStepTotal += 1;
      this.trafficRuntime?.system.contacts.touch('player-guardrail', 'player', null);
    }
    return constrained.state;
  }

  private playerPose(state: VehicleState): PlayerPose {
    return { x: state.position.x, z: state.position.z, yaw: state.yaw, speed: state.speed };
  }

  /** Attaches (or detaches, with null) the race host. Only one race can be attached at a time. */
  attachRace(host: RaceStepHost | null): void {
    this.raceHost = host;
  }

  /** Replaces the opponent cars (a race attaches its own, and detaches them when it ends). Null removes them. */
  attachOpponents(system: OpponentSystem | null): void {
    this.opponentSystem = system;
  }

  /**
   * Deliberate placement: puts the car at a pose with zero speed, as a reset does. Used when a race starts, to put the
   * player on its grid slot. It is a jump by design, and it is not ordinary driving.
   */
  placeVehicle(position: Vec3, yawRadians: number): void {
    this.relocate(position, yawRadians);
  }

  /** Clears all traffic and restores the scenario's spawn requests. The player is not affected. Called by R and by the DEV traffic reset. */
  resetTraffic(): void {
    if (this.trafficRuntime) {
      this.trafficRuntime.system.clear();
      this.trafficRuntime.spawner.reset();
    }
    this.opponentSystem?.reset();
  }

  /** Opponent AI cars, or null. Rendering and diagnostics read them; they never write them. */
  get opponents(): OpponentSystem | null {
    return this.opponentSystem;
  }

  /** Traffic runtime, or null when the world has no traffic. Rendering and diagnostics read it; they never write it. */
  get traffic(): TrafficRuntime | null {
    return this.trafficRuntime;
  }

  /** Recoveries performed since the simulation was created. Diagnostics read it. */
  get recoveryCount(): number {
    return this.recoveryTotal;
  }

  /**
   * Busted resets performed since the simulation was created. The renderer compares it between frames, so it can snap the
   * camera to the spawn instead of sweeping across the map.
   */
  get bustCount(): number {
    return this.bustTotal;
  }

  /**
   * The busted reset: the car goes to the spawn with zero speed, and traffic is cleared and restored, as R does. The
   * pursuit has already ended, so reset() only returns the police to patrol.
   */
  private bustReset(): void {
    this.reset();
    this.resetTraffic();
    this.bustTotal += 1;
  }

  /** Reason for the last recovery, or null if none has happened. */
  get lastRecoveryReason(): RecoveryReason | null {
    return this.lastRecovery;
  }

  /**
   * Development only: moves the car to the world's explicit DEV reset pose, with zero speed. It is a deliberate jump,
   * not ordinary driving. Returns false when the world defines no DEV pose.
   */
  devReset(): boolean {
    if (!this.devResetPose) return false;
    // A DEV jump is a reset for the pursuit too: the car is moved, so any session ends cleanly.
    this.pursuit?.onPlayerReset();
    this.relocate(this.devResetPose.position, this.devResetPose.yawRadians);
    return true;
  }

  /**
   * Checks the world bounds, the drivable surface, and a stuck state after each fixed step. A reason means the car is
   * relocated to the nearest driving lane, or to the spawn when no lanes exist. Ordinary driving never reaches this.
   */
  private checkRecovery(dtSeconds: number): void {
    const boundary = this.boundary;
    if (!boundary) return;
    const x = this.current.position.x;
    const z = this.current.position.z;
    const footprintOnSurface = footprintCornersOf(x, z, this.current.yaw, this.footprint).every(
      (corner) => signedDistance(boundary, corner.x, corner.z).distance <= 0,
    );
    const reason = stepRecoveryMonitor(this.recoveryMonitor, {
      x,
      z,
      speedMps: Math.abs(this.current.speed),
      onSurface: signedDistance(boundary, x, z).distance <= 0,
      footprintOnSurface,
      insideBounds: this.insideWorld(x, z),
      dtSeconds,
    });
    if (reason) this.recoverTo(reason, this.current.position);
  }

  /** True when a point is inside the world's bounds. Without a boundary there are no bounds, so every point is inside. */
  private insideWorld(x: number, z: number): boolean {
    const boundary = this.boundary;
    if (!boundary) return true;
    // A torus has no edge. Its seams are handled by the boundary's distance, so every point is inside.
    if (boundary.periodMeters !== null) return true;
    return x >= boundary.minX && x <= boundary.maxX && z >= boundary.minZ && z <= boundary.maxZ;
  }

  private leftWorld(state: VehicleState): boolean {
    return !this.insideWorld(state.position.x, state.position.z);
  }

  /** Relocates the car to the nearest driving lane from a point, or to the spawn when there are no lanes. Counts it. */
  private recoverTo(reason: RecoveryReason, from: Vec3): void {
    const target = (this.recoveryLanes ? nearestRecoveryPose(this.recoveryLanes, from.x, from.z) : null) ?? {
      position: this.spawnPosition,
      yawRadians: this.spawnYaw,
    };
    this.relocate(target.position, target.yawRadians);
    this.recoveryTotal += 1;
    this.lastRecovery = reason;
    resetRecoveryMonitor(this.recoveryMonitor);
  }

  /** Puts the car at a pose with zero speed and passes it through the road constraint. Clears interpolation history. */
  private relocate(position: Vec3, yawRadians: number): void {
    const state = createVehicleState(position, yawRadians);
    const constrained = standOnRoad(this.constrainToRoad(state), this.elevation);
    this.previous = constrained;
    this.current = constrained;
    this.previousBody = createBodyState();
    this.currentBody = createBodyState();
    this.accumulatorSeconds = 0;
    this.alpha = 0;
  }

  /** Returns the vehicle to the spawn pose with zero speed, steer, and yaw rate. Clears interpolation history. */
  reset(): void {
    this.pursuit?.onPlayerReset();
    const spawn = createVehicleState(this.spawnPosition, this.spawnYaw);
    this.previous = spawn;
    this.current = spawn;
    this.previousBody = createBodyState();
    this.currentBody = createBodyState();
    this.accumulatorSeconds = 0;
    this.alpha = 0;
    this.roadContactFlag = false;
    this.roadSegment = null;
  }

  /** True when the road boundary is active for this simulation. */
  get hasRoadBoundary(): boolean {
    return this.boundary !== null;
  }

  /** True when the last fixed step corrected the car against the road boundary. */
  get roadContact(): boolean {
    return this.roadContactFlag;
  }

  /** Segment nearest the car after the last step, or null without a boundary. */
  get currentRoadSegmentId(): string | null {
    return this.roadSegment;
  }

  /** Fixed steps in which the boundary corrected the car. Diagnostics only. */
  get roadContactSteps(): number {
    return this.contactStepTotal;
  }

  /** Latest simulated state. Use for logic and diagnostics. */
  get state(): VehicleState {
    return this.current;
  }

  /** Interpolated state between the last two steps. Use for rendering only. */
  getRenderState(): VehicleState {
    return interpolateVehicleState(this.previous, this.current, this.alpha);
  }

  /**
   * Pitch of the road between the two axles, radians, positive uphill along the car's heading. The renderer pitches the
   * car by it so the front axle sits on the road. It is read from both axles, not from the grade at the rear: a car
   * whose rear is on a flat junction pad and whose front is already on the street beside it has a rear grade of zero.
   * Zero on flat roads and when there is no elevation.
   */
  getRenderRoadPitch(): number {
    if (!this.elevation) return 0;
    const pose = this.getRenderState();
    const wheelbase = this.config.wheelbaseMeters;
    const rear = this.elevation.surfaceAt(pose.position.x, pose.position.z, pose.yaw);
    const front = this.elevation.surfaceAt(
      pose.position.x + Math.sin(pose.yaw) * wheelbase,
      pose.position.z + Math.cos(pose.yaw) * wheelbase,
      pose.yaw,
    );
    if (!rear || !front) return 0;
    const rise = Math.min(wheelbase, Math.max(-wheelbase, front.heightMeters - rear.heightMeters));
    return Math.asin(rise / wheelbase);
  }

  /** Interpolated cosmetic body state. Use for rendering only. Never feeds back into the vehicle. */
  getRenderBody(): BodyState {
    const a = this.alpha;
    const p = this.previousBody;
    const c = this.currentBody;
    return {
      pitch: lerp(p.pitch, c.pitch, a),
      pitchRate: lerp(p.pitchRate, c.pitchRate, a),
      roll: lerp(p.roll, c.roll, a),
      rollRate: lerp(p.rollRate, c.rollRate, a),
      heave: lerp(p.heave, c.heave, a),
      heaveRate: lerp(p.heaveRate, c.heaveRate, a),
    };
  }

  /** Latest simulated body state. For diagnostics. */
  get body(): BodyState {
    return this.currentBody;
  }

  get stepCount(): number {
    return this.stepTotal;
  }

  get droppedSeconds(): number {
    return this.droppedTotalSeconds;
  }

  get interpolationAlpha(): number {
    return this.alpha;
  }
}
