import { RACE_CONFIG, RACE_PLAYER_GRID_POSITION } from '../config/raceConfig';
import type { LaneGraph } from '../traffic/laneGraph';
import { buildGridSlots, type GridSlot } from './grid';
import { RaceSession } from './raceSession';
import { createRacerProgress, refreshRouteDistance, stepRacerProgress, type RaceProgressEvent, type RacerProgress } from './raceProgress';
import type { RaceRoute } from './raceRoute';
import { rankRacers, type StandingRow } from './standings';
import { RewardLedger, type RewardGrant } from './rewards';
import type { RaceEndReason, RaceEventDefinition } from './raceTypes';

/*
 * Race director (Part 6). Owns one race at a time: the session (state, countdown, timer), the racers' progress, the
 * standings, the result, and the provisional reward. It is driven by the fixed-step simulation through update(dt) and by
 * player actions. It does not move cars, draw anything, or read the keyboard. Those belong to the simulation and the UI.
 *
 * Racer positions are set by the simulation with setRacerPosition() before update(). Race time comes only from the
 * session, which advances only inside update(). A paused session is not updated, so pause freezes timing.
 */

export const PLAYER_ID = 'player';

/** Opponent names are display labels only. They carry no data. */
export const OPPONENT_NAMES: readonly string[] = ['Rival A', 'Rival B', 'Rival C', 'Rival D', 'Rival E', 'Rival F', 'Rival G', 'Rival H', 'Rival I'];

export interface RaceResult {
  eventId: string;
  attemptId: number;
  outcome: RaceEndReason;
  /** Player's final place, 1-based. Null when the race did not finish. */
  place: number | null;
  totalRacers: number;
  finishSeconds: number | null;
  lapSeconds: number[];
  standings: StandingRow[];
  /** Provisional reward, granted once per attempt. Null when nothing is granted. */
  reward: RewardGrant | null;
}

export interface RaceNotice {
  id: number;
  text: string;
  /** Race time (seconds) when the notice was produced. */
  atSeconds: number;
}

const NOTICE_LIMIT = 8;
const DIRECTOR_NOTICE_LIFE = RACE_CONFIG.notificationSeconds;

export class RaceDirector {
  readonly event: RaceEventDefinition;
  readonly route: RaceRoute;
  readonly session = new RaceSession();
  private readonly graph: LaneGraph;
  private readonly rewards: RewardLedger;
  private racers: RacerProgress[] = [];
  /** Next-step centre points, by racer id. Written by setRacerPosition, read by update. */
  private readonly pending = new Map<string, { x: number; z: number }>();
  private slots: GridSlot[] = [];
  private stepCount = 0;
  private standingsValue: StandingRow[] = [];
  private resultValue: RaceResult | null = null;
  private noticesValue: RaceNotice[] = [];
  private noticeSeq = 0;
  private finishedCount = 0;
  private opponentCount: number;
  /** Called once per attempt, when the official result is produced (finish, timeout, or abort). Null for none. */
  private readonly onResult: ((result: RaceResult) => void) | null;

  constructor(
    event: RaceEventDefinition,
    route: RaceRoute,
    graph: LaneGraph,
    rewards: RewardLedger,
    opponentCount: number,
    onResult: ((result: RaceResult) => void) | null = null,
  ) {
    this.event = event;
    this.route = route;
    this.graph = graph;
    this.rewards = rewards;
    this.opponentCount = Math.max(0, Math.min(opponentCount, OPPONENT_NAMES.length));
    this.onResult = onResult;
  }

  get state() { return this.session.state; }
  get attemptId() { return this.session.attemptId; }
  get result(): RaceResult | null { return this.resultValue; }
  get standings(): readonly StandingRow[] { return this.standingsValue; }
  get notices(): readonly RaceNotice[] { return this.noticesValue; }
  get racerList(): readonly RacerProgress[] { return this.racers; }
  get gridSlots(): readonly GridSlot[] { return this.slots; }

  /** Grid index of the player: the 7th place, or the last place when the field is smaller. Zero-based. */
  private get playerIndex(): number {
    return Math.min(RACE_PLAYER_GRID_POSITION - 1, this.opponentCount);
  }

  /** The player's grid slot (7th of 10). Null before the attempt is built. */
  get playerSlot(): GridSlot | null {
    return this.slots[this.playerIndex] ?? null;
  }

