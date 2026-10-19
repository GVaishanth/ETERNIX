import { RACE_CONFIG } from '../config/raceConfig';
import { canTransition, isRaceActive } from './raceStateMachine';
import type { RaceEndReason, RaceState } from './raceTypes';

/*
 * The race session (Part 6): the state, the attempt counter, the countdown, and the race timer. Pure and deterministic:
 * time only moves through advance(dt), which the fixed-step simulation calls. A paused session does not advance, so
 * the countdown and the timer freeze with the simulation and do not restart on resume.
 *
 * Illegal requests return false, are counted in `refusals`, and leave the state unchanged. They never throw.
 */

export interface RaceTransition {
  from: RaceState;
  to: RaceState;
  attemptId: number;
  /** Simulation seconds since the session started, not wall-clock time. */
  atSeconds: number;
}

const HISTORY_LIMIT = 32;
const COUNTDOWN_START_SECONDS = 3 * RACE_CONFIG.countdownStepSeconds;

export class RaceSession {
  private stateValue: RaceState = 'FREE_ROAM';
  private pausedFromValue: 'COUNTDOWN' | 'RACING' | null = null;
  private eventIdValue: string | null = null;
  private attemptValue = 0;
  private countdownLeft = 0;
  private raceTime = 0;
  private limitSeconds: number | null = null;
  private endValue: RaceEndReason | null = null;
  private clock = 0;
  private refusalCount = 0;
  private lastRefusalValue: string | null = null;
  private readonly historyValue: RaceTransition[] = [];

  get state(): RaceState { return this.stateValue; }
  get pausedFrom(): 'COUNTDOWN' | 'RACING' | null { return this.pausedFromValue; }
  get eventId(): string | null { return this.eventIdValue; }
  get attemptId(): number { return this.attemptValue; }
  /** Seconds left before GO. Zero outside COUNTDOWN. */
  get countdownRemaining(): number { return this.countdownLeft; }
  /** Race timer, seconds from GO. Zero before GO. Freezes while paused. */
  get raceElapsed(): number { return this.raceTime; }
  get timeLimitSeconds(): number | null { return this.limitSeconds; }
  get endReason(): RaceEndReason | null { return this.endValue; }
  get refusals(): number { return this.refusalCount; }
  get lastRefusal(): string | null { return this.lastRefusalValue; }
  get history(): readonly RaceTransition[] { return this.historyValue; }
  get active(): boolean { return isRaceActive(this.stateValue); }

  /** The countdown number to show: 3, 2, 1, or 0 for GO and after. Null outside COUNTDOWN. */
  get countdownDisplay(): number | null {
    if (this.stateValue !== 'COUNTDOWN') return null;
    return Math.max(1, Math.ceil(this.countdownLeft / RACE_CONFIG.countdownStepSeconds));
  }

  /** True while the GO banner should show: the first moments of RACING. */
  get goVisible(): boolean {
    return this.stateValue === 'RACING' && this.raceTime < RACE_CONFIG.goDisplaySeconds;
  }

  /** Approach card opens for an event. Only from free roam. */
  openApproach(eventId: string): boolean {
    if (this.stateValue !== 'FREE_ROAM') return this.refuse(`approach ${eventId} from ${this.stateValue}`);
    this.eventIdValue = eventId;
    return this.move('EVENT_APPROACH');
  }

  /** Card dismissed (Q in EVENT_APPROACH). Back to free roam, same event stays armed until the player leaves its radius. */
  dismissApproach(): boolean {
    if (this.stateValue !== 'EVENT_APPROACH') return this.refuse(`dismiss from ${this.stateValue}`);
    this.eventIdValue = null;
    return this.move('FREE_ROAM');
  }

