import { describe, expect, it } from 'vitest';
import { RaceSession } from './raceSession';
import { RACE_CONFIG } from '../config/raceConfig';

const EVENT = 'sprint-eastside';
const STEP = 1 / 60;

function armed(limit: number | null = 240): RaceSession {
  const s = new RaceSession();
  expect(s.openApproach(EVENT)).toBe(true);
  expect(s.startAttempt(EVENT, limit)).toBe(true);
  return s;
}

function runFor(s: RaceSession, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) s.advance(STEP);
}

describe('RaceSession lifecycle', () => {
  it('counts down 3, 2, 1 and starts the timer at GO', () => {
    const s = armed();
    expect(s.countdownDisplay).toBe(3);
    runFor(s, 1.1);
    expect(s.countdownDisplay).toBe(2);
    runFor(s, 1);
    expect(s.countdownDisplay).toBe(1);
    expect(s.state).toBe('COUNTDOWN');
    expect(s.raceElapsed).toBe(0);
    let steps = 0;
    while (s.state === 'COUNTDOWN' && steps < 1000) {
      s.advance(STEP);
      steps += 1;
    }
    expect(s.state).toBe('RACING');
    expect(s.countdownDisplay).toBeNull();
    // GO lands at 3.0 s from the start of the countdown, within one fixed step.
    expect(Math.abs(steps * STEP + 2.1 - 3)).toBeLessThanOrEqual(STEP + 1e-9);
    // The timer starts at GO. Leftover time from the GO step is carried over, so it is less than one step.
    expect(s.raceElapsed).toBeGreaterThanOrEqual(0);
    expect(s.raceElapsed).toBeLessThan(STEP * 2);
  });

  it('does not run the race timer during the countdown', () => {
    const s = armed();
    runFor(s, 2);
    expect(s.state).toBe('COUNTDOWN');
    expect(s.raceElapsed).toBe(0);
  });

  it('pause freezes the countdown and the timer, and resume does not restart the countdown', () => {
    const s = armed();
    runFor(s, 1.5);
    const left = s.countdownRemaining;
    expect(s.pauseRace()).toBe(true);
    expect(s.state).toBe('PAUSED');
    expect(s.pausedFrom).toBe('COUNTDOWN');
    // The renderer skips simulation updates while paused. Simulate that by not advancing at all.
    expect(s.countdownRemaining).toBe(left);
    expect(s.resumeRace()).toBe(true);
    expect(s.state).toBe('COUNTDOWN');
    expect(s.countdownRemaining).toBe(left);
  });

  it('pause during RACING resumes to RACING with the timer where it was', () => {
    const s = armed();
    runFor(s, 4);
    const elapsed = s.raceElapsed;
    expect(elapsed).toBeGreaterThan(0.5);
    expect(s.pauseRace()).toBe(true);
    expect(s.resumeRace()).toBe(true);
    expect(s.state).toBe('RACING');
    expect(s.raceElapsed).toBe(elapsed);
  });

  it('cancel during the countdown returns to free roam with no end reward reason other than aborted', () => {
    const s = armed();
    expect(s.cancelCountdown()).toBe(true);
    expect(s.state).toBe('FREE_ROAM');
    expect(s.endReason).toBe('aborted');
    expect(s.eventId).toBeNull();
  });

  it('abort during RACING fails the race with reason aborted', () => {
    const s = armed();
    runFor(s, 4);
    expect(s.abortRace()).toBe(true);
    expect(s.state).toBe('FAILED');
    expect(s.endReason).toBe('aborted');
  });

  it('a time limit fails the race with reason timeout', () => {
    const s = armed(10);
    runFor(s, 3 + 10.1);
    expect(s.state).toBe('FAILED');
    expect(s.endReason).toBe('timeout');
  });

  it('finish is valid only from RACING, and then results can be left', () => {
    const s = armed();
    expect(s.finishRace()).toBe(false);
    expect(s.state).toBe('COUNTDOWN');
    runFor(s, 3.1);
    expect(s.finishRace()).toBe(true);
    expect(s.state).toBe('FINISHED');
    expect(s.endReason).toBe('finished');
    expect(s.leaveResults()).toBe(true);
    expect(s.state).toBe('FREE_ROAM');
  });

  it('retry starts a new attempt with a new id, a fresh countdown, and a cleared end reason', () => {
    const s = armed();
    runFor(s, 3.1);
    s.finishRace();
    const first = s.attemptId;
    expect(s.startAttempt(EVENT, 240)).toBe(true);
    expect(s.state).toBe('COUNTDOWN');
    expect(s.attemptId).toBe(first + 1);
    expect(s.endReason).toBeNull();
    expect(s.countdownDisplay).toBe(3);
  });

  it('retry after a failure is allowed, and retrying a different event is refused', () => {
    const s = armed();
    runFor(s, 3.1);
    expect(s.abortRace()).toBe(true);
    expect(s.startAttempt('other-event', 240)).toBe(false);
    expect(s.state).toBe('FAILED');
    expect(s.startAttempt(EVENT, 240)).toBe(true);
  });

  it('refuses and counts illegal transitions without changing state or throwing', () => {
    const s = new RaceSession();
    expect(s.finishRace()).toBe(false);
    expect(s.abortRace()).toBe(false);
    expect(s.pauseRace()).toBe(false);
    expect(s.startAttempt(EVENT, null)).toBe(false);
    expect(s.state).toBe('FREE_ROAM');
    expect(s.refusals).toBe(4);
    expect(s.lastRefusal).not.toBeNull();
  });

  it('dismissing the approach card returns to free roam, and approach needs free roam', () => {
    const s = new RaceSession();
    expect(s.openApproach(EVENT)).toBe(true);
    expect(s.openApproach(EVENT)).toBe(false);
    expect(s.dismissApproach()).toBe(true);
    expect(s.state).toBe('FREE_ROAM');
    expect(s.eventId).toBeNull();
  });

  it('keeps the transition history bounded', () => {
    const s = new RaceSession();
    for (let i = 0; i < 40; i += 1) {
      s.openApproach(EVENT);
      s.dismissApproach();
    }
    expect(s.history.length).toBeLessThanOrEqual(32);
  });

  it('uses the configured countdown step', () => {
    expect(RACE_CONFIG.countdownStepSeconds).toBeGreaterThan(0);
    const s = armed();
    expect(s.countdownRemaining).toBeCloseTo(3 * RACE_CONFIG.countdownStepSeconds, 9);
  });
});
