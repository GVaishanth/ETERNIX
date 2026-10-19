/*
 * Part 10 audio tuning. Data only. All sounds are synthesized with WebAudio, so the game needs no audio files. Levels are
 * linear gains (0 silent, 1 full). Frequencies are Hz. Speeds are m/s.
 */
export const AUDIO_CONFIG = {
  /** Master level before the user's volume setting. Keeps the mix below clipping. */
  masterGain: 0.5,
  defaultVolume: 0.7,
  engine: {
    /** Speed at which the engine tone reaches its top pitch. Real speed sets the pitch, never a constant. */
    referenceSpeedMetersPerSecond: 40,
    idleHz: 48,
    maxHz: 165,
    /** Gain at idle and at full throttle. The tone is quiet when the car is stopped. */
    idleGain: 0.05,
    fullThrottleGain: 0.16,
    /** Filter cutoff sweeps with speed, so the engine opens up as the car accelerates. */
    filterMinHz: 380,
    filterMaxHz: 1500,
  },
  skid: {
    /** Lateral speed (m/s) at which the tyre noise starts. */
    startLateralMetersPerSecond: 2.5,
    /** Lateral speed at which the tyre noise is at full level. */
    fullLateralMetersPerSecond: 8,
    handbrakeLevel: 0.5,
    maxGain: 0.12,
    /** The tyre noise needs some speed to be heard. Below this it is silent. */
    minSpeedMetersPerSecond: 2,
  },
  rain: { maxGain: 0.08 },
  siren: { maxGain: 0.05, lowHz: 620, highHz: 880, sweepSeconds: 0.9 },
  cues: { gain: 0.12 },
} as const;