  /**
   * Starts an attempt: from the approach card, or retries from the results. A retry must name the same event. Starts
   * the countdown. The race timer is not running until GO.
   */
  startAttempt(eventId: string, timeLimitSeconds: number | null): boolean {
    const from = this.stateValue;
    if (from === 'EVENT_APPROACH') {
      if (this.eventIdValue !== eventId) return this.refuse(`start ${eventId} while approaching ${this.eventIdValue}`);
    } else if (from === 'FINISHED' || from === 'FAILED') {
      if (this.eventIdValue !== eventId) return this.refuse(`retry ${eventId} after ${this.eventIdValue}`);
    } else {
      return this.refuse(`start ${eventId} from ${from}`);
    }
    if (!canTransition(from, 'COUNTDOWN')) return this.refuse(`${from} to COUNTDOWN`);
    this.attemptValue += 1;
    this.countdownLeft = COUNTDOWN_START_SECONDS;
    this.raceTime = 0;
    this.limitSeconds = timeLimitSeconds;
    this.endValue = null;
    return this.move('COUNTDOWN');
  }

  /** Cancel before GO (Q during COUNTDOWN). Back to free roam. Nothing is granted, because the race never started. */
  cancelCountdown(): boolean {
    if (this.stateValue !== 'COUNTDOWN') return this.refuse(`cancel countdown from ${this.stateValue}`);
    this.endValue = 'aborted';
    this.eventIdValue = null;
    return this.move('FREE_ROAM');
  }

  /** Abort during RACING (Q). The race fails with reason aborted. */
  abortRace(): boolean {
    if (this.stateValue !== 'RACING') return this.refuse(`abort from ${this.stateValue}`);
    this.endValue = 'aborted';
    return this.move('FAILED');
  }

  /** The player crossed the last gate in order. Results are shown once. */
  finishRace(): boolean {
    if (this.stateValue !== 'RACING') return this.refuse(`finish from ${this.stateValue}`);
    this.endValue = 'finished';
    return this.move('FINISHED');
  }

  /** Leaves the results screen (Q in FINISHED or FAILED). Back to free roam. */
  leaveResults(): boolean {
    if (this.stateValue !== 'FINISHED' && this.stateValue !== 'FAILED') return this.refuse(`leave results from ${this.stateValue}`);
    this.eventIdValue = null;
    return this.move('FREE_ROAM');
  }

  /** The app is paused. Only the countdown and the race timer are affected; they freeze. */
  pauseRace(): boolean {
    if (this.stateValue !== 'COUNTDOWN' && this.stateValue !== 'RACING') return this.refuse(`pause from ${this.stateValue}`);
    this.pausedFromValue = this.stateValue;
    return this.move('PAUSED');
  }

  /** Resume: back to the state that was paused. The countdown is not restarted. */
  resumeRace(): boolean {
    if (this.stateValue !== 'PAUSED' || this.pausedFromValue === null) return this.refuse(`resume from ${this.stateValue}`);
    const to = this.pausedFromValue;
    this.pausedFromValue = null;
    return this.move(to);
  }

  /**
   * Advances the countdown and the race timer by one fixed step. Ignored outside COUNTDOWN and RACING. The step that
   * reaches GO carries the leftover time into the race timer, so GO is not off by up to one step.
   */
  advance(dtSeconds: number): void {
    if (!(dtSeconds > 0)) return;
    this.clock += dtSeconds;
    if (this.stateValue === 'COUNTDOWN') {
      this.countdownLeft -= dtSeconds;
      if (this.countdownLeft <= 0) {
        this.raceTime = -this.countdownLeft;
        this.countdownLeft = 0;
        this.move('RACING');
      }
      return;
    }
    if (this.stateValue === 'RACING') {
      this.raceTime += dtSeconds;
      if (this.limitSeconds !== null && this.raceTime >= this.limitSeconds) {
        this.endValue = 'timeout';
        this.move('FAILED');
      }
    }
  }

  /** Retry or leave is shown next to the results. Clears the transition log between attempts only when asked. */
  clearHistory(): void {
    this.historyValue.length = 0;
  }

  private move(to: RaceState): boolean {
    const from = this.stateValue;
    if (!canTransition(from, to)) return this.refuse(`${from} to ${to}`);
    this.stateValue = to;
    this.historyValue.push({ from, to, attemptId: this.attemptValue, atSeconds: this.clock });
    if (this.historyValue.length > HISTORY_LIMIT) this.historyValue.shift();
    return true;
  }

  private refuse(reason: string): boolean {
    this.refusalCount += 1;
    this.lastRefusalValue = reason;
    return false;
  }
}
