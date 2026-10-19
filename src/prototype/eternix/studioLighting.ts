/*
 * The garage studio's lights, background, and floor, following the shared environment (the same live values the game
 * and the home page use). Pure: it writes into target objects it is given, and holds no React or scene state.
 *
 * The studio keeps its layout, its red rim, and its reflections. The time of day and the weather change the key and
 * fill colour and strength, the background and floor tint, and how glossy the floor is. At day with clear weather the
 * studio stays close to its original look. The mix shares are below: 0 keeps the fixed studio colour, 1 is the
 * environment's colour.
 */
import { Color } from 'three';
import { TIME_OF_DAY_PRESETS } from '../../config/environmentConfig';
import type { LiveLighting } from '../../render/liveLighting';

export interface StudioSettings {
  readonly backgroundColour: string;
  readonly floorColour: string;
  readonly floorRoughness: number;
  readonly keyColour: string;
  readonly keyIntensity: number;
  readonly fillColour: string;
  readonly fillIntensity: number;
}

/** The colours and strengths the studio renders with. `base` holds the fixed settings; `out` is written each frame. */
export interface StudioTargets {
  readonly background: Color;
  readonly floor: Color;
  floorRoughness: number;
  readonly key: Color;
  keyIntensity: number;
  readonly fill: Color;
  fillIntensity: number;
}

/** Share of the environment colour mixed into each studio colour. */
export const STUDIO_MIX = {
  background: 0.06,
  floor: 0.05,
  key: 0.6,
  fill: 0.5,
} as const;

/** Floor roughness when it rains: a wet, glossy studio floor. */
export const WET_FLOOR_ROUGHNESS = 0.12;

/** The day preset is the reference: at day the strengths are the settings, at night they drop with the sun and ambient. */
const DAY = TIME_OF_DAY_PRESETS.day;

/** Limits on the strength scale, so the studio never goes fully dark or blows out. */
const KEY_SCALE_RANGE = [0.2, 1.2] as const;
const FILL_SCALE_RANGE = [0.3, 1.2] as const;

function clamp(value: number, [low, high]: readonly [number, number]): number {
  return Math.min(high, Math.max(low, value));
}

/** Fresh targets for a set of studio settings. Used once for the fixed base and once for the frame output. */
export function studioTargets(settings: StudioSettings): StudioTargets {
  return {
    background: new Color(settings.backgroundColour),
    floor: new Color(settings.floorColour),
    floorRoughness: settings.floorRoughness,
    key: new Color(settings.keyColour),
    keyIntensity: settings.keyIntensity,
    fill: new Color(settings.fillColour),
    fillIntensity: settings.fillIntensity,
  };
}

/**
 * Writes the studio's colours and strengths for the live lighting into `out`. `base` is never changed. No allocation:
 * the colours in `out` are updated in place, so this can run every frame.
 */
export function applyStudioLighting(live: LiveLighting, base: StudioTargets, out: StudioTargets): void {
  const keyScale = clamp(live.sunIntensity / DAY.sunIntensity, KEY_SCALE_RANGE);
  const fillScale = clamp(live.ambientIntensity / DAY.ambientIntensity, FILL_SCALE_RANGE);
  out.background.copy(base.background).lerp(live.sky, STUDIO_MIX.background);
  out.floor.copy(base.floor).lerp(live.sky, STUDIO_MIX.floor);
  out.floorRoughness = base.floorRoughness + (WET_FLOOR_ROUGHNESS - base.floorRoughness) * clamp(live.wetness, [0, 1]);
  out.key.copy(base.key).lerp(live.sun, STUDIO_MIX.key);
  out.keyIntensity = base.keyIntensity * keyScale;
  out.fill.copy(base.fill).lerp(live.ambient, STUDIO_MIX.fill);
  out.fillIntensity = base.fillIntensity * fillScale;
}
