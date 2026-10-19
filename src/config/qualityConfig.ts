/*
 * Part 10 graphics quality presets. Data only. Quality changes presentation budgets: pixel ratio, rain streak count, and
 * tire-smoke particle count. It never changes vehicle physics, race rules, or collision.
 */

export type QualityId = 'low' | 'medium' | 'high';

export interface QualityPreset {
  readonly id: QualityId;
  readonly label: string;
  /** Upper bound on the device pixel ratio the canvas uses. */
  readonly maxPixelRatio: number;
  /** Rain streak count at full wetness. Zero turns the streaks off. */
  readonly rainStreaks: number;
  /** Tire-smoke pool size. Zero turns smoke off. */
  readonly smokeParticles: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityId, QualityPreset>> = {
  low: { id: 'low', label: 'Low', maxPixelRatio: 1, rainStreaks: 180, smokeParticles: 0 },
  medium: { id: 'medium', label: 'Medium', maxPixelRatio: 1.5, rainStreaks: 500, smokeParticles: 36 },
  high: { id: 'high', label: 'High', maxPixelRatio: 2, rainStreaks: 1100, smokeParticles: 72 },
};

export const QUALITY_ORDER: readonly QualityId[] = ['low', 'medium', 'high'];

/** Default quality. Balanced for an ordinary laptop, as the brief asks. */
export const DEFAULT_QUALITY: QualityId = 'medium';

/** localStorage key for presentation settings. Separate from the profile save, so a settings reset never touches progress. */
// Keeps the original 'street-racer' prefix. Renaming it would reset the player's settings.
export const SETTINGS_KEY = 'street-racer.settings';
