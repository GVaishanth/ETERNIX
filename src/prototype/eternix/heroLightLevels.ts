/*
 * How the shared environment drives the landing's own light rig. The hero was lit for its own studio look, so each
 * shared value scales the rig's intensity or fog relative to the day preset. Day is therefore the rig as configured,
 * dusk and night dim it, and rain thickens the fog. Pure, so the mapping is tested without WebGL.
 */
import { TIME_OF_DAY_PRESETS } from '../../config/environmentConfig';
import type { LiveLighting } from '../../render/liveLighting';

export interface HeroRigSettings {
  readonly hemisphereIntensity: number;
  readonly keyIntensity: number;
  readonly tailLightIntensity: number;
  readonly fogNearMeters: number;
  readonly fogFarMeters: number;
}

export interface HeroLightLevels {
  readonly hemisphere: number;
  readonly key: number;
  readonly tailLight: number;
  readonly fogNear: number;
  readonly fogFar: number;
}

const DAY = TIME_OF_DAY_PRESETS.day;

/** value / reference, clamped to 0..3. A zero reference leaves the rig unchanged. */
function ratio(value: number, reference: number): number {
  if (!(reference > 0) || !Number.isFinite(value)) return 1;
  return Math.min(3, Math.max(0, value / reference));
}

/** The hero's light and fog levels for the live shared lighting. */
export function heroLightLevels(live: Pick<LiveLighting, 'ambientIntensity' | 'sunIntensity' | 'lampMultiplier' | 'fogNear' | 'fogFar'>, rig: HeroRigSettings): HeroLightLevels {
  return {
    hemisphere: rig.hemisphereIntensity * ratio(live.ambientIntensity, DAY.ambientIntensity),
    key: rig.keyIntensity * ratio(live.sunIntensity, DAY.sunIntensity),
    tailLight: rig.tailLightIntensity * ratio(live.lampMultiplier, DAY.lampMultiplier),
    fogNear: rig.fogNearMeters * ratio(live.fogNear, DAY.fogNearMeters),
    fogFar: rig.fogFarMeters * ratio(live.fogFar, DAY.fogFarMeters),
  };
}
