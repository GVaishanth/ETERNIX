/*
 * Automated tests for the presentation settings model (Part 10): quality cycling, validation and repair of stored
 * values, the defaults, and the type guards. Pure functions only.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY, QUALITY_PRESETS } from '../config/qualityConfig';
import {
  DEFAULT_SETTINGS,
  isKnownTimeOfDay,
  isKnownWeather,
  nextQuality,
  qualityPreset,
  sanitizeSettings,
} from './qualityModel';

describe('defaults and presets', () => {
  it('defaults to medium quality and the configured default volume', () => {
    expect(DEFAULT_QUALITY).toBe('medium');
    expect(DEFAULT_SETTINGS).toEqual({ quality: 'medium', volume: 0.7 });
  });

  it('maps each quality id to its preset', () => {
    expect(qualityPreset('low')).toBe(QUALITY_PRESETS.low);
    expect(qualityPreset('high').maxPixelRatio).toBeGreaterThan(qualityPreset('low').maxPixelRatio);
  });

  it('orders the presets so each one has a larger or equal budget than the last', () => {
    const { low, medium, high } = QUALITY_PRESETS;
    expect(low.rainStreaks).toBeLessThanOrEqual(medium.rainStreaks);
    expect(medium.rainStreaks).toBeLessThanOrEqual(high.rainStreaks);
    expect(low.smokeParticles).toBeLessThanOrEqual(medium.smokeParticles);
    expect(medium.smokeParticles).toBeLessThanOrEqual(high.smokeParticles);
  });
});

describe('nextQuality', () => {
  it('cycles low, medium, high, and back to low', () => {
    expect(nextQuality('low')).toBe('medium');
    expect(nextQuality('medium')).toBe('high');
    expect(nextQuality('high')).toBe('low');
  });
});

describe('sanitizeSettings', () => {
  it('gives the defaults, with nothing repaired, for null and for a missing object', () => {
    expect(sanitizeSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, repaired: [] });
    expect(sanitizeSettings(undefined)).toEqual({ settings: DEFAULT_SETTINGS, repaired: [] });
  });

  it('repairs a non-object value and reports it', () => {
    expect(sanitizeSettings('loud')).toEqual({ settings: DEFAULT_SETTINGS, repaired: ['settings'] });
    expect(sanitizeSettings([1, 2])).toEqual({ settings: DEFAULT_SETTINGS, repaired: ['settings'] });
  });

  it('keeps valid values', () => {
    expect(sanitizeSettings({ quality: 'high', volume: 0 })).toEqual({
      settings: { quality: 'high', volume: 0 },
      repaired: [],
    });
  });

  it('defaults a missing field silently, because a new player has no value yet', () => {
    expect(sanitizeSettings({})).toEqual({ settings: DEFAULT_SETTINGS, repaired: [] });
    expect(sanitizeSettings({ quality: 'low' })).toEqual({
      settings: { quality: 'low', volume: 0.7 },
      repaired: [],
    });
  });

  it('repairs an unknown quality and keeps a valid volume', () => {
    expect(sanitizeSettings({ quality: 'ultra', volume: 0.3 })).toEqual({
      settings: { quality: 'medium', volume: 0.3 },
      repaired: ['quality'],
    });
  });

  it('repairs an out-of-range, non-numeric, or non-finite volume', () => {
    expect(sanitizeSettings({ quality: 'low', volume: 2 })).toEqual({
      settings: { quality: 'low', volume: 0.7 },
      repaired: ['volume'],
    });
    expect(sanitizeSettings({ volume: '0.5' }).repaired).toEqual(['volume']);
    expect(sanitizeSettings({ volume: Number.NaN }).repaired).toEqual(['volume']);
    expect(sanitizeSettings({ volume: -0.1 }).repaired).toEqual(['volume']);
  });
});

describe('type guards for stored environment ids', () => {
  it('accepts only known time-of-day ids', () => {
    expect(isKnownTimeOfDay('day')).toBe(true);
    expect(isKnownTimeOfDay('night')).toBe(true);
    expect(isKnownTimeOfDay('noon')).toBe(false);
    expect(isKnownTimeOfDay(3)).toBe(false);
  });

  it('accepts only known weather ids', () => {
    expect(isKnownWeather('rain')).toBe(true);
    expect(isKnownWeather('snow')).toBe(false);
    expect(isKnownWeather(null)).toBe(false);
  });
});
