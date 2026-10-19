/*
 * Part 10 presentation settings (pure). Validates a stored settings object, so a bad value falls back to the default
 * rather than breaking the game. Settings never touch the profile save or the vehicle or race rules.
 */
import { DEFAULT_QUALITY, QUALITY_ORDER, QUALITY_PRESETS, type QualityId, type QualityPreset } from '../config/qualityConfig';
import type { TimeOfDayId } from '../config/environmentConfig';
import { TIME_OF_DAY_ORDER, type WeatherId, WEATHER_ORDER } from '../config/environmentConfig';

export interface PresentationSettings {
  readonly quality: QualityId;
  readonly volume: number;
}

export const DEFAULT_SETTINGS: PresentationSettings = { quality: DEFAULT_QUALITY, volume: 0.7 };

export function qualityPreset(id: QualityId): QualityPreset {
  return QUALITY_PRESETS[id];
}

export function nextQuality(current: QualityId): QualityId {
  const index = QUALITY_ORDER.indexOf(current);
  return QUALITY_ORDER[(index + 1) % QUALITY_ORDER.length] ?? DEFAULT_QUALITY;
}

/**
 * Validates an unknown stored value. Anything that is not a known quality or a finite volume in 0..1 falls back to the
 * default for that field, and the caller is told which fields were repaired.
 */
export function sanitizeSettings(raw: unknown): { settings: PresentationSettings; repaired: string[] } {
  const repaired: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { settings: DEFAULT_SETTINGS, repaired: raw === null || raw === undefined ? [] : ['settings'] };
  }
  const record = raw as Record<string, unknown>;
  let quality: QualityId = DEFAULT_QUALITY;
  if (record.quality === undefined) {
    // A missing field is not a repair: a new player simply has the default.
  } else if (typeof record.quality === 'string' && (QUALITY_ORDER as readonly string[]).includes(record.quality)) {
    quality = record.quality as QualityId;
  } else {
    repaired.push('quality');
  }
  let volume = DEFAULT_SETTINGS.volume;
  if (record.volume === undefined) {
    // Missing: default.
  } else if (typeof record.volume === 'number' && Number.isFinite(record.volume) && record.volume >= 0 && record.volume <= 1) {
    volume = record.volume;
  } else {
    repaired.push('volume');
  }
  return { settings: { quality, volume }, repaired };
}

/** Type guards for stored time-of-day and weather ids. Unknown ids are rejected before they reach the environment. */
export function isKnownTimeOfDay(value: unknown): value is TimeOfDayId {
  return typeof value === 'string' && (TIME_OF_DAY_ORDER as readonly string[]).includes(value);
}

export function isKnownWeather(value: unknown): value is WeatherId {
  return typeof value === 'string' && (WEATHER_ORDER as readonly string[]).includes(value);
}