  /**
   * Rival k's grid slot. Rivals take the grid in order, skipping the player's slot: rivals 1 to 6 start ahead of the
   * player, rivals 7 to 9 behind. Null when the field has no such slot.
   */
  opponentSlot(k: number): GridSlot | null {
    const index = k < this.playerIndex ? k : k + 1;
    return this.slots[index] ?? null;
  }

  /**
   * The grid place rival k starts in, 1-based (1 is the front of the grid; the player is 7th of 10). Rival k's place is
   * the place of opponentSlot(k). A rival keeps the pace of this place for the whole race, so pace does not depend on
   * the standings.
   */
  startingPlaceOf(k: number): number {
    const index = k < this.playerIndex ? k : k + 1;
    return index + 1;
  }

  /** Number of rivals in this race. */
  get rivalCount(): number { return this.opponentCount; }
  get fixedSteps(): number { return this.stepCount; }

  /** Player's current progress record, or null before the first attempt. */
  get player(): RacerProgress | null {
    return this.racers.find((r) => r.id === PLAYER_ID) ?? null;
  }

  /** Approach card opens. Only from free roam. */
  openApproach(): boolean {
    return this.session.openApproach(this.event.id);
  }

  dismissApproach(): boolean {
    return this.session.dismissApproach();
  }

  /**
   * Starts an attempt (or retries after results). Rebuilds every racer from the grid, so nothing carries over from the
   * last attempt. Returns false when the session refuses. The cars fill the two grid lanes row by row. The player takes
   * 7th place, and the rivals take the other places in order. The caller places the player's car on `playerSlot`, and
   * each rival on `opponentSlot(k)`, then starts the countdown hold.
   */
  start(): boolean {
    const ok = this.session.startAttempt(this.event.id, this.event.timeLimitSeconds);
    if (!ok) return false;
    this.slots = buildGridSlots(this.route, this.graph, this.opponentCount + 1);
    this.stepCount = 0;
    this.finishedCount = 0;
    this.resultValue = null;
    this.noticesValue = [];
    const player = this.playerSlot;
    this.racers = [];
    this.pending.clear();
    // Every leg is measured from the start line (grid row 0), so the standings start in grid order.
    const startLineD = this.slots[0]?.routeD ?? 0;
    if (player) this.racers.push(createRacerProgress(PLAYER_ID, 'player', 'You', player.x, player.z, player.routeD, startLineD));
    for (let k = 0; k < this.opponentCount; k += 1) {
      const slot = this.opponentSlot(k);
      if (!slot) continue;
      // A named race (a career rival) supplies its own opponent name. Other races keep the generic labels.
      const name = this.event.opponents?.[k]?.name ?? OPPONENT_NAMES[k] ?? `Rival ${k + 1}`;
      this.racers.push(createRacerProgress(`opp-${k + 1}`, 'opponent', name, slot.x, slot.z, slot.routeD, startLineD));
    }
    for (const racer of this.racers) this.pending.set(racer.id, { x: racer.x, z: racer.z });
    this.standingsValue = rankRacers(this.racers, this.route);
    return true;
  }

  /** Cancel before GO. Nothing is granted, and the attempt leaves no result. */
  cancel(): boolean {
    if (!this.session.cancelCountdown()) return false;
    this.racers = [];
    this.pending.clear();
    this.standingsValue = [];
    return true;
  }

  /** Abort during the race (Q). The attempt fails with reason aborted. Results are shown, no reward. */
  abort(): boolean {
    if (!this.session.abortRace()) return false;
    this.endRace('aborted', null);
    return true;
  }

  /** Leaves the results. Back to free roam. The racers are cleared. */
  leave(): boolean {
    if (!this.session.leaveResults()) return false;
    this.racers = [];
    this.pending.clear();
    this.standingsValue = [];
    return true;
  }

  pause(): boolean {
    return this.session.pauseRace();
  }

  resume(): boolean {
    return this.session.resumeRace();
  }

  /**
   * The simulation reports a racer's centre point for the next fixed step. The point is held as pending: the racer's
   * own x/z stay at the previous step, which the swept gate test needs. Unknown ids are ignored.
   */
  setRacerPosition(id: string, x: number, z: number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.x = x;
    pending.z = z;
  }

