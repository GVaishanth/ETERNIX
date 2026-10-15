import type { VehicleConfig } from '../config/vehicleConfig';
import { clamp } from '../core/math';
import type { BodyState, VehicleState } from '../core/types';

/*
 * Cosmetic body response (weight transfer). Pure and deterministic.
 * It is stepped inside the fixed-step simulation, but it never feeds back into the vehicle's position,
 * heading, or speed. The render layer applies it to a child pivot, never the vehicle root.
 *
 * Each axis is a damped spring that chases a target derived from the vehicle's accelerations:
 *   pitch  target = -longitudinalAccel * pitchPerAccel   (braking dives the nose, positive pitch is nose down)
 *   roll   target = +lateralAccel * rollPerLateralAccel  (a right turn raises the right side, positive roll)
 *   heave  target = -longitudinalAccel * squatPerAccel   (acceleration squats the body down)
 * Every target is clamped, and each state is clamped too, so the body can never tip far.
 */

export function createBodyState(): BodyState {
  return { pitch: 0, pitchRate: 0, roll: 0, rollRate: 0, heave: 0, heaveRate: 0 };
}

/** One semi-implicit Euler step of a damped spring toward `target`. Returns the new position and velocity. */
function springStep(
  position: number,
  velocity: number,
  target: number,
  frequency: number,
  dampingRatio: number,
  dt: number,
): { position: number; velocity: number } {
  const acceleration = frequency * frequency * (target - position) - 2 * dampingRatio * frequency * velocity;
  const nextVelocity = velocity + acceleration * dt;
  return { position: position + nextVelocity * dt, velocity: nextVelocity };
}

export function stepBody(body: BodyState, vehicle: VehicleState, config: VehicleConfig, dt: number): BodyState {
  if (!(dt > 0)) return body;
  const w = config.suspensionFrequencyRadPerSecond;
  const z = config.suspensionDampingRatio;

  const pitchTarget = clamp(-vehicle.longitudinalAccel * config.pitchPerAccelRadians, -config.maxBodyPitchRadians, config.maxBodyPitchRadians);
  const rollTarget = clamp(vehicle.lateralAccel * config.rollPerLateralAccelRadians, -config.maxBodyRollRadians, config.maxBodyRollRadians);
  const heaveTarget = clamp(-vehicle.longitudinalAccel * config.squatPerAccelMeters, -config.maxBodyHeaveMeters, config.maxBodyHeaveMeters);

  const pitch = springStep(body.pitch, body.pitchRate, pitchTarget, w, z, dt);
  const roll = springStep(body.roll, body.rollRate, rollTarget, w, z, dt);
  const heave = springStep(body.heave, body.heaveRate, heaveTarget, w, z, dt);

  return {
    pitch: clamp(pitch.position, -config.maxBodyPitchRadians, config.maxBodyPitchRadians),
    pitchRate: pitch.velocity,
    roll: clamp(roll.position, -config.maxBodyRollRadians, config.maxBodyRollRadians),
    rollRate: roll.velocity,
    heave: clamp(heave.position, -config.maxBodyHeaveMeters, config.maxBodyHeaveMeters),
    heaveRate: heave.velocity,
  };
}
