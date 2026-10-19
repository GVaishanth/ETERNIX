import { VEHICLE_DESIGNS } from '../config/vehicleDesigns';
/**
 * Part 8 effective-spec pipeline. The ONE function that turns a vehicle's base handling and its installed upgrades
 * into the VehicleConfig that the controller runs. Gameplay (the simulation) and the garage display both call it,
 * so the numbers shown are the numbers driven.
 *
 * Order of work:
 *   1. Start from the vehicle's base handling, filling missing keys from VEHICLE_CONFIG. Base data is never written.
 *   2. Apply each installed upgrade tier. Each category multiplies the keys it touches. Products commute, so the
 *      order of categories does not matter.
 *   3. Clamp every tunable value to SPEC_LIMITS.
 *   4. Enforce invariants that keep the controller sane (fade above top speed, drift grip below grip, etc.).
 *   5. Return a frozen VehicleConfig and a report of every clamp and adjustment.
 *
 * Dimensions and the collision footprint come straight from VEHICLE_CONFIG. They are never tunable (see specLimits.ts).
 */
import { VEHICLE_CONFIG, type VehicleConfig } from '../config/vehicleConfig';
import { FADE_ABOVE_TOP_SPEED_MPS, SPEC_LIMITS, TUNABLE_SPEC_KEYS, type TunableSpecKey } from '../config/specLimits';
import { MAX_UPGRADE_TIER, UPGRADE_CATEGORIES, UPGRADES, type UpgradeCategory } from '../config/upgradeConfig';
import type { VehicleDefinition } from '../config/vehicleCatalogue';

/** Installed tier per category, 0 = stock. */
export type InstalledUpgrades = Readonly<Record<UpgradeCategory, number>>;

export const STOCK_UPGRADES: InstalledUpgrades = { engine: 0, transmission: 0, tires: 0, brakes: 0 };

export interface EffectiveSpecs {
  readonly vehicleId: string;
  /** Frozen. Passed to GameSimulation.setVehicleConfig and to the visual layer. */
  readonly config: VehicleConfig;
  /** Keys whose value was clamped to SPEC_LIMITS. Empty for normal data. */
  readonly clamped: readonly TunableSpecKey[];
  /** Upgrade categories ignored: unsupported by the vehicle, or a tier outside 0..MAX. */
  readonly ignoredUpgrades: readonly UpgradeCategory[];
  /** Invariant corrections, as short human-readable notes. */
  readonly adjustments: readonly string[];
}

/** The vehicle's base config with its handling applied and no upgrades. Used for the garage's "factory" column. */
export function baseConfigFor(vehicle: VehicleDefinition, base: VehicleConfig = VEHICLE_CONFIG): VehicleConfig {
  return deriveEffectiveSpecs(vehicle, STOCK_UPGRADES, base).config;
}

