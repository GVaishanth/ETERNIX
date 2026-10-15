import type { VehicleConfig } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS, MAX_FRAME_SECONDS, MAX_SUBSTEPS_PER_FRAME, VEHICLE_SPAWN, VEHICLE_SPAWN_YAW_RADIANS } from '../config/simulationConfig';
import { lerp } from '../core/math';
import type { BodyState, InputState, VehicleState } from '../core/types';
import { createBodyState, stepBody } from '../simulation/bodyState';
import { constrainVehicleToRoad, footprintFromConfig, type ConstraintFootprint, type RoadBoundary } from '../simulation/roadBoundary';
import { createVehicleState, interpolateVehicleState, stepVehicle } from '../simulation/vehicle';
import type { Vec3 } from '../core/types';
import { planFixedSteps } from './fixedStep';

export interface GameSimulationOptions {
  /** Spawn pose. Defaults to the legacy spawn (right lane, facing +Z). */
  spawn?: { position: Vec3; yawRadians: number };
  /** Road boundary. When null or omitted, the vehicle moves without any road constraint (legacy behaviour). */
  boundary?: RoadBoundary | null;
}

/**
 * Owns the authoritative simulation state. It advances only when update() is called,
 * which the render loop driver does once per frame. React rerenders never move it.
 * Rendering reads an interpolated state so motion stays smooth at any display rate.
 */
export class GameSimulation {
  private readonly config: VehicleConfig;
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

  constructor(config: VehicleConfig, options: GameSimulationOptions = {}) {
    this.config = config;
    this.spawnPosition = options.spawn?.position ?? VEHICLE_SPAWN;
    this.spawnYaw = options.spawn?.yawRadians ?? VEHICLE_SPAWN_YAW_RADIANS;
    this.boundary = options.boundary ?? null;
    this.footprint = footprintFromConfig(config);
    const spawn = createVehicleState(this.spawnPosition, this.spawnYaw);
    this.previous = spawn;
    this.current = spawn;
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
      let next = stepVehicle(this.current, input, this.config, FIXED_STEP_SECONDS);
      if (this.boundary) {
        // Road boundary runs after the movement model, and only corrects position and the two velocity components.
        const constrained = constrainVehicleToRoad(next, this.boundary, this.footprint);
        next = constrained.state;
        this.roadContactFlag = constrained.contact;
        this.roadSegment = constrained.segmentId;
        if (constrained.contact) this.contactStepTotal += 1;
      }
      this.current = next;
      this.previousBody = this.currentBody;
      this.currentBody = stepBody(this.currentBody, this.current, this.config, FIXED_STEP_SECONDS);
    }

    this.accumulatorSeconds = plan.accumulatorSeconds;
    this.alpha = plan.alpha;
    this.stepTotal += plan.steps;
    this.droppedTotalSeconds += plan.droppedSeconds;
  }

  /** Returns the vehicle to the spawn pose with zero speed, steer, and yaw rate. Clears interpolation history. */
  reset(): void {
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
