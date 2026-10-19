/*
 * Night lights for the game: street lamps, headlights, and the light pools under the lamps.
 *
 * The environment sets one night level each frame, from 0 (full day) to 1 (full night). It is derived from the time of
 * day's lampMultiplier, which the presets already define ("lamps read as lit only after dusk"). Consumers register a
 * function that applies the level to their own material or light. Only a changed level is pushed, so an idle frame does
 * no work. Nothing here touches the simulation.
 */
import { CanvasTexture, type Texture } from 'three';
import { TIME_OF_DAY_PRESETS } from '../config/environmentConfig';

const DAY_LAMP_MULTIPLIER = TIME_OF_DAY_PRESETS.day.lampMultiplier;
const NIGHT_LAMP_MULTIPLIER = TIME_OF_DAY_PRESETS.night.lampMultiplier;

/** Emissive intensity of a car's headlights, by day and by night. Taillights and police lamps are not changed here. */
export const HEADLIGHT_EMISSIVE = { day: 0.3, night: 1.6 } as const;
/** Emissive intensity of a street lamp head, by day and by night. Day is dark, so the heads read as unlit lamps. */
export const LAMP_HEAD_EMISSIVE = { day: 0, night: 2.2 } as const;
/** Opacity of the light pool under each lamp, at full night. */
export const LAMP_POOL_OPACITY_NIGHT = 0.55;
/** Peak intensity of one player headlight at full night, in candela. Shadowless. Tuned by eye in a browser. */
export const HEADLIGHT_SPOT_INTENSITY_NIGHT = 60;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mix(day: number, night: number, level: number): number {
  return day + (night - day) * clamp01(level);
}

/** The night level (0..1) for a time of day's lampMultiplier. Day is 0, full night is 1, dusk is in between. */
export function lampLevelFor(lampMultiplier: number): number {
  const span = NIGHT_LAMP_MULTIPLIER - DAY_LAMP_MULTIPLIER;
  if (span <= 0) return 0;
  return clamp01((lampMultiplier - DAY_LAMP_MULTIPLIER) / span);
}

/** Headlight emissive intensity at a night level. */
export function headlightEmissive(level: number): number {
  return mix(HEADLIGHT_EMISSIVE.day, HEADLIGHT_EMISSIVE.night, level);
}

/** Lamp head emissive intensity at a night level. */
export function lampHeadEmissive(level: number): number {
  return mix(LAMP_HEAD_EMISSIVE.day, LAMP_HEAD_EMISSIVE.night, level);
}

/** Light pool opacity at a night level. */
export function lampPoolOpacity(level: number): number {
  return clamp01(level) * LAMP_POOL_OPACITY_NIGHT;
}

/** Player headlight intensity at a night level. */
export function headlightSpotIntensity(level: number): number {
  return clamp01(level) * HEADLIGHT_SPOT_INTENSITY_NIGHT;
}

type NightConsumer = (level: number) => void;

const consumers = new Set<NightConsumer>();
let appliedLevel: number | null = null;

/**
 * Registers a consumer. It is called at once with the current level, so a new consumer never shows a stale look. The
 * returned function unregisters it. Call it on unmount or dispose.
 */
export function registerNightLight(consumer: NightConsumer): () => void {
  consumers.add(consumer);
  if (appliedLevel !== null) consumer(appliedLevel);
  return () => {
    consumers.delete(consumer);
  };
}

/** Sets the night level (0..1) for every consumer. Skips the work when the level has not changed. */
export function applyNightLevel(level: number): void {
  const next = clamp01(level);
  if (appliedLevel !== null && Math.abs(next - appliedLevel) < 1e-4) return;
  appliedLevel = next;
  for (const consumer of consumers) consumer(next);
}

/** The last night level applied, or null before the first one. For tests and the DEV read-out. */
export function currentNightLevel(): number | null {
  return appliedLevel;
}

/** Number of registered consumers. For tests. */
export function registeredNightLightCount(): number {
  return consumers.size;
}

/**
 * A soft round light texture for the light pools: warm at the centre, fading to nothing at the edge. Returns null where
 * there is no DOM canvas (for example in a test), and the caller then draws no pools.
 */
export function createLampPoolTexture(): Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 224, 170, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 210, 150, 0.45)');
  gradient.addColorStop(1, 'rgba(255, 200, 140, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}
