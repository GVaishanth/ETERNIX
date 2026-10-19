import { create } from 'zustand';
import { SETTINGS_KEY } from '../config/qualityConfig';
import { DEFAULT_SETTINGS, nextQuality, sanitizeSettings, type PresentationSettings } from '../quality/qualityModel';
import type { QualityId } from '../config/qualityConfig';

/** Minimal storage shape, so tests can pass an in-memory store. Same shape as the save layer uses. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads the stored settings. A missing or broken value gives the defaults and never throws. */
export function loadSettings(storage: SettingsStorage | null): PresentationSettings {
  if (!storage) return DEFAULT_SETTINGS;
  try {
    const text = storage.getItem(SETTINGS_KEY);
    if (text === null) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(text)).settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Writes the settings. A failed write is ignored, because settings are not progress. */
export function saveSettings(storage: SettingsStorage | null, settings: PresentationSettings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

interface QualityState extends PresentationSettings {
  setQuality: (quality: QualityId) => void;
  cycleQuality: () => void;
  setVolume: (volume: number) => void;
}

function browserSettingsStorage(): SettingsStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

const storage = browserSettingsStorage();
const initial = loadSettings(storage);

export const useQualityStore = create<QualityState>()((set, get) => ({
  quality: initial.quality,
  volume: initial.volume,
  setQuality: (quality) => {
    set({ quality });
    saveSettings(storage, { quality, volume: get().volume });
  },
  cycleQuality: () => {
    const quality = nextQuality(get().quality);
    set({ quality });
    saveSettings(storage, { quality, volume: get().volume });
  },
  setVolume: (volume) => {
    const clamped = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_SETTINGS.volume;
    set({ volume: clamped });
    saveSettings(storage, { quality: get().quality, volume: clamped });
  },
}));
