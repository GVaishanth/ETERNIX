/*
 * Road surface effect on the car. A dirt segment scales the speed and grip of the vehicle config, for the step that
 * drives on it. Pure except for the wetness source, which the app sets from the weather. The car does not change; only
 * the config it is stepped with does. The scaled configs are cached, so a step allocates nothing.
 */
import { DIRT_DRY_REDUCTION, DIRT_WET_REDUCTION } from '../config/surfaceConfig';
import type { VehicleConfig } from '../config/vehicleConfig';
import type { RoadBoundary } from './roadBoundary';

/** Wetness of the current weather, 0 dry to 1 soaked. The app sets this from the weather. Defaults to dry. */
let wetnessSource: () => number = () => 0;

export function setSurfaceWetnessSource(source: () => number): void {
  wetnessSource = source;
}

/** The fraction of speed and grip lost on dirt, for a wetness from 0 to 1. Linear, and never more than the wet value. */
export function dirtReduction(wetness: number): number {
  const w = Math.min(1, Math.max(0, wetness));
  return DIRT_DRY_REDUCTION + (DIRT_WET_REDUCTION - DIRT_DRY_REDUCTION) * w;
}

const scaledCache = new WeakMap<VehicleConfig, Map<number, VehicleConfig>>();

/** The vehicle config on dirt: top speed, engine fade (which sets the top speed), and lateral grip all scaled down. */
export function vehicleOnDirt(config: VehicleConfig, reduction: number): VehicleConfig {
  if (reduction <= 0) return config;
  let byReduction = scaledCache.get(config);
  if (!byReduction) {
    byReduction = new Map();
    scaledCache.set(config, byReduction);
  }
  // Wetness is continuous, so the cache key is rounded to 0.1%.
  const key = Math.round(reduction * 1000);
  const cached = byReduction.get(key);
  if (cached) return cached;
  const k = 1 - key / 1000;
  const scaled: VehicleConfig = {
    ...config,
    maxForwardSpeedMps: config.maxForwardSpeedMps * k,
    engineFadeSpeedMps: config.engineFadeSpeedMps * k,
    lateralGripPerSecond: config.lateralGripPerSecond * k,
    lateralGripDriftPerSecond: config.lateralGripDriftPerSecond * k,
    maxLateralAccelerationMps2: config.maxLateralAccelerationMps2 * k,
    maxDriftLateralAccelerationMps2: config.maxDriftLateralAccelerationMps2 * k,
  };
  byReduction.set(key, scaled);
  return scaled;
}

/** The config to step a car with, given the segment it is on. Asphalt, or no segment, gives the config back unchanged. */
export function configOnSegment(
  config: VehicleConfig,
  boundary: Pick<RoadBoundary, 'dirtSegments'> | null | undefined,
  segmentId: string | null,
): VehicleConfig {
  if (segmentId === null || !boundary?.dirtSegments?.has(segmentId)) return config;
  return vehicleOnDirt(config, dirtReduction(wetnessSource()));
}