export function deriveEffectiveSpecs(
  vehicle: VehicleDefinition,
  upgrades: InstalledUpgrades,
  base: VehicleConfig = VEHICLE_CONFIG,
): EffectiveSpecs {
  // 1. Base values. Only tunable keys are read from the vehicle; the rest is copied from the base unchanged.
  const values: Record<TunableSpecKey, number> = {} as Record<TunableSpecKey, number>;
  for (const key of TUNABLE_SPEC_KEYS) {
    const override = vehicle.handling[key];
    values[key] = override !== undefined ? override : base[key];
  }

  // 2. Upgrades.
  const ignoredUpgrades: UpgradeCategory[] = [];
  for (const category of UPGRADE_CATEGORIES) {
    const tier = upgrades[category];
    if (tier === 0) continue;
    if (!Number.isInteger(tier) || tier < 0 || tier > MAX_UPGRADE_TIER || !vehicle.upgradeSupport.includes(category)) {
      ignoredUpgrades.push(category);
      continue;
    }
    for (const effect of UPGRADES[category].effects) {
      values[effect.key] *= effect.factors[tier - 1] ?? 1;
    }
  }

  // 3. Clamp to limits.
  const clamped: TunableSpecKey[] = [];
  for (const key of TUNABLE_SPEC_KEYS) {
    const limit = SPEC_LIMITS[key];
    const value = Number.isFinite(values[key]) ? values[key] : base[key];
    const bounded = Math.min(Math.max(value, limit.min), limit.max);
    if (bounded !== values[key]) clamped.push(key);
    values[key] = bounded;
  }

  // 4. Invariants. Each fix is recorded, never silent.
  const adjustments: string[] = [];
  const fadeFloor = values.maxForwardSpeedMps + FADE_ABOVE_TOP_SPEED_MPS;
  if (values.engineFadeSpeedMps < fadeFloor) {
    values.engineFadeSpeedMps = Math.min(fadeFloor, SPEC_LIMITS.engineFadeSpeedMps.max);
    adjustments.push('engine fade raised to sit above the top speed');
  }
  if (values.lateralGripDriftPerSecond > values.lateralGripPerSecond) {
    values.lateralGripDriftPerSecond = values.lateralGripPerSecond;
    adjustments.push('drift grip capped at full grip');
  }
  if (values.maxDriftLateralAccelerationMps2 > values.maxLateralAccelerationMps2) {
    values.maxDriftLateralAccelerationMps2 = values.maxLateralAccelerationMps2;
    adjustments.push('drift lateral limit capped at full lateral limit');
  }
  if (values.steerAngleHighSpeedRadians > values.steerAngleLowSpeedRadians) {
    values.steerAngleHighSpeedRadians = values.steerAngleLowSpeedRadians;
    adjustments.push('high-speed steer capped at low-speed steer');
  }

  // A design may carry its own collision hull. Its footprint, and the body length that follows from it, replace the base
  // values, so the simulation, road boundaries, and the visual all read the same hull.
  const hull = VEHICLE_DESIGNS[vehicle.id]?.hull;
  const footprint = hull
    ? {
        footprintRearMeters: hull.rearMeters,
        footprintFrontMeters: hull.frontMeters,
        footprintHalfWidthMeters: hull.halfWidthMeters,
        bodyLengthMeters: hull.rearMeters + hull.frontMeters,
      }
    : {};
  const config: VehicleConfig = Object.freeze({ ...base, ...values, ...footprint });
  return { vehicleId: vehicle.id, config, clamped, ignoredUpgrades, adjustments };
}

/** One display row for the garage. `value` is the number in its display unit; `format` renders it. */
export interface SpecRow {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly decimals: number;
}

/** Rows the garage shows, in display units. Derived only from a VehicleConfig, so the display follows the pipeline. */
export function specRows(config: VehicleConfig): readonly SpecRow[] {
  return [
    { key: 'topSpeed', label: 'Top speed', unit: 'km/h', value: config.maxForwardSpeedMps * 3.6, decimals: 0 },
    { key: 'engine', label: 'Acceleration', unit: 'm/s²', value: config.engineAccelerationMps2, decimals: 1 },
    { key: 'brakes', label: 'Braking', unit: 'm/s²', value: config.brakeDecelerationMps2, decimals: 1 },
    { key: 'grip', label: 'Grip', unit: '1/s', value: config.lateralGripPerSecond, decimals: 1 },
    { key: 'cornering', label: 'Cornering limit', unit: 'm/s²', value: config.maxLateralAccelerationMps2, decimals: 1 },
    { key: 'steerLow', label: 'Steer at low speed', unit: '°', value: (config.steerAngleLowSpeedRadians * 180) / Math.PI, decimals: 0 },
    { key: 'steerHigh', label: 'Steer at high speed', unit: '°', value: (config.steerAngleHighSpeedRadians * 180) / Math.PI, decimals: 0 },
    { key: 'yaw', label: 'Turn-in lag', unit: 's', value: config.yawResponseSeconds, decimals: 2 },
    { key: 'driftGrip', label: 'Drift grip', unit: '1/s', value: config.lateralGripDriftPerSecond, decimals: 1 },
  ];
}

/** Formats a spec row value with its unit, e.g. "252 km/h". */
export function formatSpecValue(row: SpecRow): string {
  return `${row.value.toFixed(row.decimals)} ${row.unit}`;
}
