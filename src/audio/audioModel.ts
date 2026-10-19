/*
 * Part 10 audio rules (pure). Maps real vehicle and pursuit state to sound levels. Every function clamps its output, so a
 * bad input can never produce a loud or runaway sound. No WebAudio here, so the rules are testable in Node.
 */
import { AUDIO_CONFIG } from '../config/audioConfig';

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export interface EngineTone {
  readonly frequencyHz: number;
  readonly gain: number;
  readonly filterHz: number;
}

/**
 * The engine tone from real speed and throttle. Pitch rises with speed, so a stopped car is at idle, not at a fixed high
 * pitch. Gain rises with throttle, but a coasting car stays quiet. Pure function of the inputs.
 */
export function engineTone(speedMetersPerSecond: number, throttle: number): EngineTone {
  const cfg = AUDIO_CONFIG.engine;
  const speedRatio = clamp01(Math.abs(speedMetersPerSecond) / cfg.referenceSpeedMetersPerSecond);
  const load = clamp01(throttle);
  const frequencyHz = cfg.idleHz + (cfg.maxHz - cfg.idleHz) * speedRatio;
  const gain = cfg.idleGain + (cfg.fullThrottleGain - cfg.idleGain) * load * (0.4 + 0.6 * speedRatio);
  const filterHz = cfg.filterMinHz + (cfg.filterMaxHz - cfg.filterMinHz) * speedRatio;
  return { frequencyHz, gain, filterHz };
}

/**
 * Tyre noise level from real lateral slip and the handbrake. Silent below a minimum speed, so a car standing still is
 * silent. Returns 0..1 before the configured maximum gain is applied.
 */
export function skidLevel(lateralSpeedMetersPerSecond: number, handbrake: boolean, speedMetersPerSecond: number): number {
  const cfg = AUDIO_CONFIG.skid;
  if (Math.abs(speedMetersPerSecond) < cfg.minSpeedMetersPerSecond) return 0;
  const span = cfg.fullLateralMetersPerSecond - cfg.startLateralMetersPerSecond;
  const fromSlip = clamp01((Math.abs(lateralSpeedMetersPerSecond) - cfg.startLateralMetersPerSecond) / span);
  const fromBrake = handbrake ? cfg.handbrakeLevel : 0;
  return clamp01(Math.max(fromSlip, fromBrake));
}

/** Whether the siren is on for a pursuit state. Only the states where police are actively chasing. */
export function sirenOn(pursuitState: string): boolean {
  return pursuitState === 'INITIATING' || pursuitState === 'PURSUING' || pursuitState === 'ESCALATING';
}

/** A short, bounded cue gain. Cues are fixed sounds with a fixed gain. */
export const CUE_GAIN: number = AUDIO_CONFIG.cues.gain;

export type CueId = 'countdown' | 'go' | 'checkpoint' | 'finish' | 'uiClick' | 'sirenStart';

/** The frequency sequence (Hz) for each cue. Short and distinct, so cues read as different events. */
export const CUE_NOTES: Readonly<Record<CueId, readonly number[]>> = {
  countdown: [660],
  go: [880, 1320],
  checkpoint: [740, 990],
  finish: [523, 659, 784],
  uiClick: [1200],
  sirenStart: [520],
};
