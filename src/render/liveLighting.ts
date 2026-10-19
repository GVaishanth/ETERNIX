/*
 * The live lighting values shared by the game (Environment.tsx) and the home page hero (HeroEnvironment.tsx). Each
 * frame the live values approach the goal for the shared environment. A change of time or weather is gradual, and
 * frame-rate independent. Colours here are linear working colours. The goal is in sRGB and is converted once a frame.
 */
import { Color, SRGBColorSpace } from 'three';
import { TIME_OF_DAY_PRESETS, TIME_OF_DAY_TRANSITION_SECONDS, WEATHER_PRESETS, WEATHER_TRANSITION_SECONDS, type TimeOfDayId, type WeatherId } from '../config/environmentConfig';
import { approach, lightingFor, type LightingValues } from '../environment/environmentModel';

export interface LiveLighting {
  readonly sky: Color;
  readonly fog: Color;
  readonly ambient: Color;
  readonly sun: Color;
  fogNear: number;
  fogFar: number;
  ambientIntensity: number;
  sunIntensity: number;
  lampMultiplier: number;
  wetness: number;
}

/** The goal lighting for a time of day and weather. */
export function lightingGoal(timeOfDay: TimeOfDayId, weather: WeatherId): LightingValues {
  const time = TIME_OF_DAY_PRESETS[timeOfDay];
  const preset = WEATHER_PRESETS[weather];
  return lightingFor(time, time, 0, preset, preset.wetness);
}

/** Linear working colour from an RGB triple in 0..1 (sRGB). */
function toColor(rgb: readonly [number, number, number]): Color {
  return new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
}

/** The live values already at their goal. A load starts here, so it does not blend in from day. */
export function startingLive(timeOfDay: TimeOfDayId, weather: WeatherId): LiveLighting {
  const v = lightingGoal(timeOfDay, weather);
  return {
    sky: toColor(v.sky),
    fog: toColor(v.fog),
    ambient: toColor(v.ambient),
    sun: toColor(v.sun),
    fogNear: v.fogNear,
    fogFar: v.fogFar,
    ambientIntensity: v.ambientIntensity,
    sunIntensity: v.sunIntensity,
    lampMultiplier: v.lampMultiplier,
    wetness: v.wetness,
  };
}

const scratch = new Color();

function approachColor(live: Color, goal: readonly [number, number, number], dt: number): void {
  scratch.setRGB(goal[0], goal[1], goal[2], SRGBColorSpace);
  live.r = approach(live.r, scratch.r, dt, TIME_OF_DAY_TRANSITION_SECONDS);
  live.g = approach(live.g, scratch.g, dt, TIME_OF_DAY_TRANSITION_SECONDS);
  live.b = approach(live.b, scratch.b, dt, TIME_OF_DAY_TRANSITION_SECONDS);
}

const SETTLED_EPSILON = 1e-3;

/** True when a live colour is within the tolerance of a goal sRGB colour, on every channel. */
function colourSettled(live: Color, goal: readonly [number, number, number]): boolean {
  scratch.setRGB(goal[0], goal[1], goal[2], SRGBColorSpace);
  return (
    Math.abs(live.r - scratch.r) < SETTLED_EPSILON &&
    Math.abs(live.g - scratch.g) < SETTLED_EPSILON &&
    Math.abs(live.b - scratch.b) < SETTLED_EPSILON
  );
}

/**
 * Moves the live values one frame toward the goal. Returns true when every value is within a hair of its goal, so a
 * caller that renders on demand can stop asking for frames.
 */
export function stepLiveLighting(live: LiveLighting, goal: LightingValues, dt: number): boolean {
  approachColor(live.sky, goal.sky, dt);
  approachColor(live.fog, goal.fog, dt);
  approachColor(live.ambient, goal.ambient, dt);
  approachColor(live.sun, goal.sun, dt);
  live.fogNear = approach(live.fogNear, goal.fogNear, dt, TIME_OF_DAY_TRANSITION_SECONDS);
  live.fogFar = approach(live.fogFar, goal.fogFar, dt, TIME_OF_DAY_TRANSITION_SECONDS);
  live.ambientIntensity = approach(live.ambientIntensity, goal.ambientIntensity, dt, TIME_OF_DAY_TRANSITION_SECONDS);
  live.sunIntensity = approach(live.sunIntensity, goal.sunIntensity, dt, TIME_OF_DAY_TRANSITION_SECONDS);
  live.lampMultiplier = approach(live.lampMultiplier, goal.lampMultiplier, dt, TIME_OF_DAY_TRANSITION_SECONDS);
  live.wetness = approach(live.wetness, goal.wetness, dt, WEATHER_TRANSITION_SECONDS);
  return (
    colourSettled(live.sky, goal.sky) &&
    colourSettled(live.fog, goal.fog) &&
    colourSettled(live.ambient, goal.ambient) &&
    colourSettled(live.sun, goal.sun) &&
    Math.abs(live.fogNear - goal.fogNear) < SETTLED_EPSILON &&
    Math.abs(live.fogFar - goal.fogFar) < SETTLED_EPSILON &&
    Math.abs(live.ambientIntensity - goal.ambientIntensity) < SETTLED_EPSILON &&
    Math.abs(live.sunIntensity - goal.sunIntensity) < SETTLED_EPSILON &&
    Math.abs(live.lampMultiplier - goal.lampMultiplier) < SETTLED_EPSILON &&
    Math.abs(live.wetness - goal.wetness) < SETTLED_EPSILON
  );
}
