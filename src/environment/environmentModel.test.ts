/*
 * Automated tests for the environment model (Part 10): colour parsing, lighting blends, frame-rate independent
 * transitions, the N and M cycles, rain counts, roughness, and the symmetric wrap used by the rain field.
 * Pure functions only: no three.js and no React.
 */
import { describe, expect, it } from 'vitest';
import { pickNextEnvironment } from './environmentModel';
import { TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '../config/environmentConfig';
import {
  approach,
  clamp01,
  hexToRgb,
  lerpRoughness,
  lightingFor,
  nextTimeOfDay,
  nextWeather,
  rainStreakCount,
  stepToward,
  transitionStep,
  wrapSymmetric,
} from './environmentModel';

const day = TIME_OF_DAY_PRESETS.day;
const night = TIME_OF_DAY_PRESETS.night;
const clear = WEATHER_PRESETS.clear;
const rain = WEATHER_PRESETS.rain;

describe('hexToRgb and clamp01', () => {
  it('parses white, black, and a mid grey into 0..1 channels', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    const grey = hexToRgb('#808080');
    expect(grey[0]).toBeCloseTo(128 / 255, 6);
  });

  it('clamps values into 0..1 and maps NaN to 0', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('lightingFor', () => {
  it('returns the preset values exactly at the start of a clear day', () => {
    const lighting = lightingFor(day, day, 0, clear, 0);
    expect(lighting.fogNear).toBe(day.fogNearMeters);
    expect(lighting.fogFar).toBe(day.fogFarMeters);
    expect(lighting.ambientIntensity).toBe(day.ambientIntensity);
    expect(lighting.sunIntensity).toBe(day.sunIntensity);
    expect(lighting.wetness).toBe(0);
  });

  it('blends the two times of day by the blend factor', () => {
    const mid = lightingFor(day, night, 0.5, clear, 0);
    expect(mid.ambientIntensity).toBeCloseTo((day.ambientIntensity + night.ambientIntensity) / 2, 9);
    expect(mid.lampMultiplier).toBeCloseTo((day.lampMultiplier + night.lampMultiplier) / 2, 9);
  });

  it('scales fog and ambient by the weather only as wetness rises', () => {
    const wet = lightingFor(day, day, 0, rain, 1);
    expect(wet.fogFar).toBeCloseTo(day.fogFarMeters * rain.fogScale, 6);
    expect(wet.ambientIntensity).toBeCloseTo(day.ambientIntensity * rain.ambientScale, 6);
    expect(wet.wetness).toBe(1);
    const half = lightingFor(day, day, 0, rain, 0.5);
    expect(half.fogFar).toBeCloseTo(day.fogFarMeters * (1 + (rain.fogScale - 1) * 0.5), 6);
  });

  it('clamps the blend and the wetness into 0..1', () => {
    const over = lightingFor(day, night, 9, clear, 4);
    expect(over.ambientIntensity).toBeCloseTo(night.ambientIntensity, 9);
    expect(over.wetness).toBe(1);
  });
});

describe('stepToward and transitionStep', () => {
  it('never moves more than maxDelta and lands exactly on the target', () => {
    expect(stepToward(0, 10, 3)).toBe(3);
    expect(stepToward(3, 10, 3)).toBe(6);
    expect(stepToward(9, 10, 3)).toBe(10);
    expect(stepToward(5, 2, 1)).toBe(4);
    expect(stepToward(2, 2, 1)).toBe(2);
  });

  it('turns a duration into a per-second step, with infinity for an instant change', () => {
    expect(transitionStep(0.5, 2)).toBeCloseTo(0.25, 9);
    expect(transitionStep(-1, 2)).toBe(0);
    expect(transitionStep(0.5, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('approach (frame-rate independent)', () => {
  it('does not move with zero time, and reaches the target with a non-positive duration', () => {
    expect(approach(0, 1, 0, 6)).toBe(0);
    expect(approach(0, 1, 1, 0)).toBe(1);
  });

  it('covers about 98 percent of the change in the stated duration', () => {
    const value = approach(0, 1, 6, 6);
    expect(value).toBeGreaterThan(0.97);
    expect(value).toBeLessThan(0.99);
  });

  it('gives the same result for one long step and two half steps', () => {
    const once = approach(0, 1, 1, 6);
    const twice = approach(approach(0, 1, 0.5, 6), 1, 0.5, 6);
    expect(twice).toBeCloseTo(once, 12);
  });
});

describe('the N and M cycles', () => {
  it('cycles day, evening, night, and back to day', () => {
    expect(nextTimeOfDay('day')).toBe('evening');
    expect(nextTimeOfDay('evening')).toBe('night');
    expect(nextTimeOfDay('night')).toBe('day');
  });

  it('restarts the time-of-day cycle at day for an unknown id', () => {
    expect(nextTimeOfDay('dawn' as never)).toBe('day');
  });

  it('toggles clear and rain', () => {
    expect(nextWeather('clear')).toBe('rain');
    expect(nextWeather('rain')).toBe('clear');
  });
});

describe('rainStreakCount', () => {
  it('is zero when dry and the full budget when wet', () => {
    expect(rainStreakCount(500, 0)).toBe(0);
    expect(rainStreakCount(500, 1)).toBe(500);
    expect(rainStreakCount(500, 0.5)).toBe(250);
  });

  it('never exceeds the budget or goes negative', () => {
    expect(rainStreakCount(500, 3)).toBe(500);
    expect(rainStreakCount(-10, 1)).toBe(0);
  });
});

describe('lerpRoughness', () => {
  it('moves from dry to wet roughness with wetness, and clamps', () => {
    expect(lerpRoughness(0.9, 0.4, 0)).toBeCloseTo(0.9, 9);
    expect(lerpRoughness(0.9, 0.4, 1)).toBeCloseTo(0.4, 9);
    expect(lerpRoughness(0.9, 0.4, 0.5)).toBeCloseTo(0.65, 9);
    expect(lerpRoughness(0.9, 0.4, 2)).toBeCloseTo(0.4, 9);
  });
});

describe('wrapSymmetric', () => {
  it('keeps a value in [-half, half) and leaves in-range values alone', () => {
    expect(wrapSymmetric(0, 10)).toBe(0);
    expect(wrapSymmetric(4, 10)).toBe(4);
    expect(wrapSymmetric(10, 10)).toBe(-10);
    expect(wrapSymmetric(15, 10)).toBe(-5);
    expect(wrapSymmetric(-15, 10)).toBe(5);
    expect(wrapSymmetric(-10, 10)).toBe(-10);
  });

  it('wraps many periods away to the same place', () => {
    expect(wrapSymmetric(3 + 20 * 50, 10)).toBeCloseTo(3, 9);
  });
});

describe('pickNextEnvironment', () => {
  it('never returns the current pair', () => {
    const current = { timeOfDay: 'day' as const, weather: 'clear' as const };
    for (let i = 0; i < 200; i += 1) {
      const next = pickNextEnvironment(current, () => i / 200);
      expect(next.timeOfDay === current.timeOfDay && next.weather === current.weather).toBe(false);
    }
  });

  it('reaches every other pair', () => {
    const current = { timeOfDay: 'night' as const, weather: 'rain' as const };
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const next = pickNextEnvironment(current, () => i / 100);
      seen.add(`${next.timeOfDay}/${next.weather}`);
    }
    expect(seen.size).toBe(5);
  });

  it('still avoids the current pair when the random source returns its upper bound', () => {
    const next = pickNextEnvironment({ timeOfDay: 'day', weather: 'clear' }, () => 1);
    expect(next.timeOfDay === 'day' && next.weather === 'clear').toBe(false);
  });
});
