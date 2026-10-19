/**
 * Part 8: the handling values a vehicle may change, and the limits every effective value is clamped to.
 *
 * Only these keys can differ between catalogue vehicles or be changed by an upgrade. Dimensions, the collision
 * footprint, pedal rates, body-response cosmetics, and the suspension feel are NOT tunable per vehicle. Collision
 * dimensions must match across the catalogue, so traffic and pursuit (which read the base footprint) stay correct.
 *
 * Limits are inclusive, in SI units, and set the envelope a upgrade or a catalogue entry cannot leave.
 */
import type { VehicleConfig } from './vehicleConfig';

export const TUNABLE_SPEC_KEYS = [
  'engineAccelerationMps2',
  'maxForwardSpeedMps',
  'engineFadeSpeedMps',
  'brakeDecelerationMps2',
  'handbrakeDecelerationMps2',
  'steerAngleLowSpeedRadians',
  'steerAngleHighSpeedRadians',
  'steerRateRadiansPerSecond',
  'yawResponseSeconds',
  'lateralGripPerSecond',
  'lateralGripDriftPerSecond',
  'maxLateralAccelerationMps2',
  'maxDriftLateralAccelerationMps2',
] as const;

export type TunableSpecKey = (typeof TUNABLE_SPEC_KEYS)[number];

export interface SpecLimit {
  readonly min: number;
  readonly max: number;
}

/** Limits per tunable key. Every key in TUNABLE_SPEC_KEYS has one; a test enforces it. */
export const SPEC_LIMITS: Readonly<Record<TunableSpecKey, SpecLimit>> = {
  engineAccelerationMps2: { min: 4, max: 14 },
  /** Top speed envelope: 150 to 300 km/h (metres per second here). No car may be slower or faster. */
  maxForwardSpeedMps: { min: 150 / 3.6, max: 300 / 3.6 },
  engineFadeSpeedMps: { min: 50, max: 95 },
  brakeDecelerationMps2: { min: 10, max: 26 },
  handbrakeDecelerationMps2: { min: 3, max: 10 },
  steerAngleLowSpeedRadians: { min: 0.3, max: 0.7 },
  steerAngleHighSpeedRadians: { min: 0.1, max: 0.3 },
  steerRateRadiansPerSecond: { min: 1.8, max: 4 },
  yawResponseSeconds: { min: 0.06, max: 0.2 },
  lateralGripPerSecond: { min: 5, max: 12 },
  lateralGripDriftPerSecond: { min: 0.8, max: 3 },
  maxLateralAccelerationMps2: { min: 10, max: 20 },
  maxDriftLateralAccelerationMps2: { min: 6, max: 14 },
};

/** Keys in TUNABLE_SPEC_KEYS, typed as VehicleConfig fields. A compile-time check that every key exists on VehicleConfig. */
export type TunableSpecs = Pick<VehicleConfig, TunableSpecKey>;

/** Minimum gap the engine fade speed keeps above the top speed (m/s). The fade must sit above the cap. */
export const FADE_ABOVE_TOP_SPEED_MPS = 5;
