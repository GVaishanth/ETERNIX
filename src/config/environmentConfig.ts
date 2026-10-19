/*
 * Part 10 environment presentation: time of day, weather, and the wet-road look. Data only. The rules that blend these
 * values live in environment/environmentModel.ts. Colours are hex strings. Times are seconds. Nothing here changes physics.
 */

export type TimeOfDayId = 'day' | 'evening' | 'night';
export type WeatherId = 'clear' | 'rain';

export interface TimeOfDayPreset {
  readonly id: TimeOfDayId;
  readonly label: string;
  readonly skyColor: string;
  /** Fog colour. Kept close to the sky so distant buildings fade into the horizon, not into a flat band. */
  readonly fogColor: string;
  readonly fogNearMeters: number;
  readonly fogFarMeters: number;
  readonly ambientColor: string;
  readonly ambientIntensity: number;
  readonly sunColor: string;
  readonly sunIntensity: number;
  /** Multiplier on the emissive intensity of headlights and taillights. Lamps read as lit only after dusk. */
  readonly lampMultiplier: number;
}

export const TIME_OF_DAY_PRESETS: Readonly<Record<TimeOfDayId, TimeOfDayPreset>> = {
  day: {
    id: 'day', label: 'Day',
    skyColor: '#9cc3e0', fogColor: '#b9d3e6', fogNearMeters: 180, fogFarMeters: 1500,
    ambientColor: '#d4e4f4', ambientIntensity: 0.6,
    sunColor: '#fff4e0', sunIntensity: 1.1,
    lampMultiplier: 0.4,
  },
  evening: {
    id: 'evening', label: 'Evening',
    skyColor: '#d99a72', fogColor: '#c99a80', fogNearMeters: 150, fogFarMeters: 1150,
    ambientColor: '#c8a890', ambientIntensity: 0.5,
    sunColor: '#ffb27a', sunIntensity: 0.9,
    lampMultiplier: 1.6,
  },
  night: {
    id: 'night', label: 'Night',
    skyColor: '#0f1a2e', fogColor: '#1a2540', fogNearMeters: 120, fogFarMeters: 950,
    // Night keeps the ambient up so the road and the lane markings stay readable (no black shadow areas).
    ambientColor: '#4a5f86', ambientIntensity: 0.5,
    sunColor: '#9fb4e0', sunIntensity: 0.35,
    lampMultiplier: 3,
  },
};

/** Order of the time-of-day cycle (the N key). */
export const TIME_OF_DAY_ORDER: readonly TimeOfDayId[] = ['day', 'evening', 'night'];

/** Seconds for lighting to blend from one time of day to another. */
export const TIME_OF_DAY_TRANSITION_SECONDS = 6;

export interface WeatherPreset {
  readonly id: WeatherId;
  readonly label: string;
  /** 0 is dry, 1 is fully wet. Drives the asphalt roughness and the rain visuals. */
  readonly wetness: number;
  /** Fog near and far are multiplied by this while the weather is wet. Below 1 thickens the air. */
  readonly fogScale: number;
  /** Multiplier on the ambient intensity while the weather is wet. */
  readonly ambientScale: number;
}

export const WEATHER_PRESETS: Readonly<Record<WeatherId, WeatherPreset>> = {
  clear: { id: 'clear', label: 'Clear', wetness: 0, fogScale: 1, ambientScale: 1 },
  rain: { id: 'rain', label: 'Rain', wetness: 1, fogScale: 0.7, ambientScale: 0.85 },
};

export const WEATHER_ORDER: readonly WeatherId[] = ['clear', 'rain'];

/** Seconds for the weather to blend in or out. Weather changes are gradual, never per-frame switches. */
export const WEATHER_TRANSITION_SECONDS = 4;

/** Asphalt roughness on a dry and a fully wet road. Wet roads get a little more gloss, not a mirror finish. */
export const ASPHALT_ROUGHNESS = { dry: 0.9, wet: 0.4 } as const;

/** Rain streak geometry. Metres and metres per second. The field follows the camera, so it never grows. */
export const RAIN_CONFIG = {
  fieldRadiusMeters: 22,
  fieldHeightMeters: 16,
  fallSpeedMetersPerSecond: 26,
  streakLengthMeters: 1.1,
  /** Peak opacity of the streaks at full wetness. */
  opacity: 0.35,
  colour: '#cfe2f5',
} as const;

/**
 * How often the time of day and weather change by themselves. The home page and the game share the same environment,
 * so both follow this one schedule.
 */
export const ENVIRONMENT_CHANGE_SECONDS = 300;
