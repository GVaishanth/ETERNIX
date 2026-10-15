import type { VehicleConfig } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS, MAX_FRAME_SECONDS, MAX_SUBSTEPS_PER_FRAME, VEHICLE_SPAWN, VEHICLE_SPAWN_YAW_RADIANS } from '../config/simulationConfig';
import { shortestAngleDelta, wrapAngle, lerp } from '../core/math';
import type { InputState, VehicleState } from '../core/types';
import { createVehicleState, stepVehicle } from '../simulation/vehicle';
import { planFixedSteps } from './fixedStep';

/**
 * Owns the authoritative simulation state. It advances only when update() is called,
 * which the render loop driver does once per frame. React rerenders never move it.
 * Rendering reads an interpolated state so motion stays smooth at any display rate.
 */
export class GameSimulation {
  private readonly config: VehicleConfig;
  private previous: VehicleState;
  private current: VehicleState;
  private accumulatorSeconds = 0;
  private alpha = 0;
  private stepTotal = 0;
  private droppedTotalSeconds = 0;

  constructor(config: VehicleConfig) {
    this.config = config;
    const spawn = createVehicleState(VEHICLE_SPAWN, VEHICLE_SPAWN_YAW_RADIANS);
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
      this.current = stepVehicle(this.current, input, this.config, FIXED_STEP_SECONDS);
    }

    this.accumulatorSeconds = plan.accumulatorSeconds;
    this.alpha = plan.alpha;
    this.stepTotal += plan.steps;
    this.droppedTotalSeconds += plan.droppedSeconds;
  }

  /** Latest simulated state. Use for logic and diagnostics. */
  get state(): VehicleState {
    return this.current;
  }

  /** Interpolated state between the last two steps. Use for rendering only. */
  getRenderState(): VehicleState {
    const a = this.alpha;
    const p = this.previous;
    const c = this.current;
    return {
      position: {
        x: lerp(p.position.x, c.position.x, a),
        y: lerp(p.position.y, c.position.y, a),
        z: lerp(p.position.z, c.position.z, a),
      },
      yaw: wrapAngle(p.yaw + shortestAngleDelta(p.yaw, c.yaw) * a),
      speed: lerp(p.speed, c.speed, a),
      steerAngle: lerp(p.steerAngle, c.steerAngle, a),
      yawRate: lerp(p.yawRate, c.yawRate, a),
    };
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
