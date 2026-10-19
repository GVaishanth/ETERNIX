/*
 * Automated tests for the presentation settings persistence (Part 10): loading defaults for missing or broken storage,
 * saving under the settings key, and a failed write never throwing. The profile save is separate and untouched.
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY } from '../config/qualityConfig';
import { DEFAULT_SETTINGS } from '../quality/qualityModel';
import { loadSettings, saveSettings, type SettingsStorage } from './qualityStore';

class MemoryStorage implements SettingsStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

class FailingStorage implements SettingsStorage {
  getItem(): string | null {
    throw new Error('blocked');
  }
  setItem(): void {
    throw new Error('quota');
  }
}

describe('settings persistence', () => {
  it('uses the documented key, separate from the profile save', () => {
    expect(SETTINGS_KEY).toBe('street-racer.settings');
  });

  it('loads the defaults when there is no storage or nothing stored', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('loads defaults, and never throws, for broken JSON or blocked storage', () => {
    const broken = new MemoryStorage();
    broken.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(new FailingStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and reloads the same values', () => {
    const storage = new MemoryStorage();
    expect(saveSettings(storage, { quality: 'high', volume: 0.25 })).toBe(true);
    expect(JSON.parse(storage.items.get(SETTINGS_KEY) ?? 'null')).toEqual({ quality: 'high', volume: 0.25 });
    expect(loadSettings(storage)).toEqual({ quality: 'high', volume: 0.25 });
  });

  it('reports a failed save as false instead of throwing', () => {
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
    expect(saveSettings(new FailingStorage(), DEFAULT_SETTINGS)).toBe(false);
  });

  it('repairs an invalid stored value on load', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ quality: 'ultra', volume: 0.4 }));
    expect(loadSettings(storage)).toEqual({ quality: 'medium', volume: 0.4 });
  });
});
