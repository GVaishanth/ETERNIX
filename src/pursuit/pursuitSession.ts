import { PURSUIT_CONFIG, type PursuitHeatLevelConfig } from '../config/pursuitConfig';
import { addHeat, decayHeat, heatLevelFor, validateHeatLevels } from './heat';
import { canTransition, isRunningState, isSessionState } from './pursuitStateMachine';
import type { OffenceKind, PursuitEndReason, PursuitSnapshot, PursuitState } from './pursuitTypes';

/*
 * The pursuit session (Part 7). The single authority for pursuit state, heat, and pursuit timers. Pure: it reads only
 * the observations it is given each step, and it never touches the simulation, the AI, or the renderer. The controller
 * turns its state into unit roles and routes.
 *
 * Timers are counted in fixed steps by the controller's dt. Pause freezes them, because the controller only steps when
 * the simulation does.
 */

export interface SessionInput {
  /** Pursuit-capable units that can see the player this step. */
  seenCount: number;
  /** The witnessing unit still sees the player. Only read in DETECTION. */
  witnessInView: boolean;
  /** Distance from the player to the nearest pursuing unit, meters. Null when no unit is pursuing. */
  nearestPursuerMeters: number | null;
  /** Units taking part in the chase now (chase, intercept, or search). */
  pursuingUnits: number;
  /** Capture reached this step. The controller decides this from range, speed, and hold time. */
  captured: boolean;
  playerX: number;
  playerZ: number;
}

export type OffenceResult = 'started' | 'added' | 'limited' | 'ignored';

/** What the session reports about itself. The controller merges in the unit counts and the capture progress. */
export type SessionView = Omit<PursuitSnapshot, 'pursuingUnits' | 'patrolUnits' | 'idleUnits' | 'poolSize' | 'notice' | 'captureProgress'> & {
  noticeText: string | null;
  noticeId: number;
};

export interface SessionOptions {
  levels?: readonly PursuitHeatLevelConfig[];
  /**
   * Called once each time a session ends, with the reason. The career uses it to count escapes. It is called after the
   * session has returned to INACTIVE, so a listener cannot see a half-ended session. It must not start a pursuit.
   */
  onEnd?: (reason: PursuitEndReason) => void;
}

export class PursuitSession {
  private state: PursuitState = 'INACTIVE';
  private readonly levels: readonly PursuitHeatLevelConfig[];
  private level: PursuitHeatLevelConfig;
  private heat = 0;
  private stateSeconds = 0;
  private sinceDetectionSeconds = 0;
  private lostSeconds = 0;
  private searchSeconds = 0;
  private cooldownSeconds = 0;
  private noUnitSeconds = 0;
  private sinceOffenceSeconds = Number.POSITIVE_INFINITY;
  private sinceDeploySeconds = Number.POSITIVE_INFINITY;
  private lastKnown: { x: number; z: number } | null = null;
  private nearestMeters: number | null = null;
  private lastEnd: PursuitEndReason | null = null;
  private sessions = 0;
  private noticeText: string | null = null;
  private noticeId = 0;
  private pending: string[] = [];
  /** Transitions the table refused. Zero in a correct run. Read by diagnostics and tests. */
  rejectedTransitions = 0;
  /** Offence kind that started the current session. Diagnostics only. */
  offenceKind: OffenceKind | null = null;

  private readonly onEnd: ((reason: PursuitEndReason) => void) | null;

  constructor(options: SessionOptions = {}) {
    this.onEnd = options.onEnd ?? null;
    this.levels = options.levels ?? PURSUIT_CONFIG.heatLevels;
    const issues = validateHeatLevels(this.levels, PURSUIT_CONFIG.heat.maxHeat);
    if (issues.length > 0) throw new Error(`Invalid heat levels: ${issues.join('; ')}`);
    this.level = this.levels[0]!;
  }

  get currentState(): PursuitState {
    return this.state;
  }

