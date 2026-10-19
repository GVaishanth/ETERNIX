/*
 * Tests for the garage studio's lighting mapping. The studio follows the shared environment: at day with clear weather it
 * stays close to its fixed look, at night the key drops, and rain makes the floor glossy.
 */
import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { ETERNIX_PROTOTYPE_CONFIG as C } from '../../config/eternixPrototypeConfig';
import { TIME_OF_DAY_PRESETS, WEATHER_PRESETS, type TimeOfDayId, type WeatherId } from '../../config/environmentConfig';
import { lightingGoal, startingLive, type LiveLighting } from '../../render/liveLighting';
import { applyStudioLighting, studioTargets, WET_FLOOR_ROUGHNESS, type StudioSettings, type StudioTargets } from './studioLighting';

const SETTINGS: StudioSettings = {
  backgroundColour: C.showroom.backgroundColour,
  floorColour: C.showroom.floorColour,
  floorRoughness: C.showroom.floorRoughness,
  keyColour: C.showroom.keyColour,
  keyIntensity: C.showroom.keyIntensity,
  fillColour: C.showroom.fillColour,
  fillIntensity: C.showroom.fillIntensity,
};

function lightFor(time: TimeOfDayId, weather: WeatherId): LiveLighting {
  return startingLive(time, weather);
}

function studioFor(time: TimeOfDayId, weather: WeatherId): { base: StudioTargets; out: StudioTargets } {
  const base = studioTargets(SETTINGS);
  const out = studioTargets(SETTINGS);
  applyStudioLighting(lightFor(time, weather), base, out);
  return { base, out };
}

function luminance(colour: Color): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}

describe('studio lighting follows the shared environment', () => {
  it('at day with clear weather keeps the key and fill strengths of the fixed studio', () => {
    const { out } = studioFor('day', 'clear');
    expect(out.keyIntensity).toBeCloseTo(SETTINGS.keyIntensity, 3);
    expect(out.fillIntensity).toBeCloseTo(SETTINGS.fillIntensity, 3);
    expect(out.floorRoughness).toBeCloseTo(SETTINGS.floorRoughness, 3);
  });

  it('dims the key at night and keeps it above the floor limit', () => {
    const day = studioFor('day', 'clear').out;
    const night = studioFor('night', 'clear').out;
    expect(night.keyIntensity).toBeLessThan(day.keyIntensity);
    expect(night.keyIntensity).toBeGreaterThan(0);
  });

  it('is brighter at evening than at night for the key, and never blows out past the range', () => {
    const evening = studioFor('evening', 'clear').out;
    const night = studioFor('night', 'clear').out;
    expect(evening.keyIntensity).toBeGreaterThan(night.keyIntensity);
    expect(evening.keyIntensity).toBeLessThanOrEqual(SETTINGS.keyIntensity * 1.2 + 1e-9);
  });

  it('makes the floor glossy in rain, and not otherwise', () => {
    const dry = studioFor('day', 'clear').out;
    const wet = studioFor('day', 'rain').out;
    expect(wet.floorRoughness).toBeCloseTo(WET_FLOOR_ROUGHNESS, 3);
    expect(wet.floorRoughness).toBeLessThan(dry.floorRoughness);
  });

  it('keeps the studio background dark at every time of day, so the car still reads against it', () => {
    for (const time of Object.keys(TIME_OF_DAY_PRESETS) as TimeOfDayId[]) {
      for (const weather of Object.keys(WEATHER_PRESETS) as WeatherId[]) {
        const { out } = studioFor(time, weather);
        expect(luminance(out.background)).toBeLessThan(0.12);
      }
    }
  });

  it('shifts the key colour toward the environment sun colour, and changes nothing when the base is not mutated', () => {
    const base = studioTargets(SETTINGS);
    const baseKey = base.key.clone();
    const out = studioTargets(SETTINGS);
    applyStudioLighting(lightFor('night', 'clear'), base, out);
    expect(base.key.equals(baseKey)).toBe(true);
    expect(out.key.equals(baseKey)).toBe(false);
  });

  it('reaches the goal in the same values the game uses (the goal is the shared lighting)', () => {
    const goal = lightingGoal('evening', 'rain');
    const live = lightFor('evening', 'rain');
    expect(live.wetness).toBeCloseTo(goal.wetness, 6);
    expect(live.sunIntensity).toBeCloseTo(TIME_OF_DAY_PRESETS.evening.sunIntensity, 6);
  });
});
