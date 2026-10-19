/*
 * Part 10 environment rules (pure). Blends the time-of-day and weather presets, steps the live values toward their
 * targets, and gives the cycle order. No React, no three.js. The Environment component reads these every frame.
 */
import { TIME_OF_DAY_ORDER, WEATHER_ORDER, type TimeOfDayId, type TimeOfDayPreset, type WeatherId, type WeatherPreset } from '../config/environmentConfig';

/** The live lighting values the renderer uses. Colours are RGB in 0..1. */
export interface LightingValues {
  readonly sky: readonly [number, number, number];
  readonly fog: readonly [number, number, number];
  readonly fogNear: number;
  readonly fogFar: number;
  readonly ambient: readonly [number, number, number];
  readonly ambientIntensity: number;
  readonly sun: readonly [number, number, number];
  readonly sunIntensity: number;
  readonly lampMultiplier: number;
  /** 0 dry to 1 wet. */
  readonly wetness: number;
}

/** Parses '#rrggbb' into RGB in 0..1. Throws on anything else, so a bad colour in config is caught by the tests. */
export function hexToRgb(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match || !match[1]) throw new Error(`environment: colour "${hex}" must be #rrggbb`);
  const value = parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** The lighting for a time of day and weather, at a given wetness. Lerps the two presets by `blend` (0 is a, 1 is b). */
export function lightingFor(a: TimeOfDayPreset, b: TimeOfDayPreset, blend: number, weather: WeatherPreset, wetness: number): LightingValues {
  const t = clamp01(blend);
  const wet = clamp01(wetness);
  const fogScale = lerp(1, weather.fogScale, wet);
  const ambientScale = lerp(1, weather.ambientScale, wet);
  return {
    sky: lerpRgb(hexToRgb(a.skyColor), hexToRgb(b.skyColor), t),
    fog: lerpRgb(hexToRgb(a.fogColor), hexToRgb(b.fogColor), t),
    fogNear: lerp(a.fogNearMeters, b.fogNearMeters, t) * fogScale,
    fogFar: lerp(a.fogFarMeters, b.fogFarMeters, t) * fogScale,
    ambient: lerpRgb(hexToRgb(a.ambientColor), hexToRgb(b.ambientColor), t),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t) * ambientScale,
    sun: lerpRgb(hexToRgb(a.sunColor), hexToRgb(b.sunColor), t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    lampMultiplier: lerp(a.lampMultiplier, b.lampMultiplier, t),
    wetness: wet,
  };
}

/**
 * Moves `current` toward `target` by at most `maxDelta`. Used for every transition, so no value jumps. `maxDelta` is
 * already scaled by the frame time, which keeps transitions frame-rate independent.
 */
export function stepToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** How far a value may move in `dt` seconds for a transition that takes `seconds` end to end. */
export function transitionStep(dt: number, seconds: number): number {
  if (!(seconds > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(0, dt) / seconds;
}

/** The next time of day in the N-key cycle. Unknown ids restart the cycle at day. */
export function nextTimeOfDay(current: TimeOfDayId): TimeOfDayId {
  const index = TIME_OF_DAY_ORDER.indexOf(current);
  return TIME_OF_DAY_ORDER[(index + 1) % TIME_OF_DAY_ORDER.length] ?? 'day';
}

/** The next weather in the M-key cycle. */
export function nextWeather(current: WeatherId): WeatherId {
  const index = WEATHER_ORDER.indexOf(current);
  return WEATHER_ORDER[(index + 1) % WEATHER_ORDER.length] ?? 'clear';
}

/** Rain streak count for a quality preset at a wetness level. Bounded by the preset, never by the frame rate. */
export function rainStreakCount(maxStreaks: number, wetness: number): number {
  return Math.round(Math.max(0, maxStreaks) * clamp01(wetness));
}

/**
 * Frame-rate independent approach: moves `current` toward `target` so that about 98% of the change happens in `seconds`.
 * Used for lighting and weather, so a change is gradual at any frame rate and never jumps.
 */
export function approach(current: number, target: number, dtSeconds: number, seconds: number): number {
  if (!(seconds > 0)) return target;
  const k = 4 / seconds;
  const factor = 1 - Math.exp(-k * Math.max(0, dtSeconds));
  return current + (target - current) * factor;
}

/** Asphalt roughness for a wetness level. Pure, so the road material rule is testable without three.js. */
export function lerpRoughness(dry: number, wet: number, wetness: number): number {
  return lerp(dry, wet, clamp01(wetness));
}

/** Wraps `value` into [-half, half). Streaks use it to stay in a box around the camera. */
export function wrapSymmetric(value: number, half: number): number {
  const span = half * 2;
  return ((((value + half) % span) + span) % span) - half;
}

/** One time of day and one weather together: the environment the whole world shows. */
export interface EnvironmentChoice {
  readonly timeOfDay: TimeOfDayId;
  readonly weather: WeatherId;
}

/**
 * The next random environment. It is never the same pair as the current one, so every change is visible. `random`
 * returns a number in [0, 1). The choice is uniform over the other pairs.
 */
export function pickNextEnvironment(current: EnvironmentChoice, random: () => number): EnvironmentChoice {
  const options: EnvironmentChoice[] = [];
  for (const timeOfDay of TIME_OF_DAY_ORDER) {
    for (const weather of WEATHER_ORDER) {
      if (timeOfDay !== current.timeOfDay || weather !== current.weather) options.push({ timeOfDay, weather });
    }
  }
  const roll = clamp01(random());
  const index = Math.min(options.length - 1, Math.floor(roll * options.length));
  return options[index] ?? { timeOfDay: 'day', weather: 'clear' };
}
