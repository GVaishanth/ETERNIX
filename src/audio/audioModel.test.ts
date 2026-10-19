/*
 * Automated tests for the audio rules (Part 10): engine pitch and gain follow real speed and throttle, tyre noise follows
 * real slip and the handbrake, the siren follows the pursuit state, and every output is bounded.
 */
import { describe, expect, it } from 'vitest';
import { AUDIO_CONFIG } from '../config/audioConfig';
import { CUE_GAIN, CUE_NOTES, clamp01, engineTone, skidLevel, sirenOn, type CueId } from './audioModel';

describe('engineTone', () => {
  const cfg = AUDIO_CONFIG.engine;

  it('idles at the idle pitch when stopped, whatever the throttle', () => {
    expect(engineTone(0, 0).frequencyHz).toBe(cfg.idleHz);
    expect(engineTone(0, 1).frequencyHz).toBe(cfg.idleHz);
  });

  it('rises with speed and is capped at the maximum pitch', () => {
    const slow = engineTone(5, 0.5).frequencyHz;
    const fast = engineTone(cfg.referenceSpeedMetersPerSecond, 0.5).frequencyHz;
    expect(fast).toBeGreaterThan(slow);
    expect(engineTone(10 * cfg.referenceSpeedMetersPerSecond, 0.5).frequencyHz).toBeCloseTo(cfg.maxHz, 9);
  });

  it('is quiet when coasting and louder with throttle', () => {
    const coast = engineTone(20, 0).gain;
    const full = engineTone(20, 1).gain;
    expect(coast).toBeCloseTo(cfg.idleGain, 9);
    expect(full).toBeGreaterThan(coast);
    expect(full).toBeLessThanOrEqual(cfg.fullThrottleGain + 1e-9);
  });

  it('treats reverse speed like forward speed, and bad input as zero', () => {
    expect(engineTone(-12, 0.5)).toEqual(engineTone(12, 0.5));
    expect(engineTone(Number.NaN, Number.NaN).frequencyHz).toBe(cfg.idleHz);
  });
});

describe('skidLevel', () => {
  it('is silent below the minimum speed, so a parked car is quiet', () => {
    expect(skidLevel(10, true, 0)).toBe(0);
  });

  it('is silent with grip, and rises with lateral slip', () => {
    expect(skidLevel(0, false, 20)).toBe(0);
    const some = skidLevel(AUDIO_CONFIG.skid.startLateralMetersPerSecond + 1, false, 20);
    const more = skidLevel(AUDIO_CONFIG.skid.startLateralMetersPerSecond + 3, false, 20);
    expect(some).toBeGreaterThan(0);
    expect(more).toBeGreaterThan(some);
  });

  it('takes the handbrake level when the handbrake is on and the car is moving', () => {
    expect(skidLevel(0, true, 15)).toBeCloseTo(AUDIO_CONFIG.skid.handbrakeLevel, 9);
  });

  it('never exceeds 1', () => {
    expect(skidLevel(1000, true, 30)).toBe(1);
  });
});

describe('sirenOn', () => {
  it('is on only while police are actively chasing', () => {
    expect(sirenOn('INITIATING')).toBe(true);
    expect(sirenOn('PURSUING')).toBe(true);
    expect(sirenOn('ESCALATING')).toBe(true);
    expect(sirenOn('INACTIVE')).toBe(false);
    expect(sirenOn('')).toBe(false);
  });
});

describe('cue tables', () => {
  const ids: CueId[] = ['countdown', 'go', 'checkpoint', 'finish', 'uiClick', 'sirenStart'];

  it('gives every cue at least one audible note inside a sensible frequency range', () => {
    for (const id of ids) {
      expect(CUE_NOTES[id].length).toBeGreaterThan(0);
      for (const hz of CUE_NOTES[id]) {
        expect(hz).toBeGreaterThan(100);
        expect(hz).toBeLessThan(4000);
      }
    }
  });

  it('keeps cue gain small, so a cue cannot be loud', () => {
    expect(CUE_GAIN).toBeGreaterThan(0);
    expect(CUE_GAIN).toBeLessThanOrEqual(0.5);
  });
});

describe('clamp01 (audio)', () => {
  it('clamps and maps non-finite values to zero', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
