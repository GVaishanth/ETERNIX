/*
 * Night lights (pure rules and the consumer registry). No rendering: the materials and lights are plain objects here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TIME_OF_DAY_PRESETS } from '../config/environmentConfig';
import {
  HEADLIGHT_EMISSIVE,
  LAMP_HEAD_EMISSIVE,
  applyNightLevel,
  currentNightLevel,
  headlightEmissive,
  headlightSpotIntensity,
  lampHeadEmissive,
  lampLevelFor,
  lampPoolOpacity,
  registerNightLight,
  registeredNightLightCount,
} from './nightLights';

describe('night level from the time of day', () => {
  it('is 0 in full day and 1 at full night, taken from the presets', () => {
    expect(lampLevelFor(TIME_OF_DAY_PRESETS.day.lampMultiplier)).toBe(0);
    expect(lampLevelFor(TIME_OF_DAY_PRESETS.night.lampMultiplier)).toBe(1);
  });

  it('is partly on at dusk, between day and night', () => {
    const dusk = lampLevelFor(TIME_OF_DAY_PRESETS.evening.lampMultiplier);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it('stays inside 0..1 outside the presets', () => {
    expect(lampLevelFor(-5)).toBe(0);
    expect(lampLevelFor(100)).toBe(1);
  });
});

describe('light values by night level', () => {
  it('headlights are dim by day and bright at night', () => {
    expect(headlightEmissive(0)).toBe(HEADLIGHT_EMISSIVE.day);
    expect(headlightEmissive(1)).toBe(HEADLIGHT_EMISSIVE.night);
    expect(headlightEmissive(1)).toBeGreaterThan(headlightEmissive(0));
  });

  it('lamp heads are unlit by day and lit at night', () => {
    expect(lampHeadEmissive(0)).toBe(LAMP_HEAD_EMISSIVE.day);
    expect(lampHeadEmissive(1)).toBe(LAMP_HEAD_EMISSIVE.night);
  });

  it('light pools and the player headlights are off by day', () => {
    expect(lampPoolOpacity(0)).toBe(0);
    expect(headlightSpotIntensity(0)).toBe(0);
    expect(lampPoolOpacity(1)).toBeGreaterThan(0);
    expect(headlightSpotIntensity(1)).toBeGreaterThan(0);
  });

  it('clamps a level outside 0..1', () => {
    expect(headlightEmissive(2)).toBe(HEADLIGHT_EMISSIVE.night);
    expect(headlightSpotIntensity(-1)).toBe(0);
  });
});

describe('the night level registry', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    while (cleanup.length) cleanup.pop()?.();
  });

  it('pushes a changed level to every consumer, and a new consumer gets the current level at once', () => {
    applyNightLevel(0.25);
    const seen: number[] = [];
    cleanup.push(registerNightLight((level) => seen.push(level)));
    expect(seen).toEqual([0.25]);
    applyNightLevel(0.75);
    expect(seen).toEqual([0.25, 0.75]);
    expect(currentNightLevel()).toBe(0.75);
  });

  it('does not push an unchanged level again', () => {
    applyNightLevel(0.5);
    let calls = 0;
    cleanup.push(registerNightLight(() => (calls += 1)));
    const before = calls;
    applyNightLevel(0.5);
    applyNightLevel(0.50001);
    expect(calls).toBe(before);
  });

  it('stops calling a consumer after it unregisters', () => {
    applyNightLevel(0);
    const seen: number[] = [];
    const unregister = registerNightLight((level) => seen.push(level));
    unregister();
    const countAfter = registeredNightLightCount();
    applyNightLevel(1);
    expect(seen).toEqual([0]);
    expect(registeredNightLightCount()).toBe(countAfter);
  });
});