  /**
   * One fixed step. Advances the countdown and timer, then (while RACING) the gate sequence for every racer, and the
   * standings every standingsIntervalSteps. A race that ends here produces the result once.
   */
  update(dtSeconds: number): void {
    const before = this.session.state;
    this.session.advance(dtSeconds);
    if (before === 'COUNTDOWN' && this.session.state === 'RACING') this.pushNotice('GO');
    if (this.session.state === 'FAILED' && this.session.endReason === 'timeout') {
      this.endRace('timeout', null);
      return;
    }
    if (this.session.state !== 'RACING') return;

    this.stepCount += 1;
    for (const racer of this.racers) {
      const nextOrder = this.finishedCount + 1;
      const target = this.pending.get(racer.id);
      const outcome = stepRacerProgress(racer, this.route, target?.x ?? racer.x, target?.z ?? racer.z, this.session.raceElapsed, nextOrder);
      for (const event of outcome.events) this.handleEvent(event);
      if (outcome.finishedNow) {
        this.finishedCount += 1;
        if (racer.id === PLAYER_ID) {
          this.onPlayerFinished();
          return;
        }
      }
    }
    if (this.stepCount % RACE_CONFIG.standingsIntervalSteps === 0) this.refreshStandings();
    this.expireNotices();
  }

  /** Notices for the HUD, newest last. Expired notices are removed by update(). */
  private handleEvent(event: RaceProgressEvent): void {
    if (event.kind === 'gate-passed') {
      if (event.racerId === PLAYER_ID) {
        const gate = this.route.gates.find((g) => g.id === event.gateId);
        this.pushNotice(`${gate?.label ?? event.gateId} passed`);
      }
    } else if (event.kind === 'out-of-order') {
      if (event.racerId === PLAYER_ID) {
        const gate = this.route.gates.find((g) => g.id === event.gateId);
        const expected = this.route.gates.find((g) => g.id === event.expectedGateId);
        this.pushNotice(`${gate?.label ?? event.gateId} is not next: go to ${expected?.label ?? event.expectedGateId}`);
      }
    } else if (event.kind === 'relocation-held') {
      if (event.racerId === PLAYER_ID) {
        const gate = this.route.gates.find((g) => g.id === event.gateId);
        this.pushNotice(`Relocated past ${gate?.label ?? event.gateId}: drive back through it`);
      }
    } else if (event.kind === 'lap-completed') {
      if (event.racerId === PLAYER_ID) this.pushNotice(`Lap ${event.lap} of ${this.route.laps}`);
    }
  }

  private onPlayerFinished(): void {
    this.session.finishRace();
    this.endRace('finished', this.player);
  }

  private endRace(outcome: RaceEndReason, finisher: RacerProgress | null): void {
    // Opponents still running are classified by standing. The race ends for everyone when the player finishes.
    this.refreshStandings();
    const player = this.player;
    const place = finisher && finisher.finishOrder !== null ? finisher.finishOrder : null;
    const reward = outcome === 'finished' && place !== null
      ? this.rewards.grant(this.event.id, this.session.attemptId, place, this.event.rewardCredits)
      : null;
    const result: RaceResult = {
      eventId: this.event.id,
      attemptId: this.session.attemptId,
      outcome,
      place,
      totalRacers: this.racers.length,
      finishSeconds: finisher?.finishTime ?? null,
      lapSeconds: player ? [...player.lapTimes] : [],
      standings: this.standingsValue,
      reward,
    };
    this.resultValue = result;
    this.onResult?.(result);
  }

  refreshStandings(): void {
    for (const racer of this.racers) refreshRouteDistance(racer, this.route);
    this.standingsValue = rankRacers(this.racers, this.route);
  }

  private pushNotice(text: string): void {
    this.noticeSeq += 1;
    this.noticesValue.push({ id: this.noticeSeq, text, atSeconds: this.session.raceElapsed });
    if (this.noticesValue.length > NOTICE_LIMIT) this.noticesValue.shift();
  }

  private expireNotices(): void {
    const now = this.session.raceElapsed;
    while (this.noticesValue.length > 0 && now - (this.noticesValue[0]?.atSeconds ?? now) > DIRECTOR_NOTICE_LIFE) {
      this.noticesValue.shift();
    }
  }
}