  /** The heat level, from the current heat. */
  get heatLevel(): PursuitHeatLevelConfig {
    return this.level;
  }

  /** Units wanted at the current level. Zero outside an engaged pursuit. */
  get wantedUnits(): number {
    return isSessionState(this.state) && this.state !== 'DETECTION' && this.state !== 'BUSTED' ? this.level.maxUnits : 0;
  }

  /** True when the pursuit wants another unit and the deployment interval has passed. */
  get deployReady(): boolean {
    return this.sinceDeploySeconds >= this.level.deployIntervalSeconds;
  }

  /** The controller calls this after it deploys a unit, so the next deployment waits for the interval. */
  noteDeployed(): void {
    this.sinceDeploySeconds = 0;
  }

  /** Last known position of the player, or null. Set whenever a unit sees the player. */
  get lastKnownPosition(): { x: number; z: number } | null {
    return this.lastKnown;
  }

  /**
   * Reports an offence. In INACTIVE it starts a DETECTION, and the controller must only report it when a patrol saw it.
   * During a session it adds rate-limited heat. It never starts a second session.
   */
  reportOffence(kind: OffenceKind): OffenceResult {
    if (this.state === 'INACTIVE') {
      if (!this.go('DETECTION')) return 'ignored';
      this.sessions += 1;
      this.offenceKind = kind;
      this.sinceDetectionSeconds = 0;
      this.heat = addHeat(this.heat, PURSUIT_CONFIG.heat.detectionPoints, PURSUIT_CONFIG.heat.maxHeat);
      this.sinceOffenceSeconds = 0;
      this.setLevel(heatLevelFor(this.heat, this.levels));
      return 'started';
    }
    if (this.state === 'DETECTION' || this.state === 'BUSTED') return 'ignored';
    if (this.sinceOffenceSeconds < PURSUIT_CONFIG.heat.eventMinIntervalSeconds) return 'limited';
    this.heat = addHeat(this.heat, PURSUIT_CONFIG.heat.repeatOffencePoints, PURSUIT_CONFIG.heat.maxHeat);
    this.sinceOffenceSeconds = 0;
    this.setLevel(heatLevelFor(this.heat, this.levels));
    return 'added';
  }

  /** One fixed step. The controller calls it once per step, after the units have been observed. */
  step(dtSeconds: number, input: SessionInput): void {
    this.sinceOffenceSeconds += dtSeconds;
    this.sinceDeploySeconds += dtSeconds;
    this.nearestMeters = input.nearestPursuerMeters;
    if (this.state === 'INACTIVE') return;

    this.stateSeconds += dtSeconds;
    this.sinceDetectionSeconds += dtSeconds;
    if (isRunningState(this.state)) this.heat = addHeat(this.heat, PURSUIT_CONFIG.heat.pursuitPerSecond * dtSeconds, PURSUIT_CONFIG.heat.maxHeat);
    if (this.state === 'COOLDOWN') this.heat = decayHeat(this.heat, PURSUIT_CONFIG.heat.cooldownDecayPerSecond, dtSeconds);
    const seen = input.seenCount > 0;
    if (seen) this.lastKnown = { x: input.playerX, z: input.playerZ };
    this.setLevel(heatLevelFor(this.heat, this.levels));

    switch (this.state) {
      case 'DETECTION':
        this.stepDetection(input);
        break;
      case 'INITIATING':
        this.stepInitiating(dtSeconds, input);
        break;
      case 'PURSUING':
      case 'ESCALATING':
        this.stepPursuing(dtSeconds, input, seen);
        break;
      case 'SEARCHING':
        this.stepSearching(dtSeconds, input, seen);
        break;
      case 'COOLDOWN':
        this.stepCooldown(dtSeconds, input, seen);
        break;
      case 'BUSTED':
        // The capture notice was raised when the state was entered. The end is silent, so the notice is not repeated.
        if (this.stateSeconds >= PURSUIT_CONFIG.capture.bustedShowSeconds) this.end('busted', false);
        break;
      default:
        break;
    }
  }

