/**
 * Performance index and garage ratings. Pure: input is a driven VehicleConfig (the output of deriveEffectiveSpecs),
 * so the numbers shown in the garage are the numbers the car drives. Nothing here changes physics.
 *
 * Performance index: the geometric mean of four ratios against the stock baseline (VEHICLE_CONFIG):
 *   engine acceleration / stock, top speed / stock, braking / stock, max lateral acceleration / stock.
 * A geometric mean keeps one large number from hiding weak areas. The index is 1.00 for the stock car.
 *
 * Ratings: four 1..10 scores, linear inside SPEC_LIMITS, so 1 is the lowest value the limits allow and 10 the highest.
 */
import { SPEC_LIMITS, type TunableSpecKey } from '../config/specLimits';
import { VEHICLE_CONFIG, type VehicleConfig } from '../config/vehicleConfig';
import type { VehicleTier } from '../config/vehicleCatalogue';

export interface PerformanceBand {
  readonly min: number;
  readonly max: number;
}

/**
 * Index bands per tier. Compressed to what SPEC_LIMITS allows: the stable envelope tops out near 1.42, so the
 * brief's 2.0 to 2.3 bands cannot be reached without leaving it. See CAR_OVERHAUL_PLAN.md.
 */
export const PERFORMANCE_BANDS: Readonly<Record<VehicleTier, PerformanceBand>> = {
  starter: { min: 1, max: 1.1 },
  street: { min: 1.1, max: 1.2 },
  advanced: { min: 1.2, max: 1.28 },
  elite: { min: 1.28, max: 1.34 },
  ultimate: { min: 1.34, max: 1.4 },
};

export interface PerformanceRatios {
  readonly acceleration: number;
  readonly topSpeed: number;
  readonly braking: number;
  readonly cornering: number;
}

/** Ratio of each index input to the stock baseline. A value above 1 is faster or stronger than stock. */
export function performanceRatios(config: VehicleConfig, base: VehicleConfig = VEHICLE_CONFIG): PerformanceRatios {
  return {
    acceleration: config.engineAccelerationMps2 / base.engineAccelerationMps2,
    topSpeed: config.maxForwardSpeedMps / base.maxForwardSpeedMps,
    braking: config.brakeDecelerationMps2 / base.brakeDecelerationMps2,
    cornering: config.maxLateralAccelerationMps2 / base.maxLateralAccelerationMps2,
  };
}

/** Geometric mean of the four ratios. 1.00 is stock. Throws on a non-positive input, which cannot come from valid data. */
export function performanceIndex(config: VehicleConfig, base: VehicleConfig = VEHICLE_CONFIG): number {
  const r = performanceRatios(config, base);
  const values = [r.acceleration, r.topSpeed, r.braking, r.cornering];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) throw new Error('performanceIndex: non-positive input');
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

export interface GarageRatings {
  readonly acceleration: number;
  readonly topSpeed: number;
  /** Mean of the cornering limit and lateral grip, both mapped to 1..10. */
  readonly handling: number;
  readonly braking: number;
}

/** Maps a value linearly from its SPEC_LIMITS range to 1..10, rounded to one decimal, clamped at the ends. */
export function rateValue(key: TunableSpecKey, value: number): number {
  const limit = SPEC_LIMITS[key];
  const fraction = (value - limit.min) / (limit.max - limit.min);
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round((1 + 9 * clamped) * 10) / 10;
}

export function garageRatings(config: VehicleConfig): GarageRatings {
  const cornering = rateValue('maxLateralAccelerationMps2', config.maxLateralAccelerationMps2);
  const grip = rateValue('lateralGripPerSecond', config.lateralGripPerSecond);
  return {
    acceleration: rateValue('engineAccelerationMps2', config.engineAccelerationMps2),
    topSpeed: rateValue('maxForwardSpeedMps', config.maxForwardSpeedMps),
    handling: Math.round(((cornering + grip) / 2) * 10) / 10,
    braking: rateValue('brakeDecelerationMps2', config.brakeDecelerationMps2),
  };
}