  /** Ends the session now, with the given reason. Used for a reset. A no-op with no session. */
  abort(reason: PursuitEndReason): void {
    this.end(reason);
  }

  /** Takes the notices raised since the last call. Each notice comes from a state change, never from a guess. */
  drainNotices(): string[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** The session's own fields for the snapshot. The controller adds the unit counts and the capture progress. */
  view(): SessionView {
    const outOfSight = PURSUIT_CONFIG.escape.outOfSightSeconds;
    const separation = PURSUIT_CONFIG.escape.separationMeters;
    const sepFactor = this.nearestMeters === null ? 1 : Math.min(1, this.nearestMeters / separation);
    const inSearch = this.state === 'SEARCHING';
    const inCooldown = this.state === 'COOLDOWN';
    return {
      state: this.state,
      level: this.level.level,
      heat: this.heat,
      maxHeat: PURSUIT_CONFIG.heat.maxHeat,
      detectionAgeSeconds: isSessionState(this.state) ? this.sinceDetectionSeconds : 0,
      lostSightSeconds: isSessionState(this.state) ? this.lostSeconds : 0,
      escapeProgress: isSessionState(this.state) ? Math.min(1, this.lostSeconds / outOfSight) * sepFactor : 0,
      searchSecondsLeft: inSearch ? Math.max(0, this.level.searchSeconds - this.searchSeconds) : 0,
      cooldownSecondsLeft: inCooldown ? Math.max(0, PURSUIT_CONFIG.cooldownSeconds - this.cooldownSeconds) : 0,
      lastKnown: this.lastKnown ? { ...this.lastKnown } : null,
      lastEndReason: this.lastEnd,
      sessionsStarted: this.sessions,
      noticeText: this.noticeText,
      noticeId: this.noticeId,
    };
  }

  private stepDetection(input: SessionInput): void {
    if (!input.witnessInView) {
      // Sight was lost before the response started. Nothing is announced: the pursuit never began.
      this.end('cancelled', false);
      return;
    }
    if (this.stateSeconds >= PURSUIT_CONFIG.detectionSeconds) {
      if (this.go('INITIATING')) this.notice('Police are responding');
    }
  }

  private stepInitiating(dtSeconds: number, input: SessionInput): void {
    if (input.pursuingUnits === 0) {
      this.noUnitSeconds += dtSeconds;
      if (this.noUnitSeconds >= PURSUIT_CONFIG.stuck.noUnitSeconds) this.end('no-units', false);
      return;
    }
    if (this.stateSeconds >= PURSUIT_CONFIG.initiationSeconds) {
      // INITIATING only leads to PURSUING. An unfilled wanted count is settled on the next step, as ESCALATING.
      if (this.go('PURSUING')) this.notice('In pursuit');
    }
  }

  private stepPursuing(dtSeconds: number, input: SessionInput, seen: boolean): void {
    if (input.captured) {
      this.capture();
      return;
    }
    if (seen) {
      this.lostSeconds = 0;
    } else {
      this.lostSeconds += dtSeconds;
      if (this.lostSeconds >= PURSUIT_CONFIG.lostSightSeconds) {
        this.searchSeconds = 0;
        if (this.go('SEARCHING')) this.notice('Lost visual, searching');
        return;
      }
    }
    if (input.pursuingUnits === 0) {
      // No unit is chasing. The pursuit searches from the last known position, and the search timers decide the end.
      this.noUnitSeconds += dtSeconds;
      if (this.noUnitSeconds >= PURSUIT_CONFIG.stuck.noUnitSeconds) {
        this.searchSeconds = 0;
        if (this.go('SEARCHING')) this.notice('Units lost contact, searching');
      }
      return;
    }
    this.noUnitSeconds = 0;
    this.settleEngaged(input);
  }

  private stepSearching(dtSeconds: number, input: SessionInput, seen: boolean): void {
    if (input.captured) {
      this.capture();
      return;
    }
    if (seen) {
      this.lostSeconds = 0;
      this.searchSeconds = 0;
      if (this.go(this.engagedState(input))) this.notice('Spotted again');
      return;
    }
    this.lostSeconds += dtSeconds;
    this.searchSeconds += dtSeconds;
    const separated = input.nearestPursuerMeters === null || input.nearestPursuerMeters >= PURSUIT_CONFIG.escape.separationMeters;
    if (this.lostSeconds >= PURSUIT_CONFIG.escape.outOfSightSeconds && separated) {
      this.toCooldown('Lost them, cooling down');
    } else if (this.searchSeconds >= this.level.searchSeconds) {
      // The search is over without sight. Bounded: the police stop searching rather than circling forever.
      this.toCooldown('Search called off');
    }
  }

  private stepCooldown(dtSeconds: number, input: SessionInput, seen: boolean): void {
    if (seen) {
      this.lostSeconds = 0;
      this.cooldownSeconds = 0;
      if (this.go(this.engagedState(input))) this.notice('Spotted again');
      return;
    }
    this.cooldownSeconds += dtSeconds;
    if (this.cooldownSeconds >= PURSUIT_CONFIG.cooldownSeconds) this.end('cooldown');
  }

  /** The engaged state for the current unit count: escalating while more units are wanted than are chasing. */
  private engagedState(input: SessionInput): PursuitState {
    return input.pursuingUnits < this.level.maxUnits ? 'ESCALATING' : 'PURSUING';
  }

  /** Moves between PURSUING and ESCALATING as the unit count changes. Announces a new request for backup. */
  private settleEngaged(input: SessionInput): void {
    const next = this.engagedState(input);
    if (next === this.state) return;
    if (this.go(next) && next === 'ESCALATING') this.notice('Backup requested');
  }

  private capture(): void {
    if (this.go('BUSTED')) this.notice('Busted. Pursuit over');
  }

  private toCooldown(text: string): void {
    this.cooldownSeconds = 0;
    if (this.go('COOLDOWN')) this.notice(text);
  }

  private setLevel(next: PursuitHeatLevelConfig): void {
    if (next.level > this.level.level && isRunningState(this.state)) {
      this.level = next;
      this.notice(`Heat level ${next.level}`);
      return;
    }
    this.level = next;
  }

  /** Validated transition. Refused moves are counted, and the state does not change. */
  private go(to: PursuitState): boolean {
    if (!canTransition(this.state, to)) {
      this.rejectedTransitions += 1;
      return false;
    }
    this.state = to;
    this.stateSeconds = 0;
    if (to === 'DETECTION') this.noUnitSeconds = 0;
    if (to === 'INITIATING') this.noUnitSeconds = 0;
    if (to === 'SEARCHING') this.searchSeconds = 0;
    if (to === 'COOLDOWN') this.cooldownSeconds = 0;
    return true;
  }

  /**
   * Ends the session. Heat resets, and the pursuit is over, so no state carries into the next one. Ends once: a second
   * call with no session does nothing. `announce` is false for the silent ends (cancelled, or no units).
   */
  private end(reason: PursuitEndReason, announce = true): void {
    if (this.state === 'INACTIVE') return;
    if (!this.go('INACTIVE')) return;
    this.lastEnd = reason;
    if (announce) this.notice('Pursuit over');
    this.heat = 0;
    this.level = this.levels[0]!;
    this.lostSeconds = 0;
    this.searchSeconds = 0;
    this.cooldownSeconds = 0;
    this.noUnitSeconds = 0;
    this.lastKnown = null;
    this.offenceKind = null;
    this.sinceDetectionSeconds = 0;
    this.onEnd?.(reason);
  }

  private notice(text: string): void {
    this.noticeText = text;
    this.noticeId += 1;
    this.pending.push(text);
  }
}
