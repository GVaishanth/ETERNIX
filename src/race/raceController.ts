import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { RACE_CONFIG } from '../config/raceConfig';
import { OpponentSystem, type AiOpponent, type OpponentSpec } from '../ai/aiOpponents';
import type { InputState, VehicleState } from '../core/types';
import type { GameSimulation, RaceStepHost } from '../engine/gameSimulation';
import type { RoadBoundary } from '../simulation/roadBoundary';
import { chainDistance, nearestOnLane, successorOf, twinLaneId, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import type { TrafficTypeId } from '../traffic/trafficTypes';
import { EMPTY_RACE_SNAPSHOT, useRaceStore, type RaceResultInfo, type RaceSnapshot } from '../state/raceStore';
import { isHeldOnGrid } from './raceStateMachine';
import { buildRaceRoute, formatRouteIssues, type RaceRoute } from './raceRoute';
import { PLAYER_ID, RaceDirector, type RaceResult } from './raceDirector';
import { RewardLedger, type RewardGrant } from './rewards';
import { eventRivalPaceMps, rivalSpeedCapMps } from './pace';
import type { RaceEventDefinition, RaceState } from './raceTypes';

/*
 * The race controller (Part 6). It is the only place that connects the race director to the simulation:
 *
 *  - It is a RaceStepHost: the simulation calls inputFor() before each fixed step and afterStep() after it. So race
 *    time, countdown, and gate tests all advance on the same fixed steps as the car. No timers of its own.
 *  - Approach: entering a marker's radius opens its card (once). Leaving the exit radius closes it and re-arms it.
 *  - Start, retry, cancel, abort, and leave are the only transitions it makes, through the director's session.
 *  - It places the player on the grid (a deliberate placement, with zero speed), holds traffic, and attaches the opponent
 *    AI, which runs through the shared vehicle model. It detaches all of this when the attempt ends.
 *  - It publishes plain values to the race store for the HUD. The simulation never reads the store.
 */

/** Hold on the grid: handbrake on, no throttle or brake. Engine braking is not used, so the car cannot roll back. */
export const HOLD_INPUT: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 1 };

/** Opponent types, in grid order. Each opponent takes the next type, wrapping around. */
const OPPONENT_TYPE_ORDER: readonly TrafficTypeId[] = ['sedan', 'suv', 'compact'];

/** A short message that stays on the HUD for RACE_CONFIG.notificationSeconds. */
interface Refusal {
  text: string;
  untilMs: number;
}

export interface RaceEntry {
  readonly event: RaceEventDefinition;
  readonly route: RaceRoute;
  readonly director: RaceDirector;
  /** True after the card was closed by an action. Cleared when the player drives out of the exit radius. */
  dismissed: boolean;
  /** Where the results were first shown (the car's position then). Null outside FINISHED and FAILED. */
  resultsAt: { x: number; z: number } | null;
}

export interface RaceControllerDiagnostics {
  /** Events that were dropped because their route is invalid. Each line names the failing id and reason. */
  readonly routeIssues: readonly string[];
}

function stopInput(speed: number): InputState {
  // Brake while rolling, then hold with the handbrake. Only the AI's pedals are replaced.
  return Math.abs(speed) > 0.5
    ? { steer: 0, throttle: 0, brake: 1, handbrake: 0 }
    : { steer: 0, throttle: 0, brake: 0, handbrake: 1 };
}

function distanceXZ(a: { readonly x: number; readonly z: number }, x: number, z: number): number {
  return Math.hypot(a.x - x, a.z - z);
}

export class RaceController implements RaceStepHost {
  /** Valid events only, in definition order. The index is the marker and visual index. */
  readonly entries: readonly RaceEntry[];
  readonly diagnostics: RaceControllerDiagnostics;
  private readonly sim: GameSimulation;
  private readonly graph: LaneGraph;
  private readonly boundary: RoadBoundary | null;
  /** Per-attempt de-duplication of rewards. Each NEW grant is passed to onReward (the garage balance). */
  private readonly ledger: RewardLedger;
  private active: RaceEntry | null = null;
  /** Steps left before each rival may change lane again. Cleared when the attempt's rivals are built. */
  private readonly laneChangeCooldown = new Map<number, number>();
  private refusal: Refusal | null = null;
  private attached = false;

  /**
   * `entryBlock` returns a reason a race cannot start now, or null. A pursuit uses it: a race never starts while the
   * police are after the player, and the refusal says so.
   */
  constructor(
    sim: GameSimulation,
    graph: LaneGraph,
    boundary: RoadBoundary | null,
    events: readonly RaceEventDefinition[],
    private readonly entryBlock: (eventId: string) => string | null = () => null,
    onReward: ((grant: RewardGrant) => void) | null = null,
    private readonly onOutcome: ((result: RaceResult) => void) | null = null,
    /** Whether an event is shown on the map and in the world. A hidden event cannot be started. Defaults to shown. */
    private readonly isVisible: (eventId: string) => boolean = () => true,
  ) {
    this.ledger = new RewardLedger(onReward);
    this.sim = sim;
    this.graph = graph;
    this.boundary = boundary;
    const entries: RaceEntry[] = [];
    const routeIssues: string[] = [];
    for (const event of events) {
      const result = buildRaceRoute(event, graph);
      if (!result.valid || !result.route) {
        // An invalid route is never raced and never silently dropped: it is reported here and in the DEV panel.
        for (const line of formatRouteIssues(result)) routeIssues.push(`${event.id}: ${line}`);
        continue;
      }
      entries.push({ event, route: result.route, director: new RaceDirector(event, result.route, graph, this.ledger, event.opponentCount, (outcome) => this.onOutcome?.(outcome)), dismissed: false, resultsAt: null });
    }
    this.entries = entries;
    this.diagnostics = { routeIssues };
  }

  /** Routes for the visual pool, in entry order. */
  get routes(): readonly RaceRoute[] {
    return this.entries.map((entry) => entry.route);
  }

  /**
   * Whether the route at this index is shown on the map and in the world. Indices match `routes`, so a hidden route
   * keeps its place in the list. Out of range is not shown.
   */
  routeVisible(index: number): boolean {
    const entry = this.entries[index];
    return entry !== undefined && this.isVisible(entry.event.id);
  }

  /** The reason an event cannot start now, or null. A hidden event is refused even if the entry check passes. */
  private blockFor(eventId: string): string | null {
    const reason = this.entryBlock(eventId);
    if (reason) return reason;
    return this.isVisible(eventId) ? null : 'This race is not available.';
  }

  /** Index of the event in progress (approach, grid, race, or results), or -1 in free roam. */
  activeIndex(): number {
    return this.active ? this.entries.indexOf(this.active) : -1;
  }

  /** The current race state, or FREE_ROAM. */
  get phase(): RaceState {
    return this.active ? this.active.director.state : 'FREE_ROAM';
  }

  /**
   * Locks the global reset (R, and the DEV reset) while a race is on, so a reset cannot teleport the car out of a race.
   * The approach card is not a race, so reset is allowed there.
   */
  blocksReset(): boolean {
    const state = this.phase;
    return state !== 'FREE_ROAM' && state !== 'EVENT_APPROACH';
  }

  /** Connects to the simulation. Called from an effect, and undone by detach(). */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.sim.attachRace(this);
    this.publish();
  }

  /** Disconnects, ends any attempt, and restores traffic. Safe to call more than once. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    if (this.active) this.endAttempt();
    this.sim.attachRace(null);
    this.refusal = null;
    useRaceStore.getState().setSnapshot(EMPTY_RACE_SNAPSHOT);
  }

  /** The simulation asks for the input of this step. Only the grid hold replaces the driver's input. */
  inputFor(frameInput: InputState): InputState {
    if (this.active && isHeldOnGrid(this.active.director.state)) return HOLD_INPUT;
    return frameInput;
  }

  /** Called after each fixed step, with the player's car state for that step. */
  afterStep(state: VehicleState): void {
    const x = state.position.x;
    const z = state.position.z;
    const entry = this.active;
    if (entry) {
      const s = entry.director.state;
      if (s !== 'FINISHED' && s !== 'FAILED') entry.resultsAt = null;
      if (s === 'COUNTDOWN' || s === 'RACING' || s === 'PAUSED') {
        const dir = entry.director;
        dir.setRacerPosition(PLAYER_ID, x, z);
        const opponents = this.sim.opponents;
        if (opponents) {
          for (const opponent of opponents.opponents) {
            dir.setRacerPosition(this.racerIdOf(opponent), opponent.state.position.x, opponent.state.position.z);
          }
        }
        dir.update(FIXED_STEP_SECONDS);
        if (dir.state === 'RACING') this.overtakeRivals();
        // The race may have ended in this update (a finish or the time limit): its results start here.
        if ((dir.state === 'FINISHED' || dir.state === 'FAILED') && entry.resultsAt === null) entry.resultsAt = { x, z };
        // A rival that has finished leaves the track. A car parked or cruising on the finish line would block the player.
        if (opponents) {
          for (const opponent of opponents.opponents) {
            const row = dir.racerList.find((r) => r.id === this.racerIdOf(opponent));
            if (row?.finished) opponents.retire(opponent.id);
          }
        }
        return;
      }
      if (s === 'EVENT_APPROACH') {
        // Driving out of the exit radius closes the card. A card for an event that is no longer shown closes too.
        // The marker re-arms when the player is out of range.
        if (!this.isVisible(entry.event.id) || this.distanceToMarker(entry, x, z) > RACE_CONFIG.exitRadiusMeters) {
          entry.director.dismissApproach();
          entry.dismissed = false;
          this.active = null;
        }
      } else if (s === 'FINISHED' || s === 'FAILED') {
        // Results stay until Q. They are left only when the car has driven away from where they began and a different
        // event's marker is in range. Without that, the card of the next marker never opens and Start runs the old
        // event. The distance is from the results' start, not from the marker: a finish line is often far from it, and
        // an abort near another marker must not hide its own results.
        if (entry.resultsAt === null) {
          entry.resultsAt = { x, z };
        } else if (distanceXZ(entry.resultsAt, x, z) > RACE_CONFIG.exitRadiusMeters && this.otherMarkerInRange(entry, x, z)) {
          entry.director.leave();
          entry.dismissed = false;
          entry.resultsAt = null;
          this.endAttempt();
          this.updateApproach(x, z);
        }
      }
      return;
    }
    this.updateApproach(x, z);
  }

  /** Pause and resume follow the app's pause. Resuming does not restart the countdown: the session keeps the remaining time. */
  syncPaused(paused: boolean): void {
    const entry = this.active;
    if (!entry) return;
    const s = entry.director.state;
    if (paused && (s === 'COUNTDOWN' || s === 'RACING')) entry.director.pause();
    else if (!paused && s === 'PAUSED') entry.director.resume();
  }

  /** E: start from the approach card, retry after results. Returns true when the car was placed on the grid. */
  confirm(): boolean {
    const entry = this.active;
    if (!entry) {
      this.refuse('Drive to a race marker to start.');
      return false;
    }
    const dir = entry.director;
    const s = dir.state;
    if (s !== 'EVENT_APPROACH' && s !== 'FINISHED' && s !== 'FAILED') {
      this.refuse(s === 'PAUSED' ? 'Resume the race first.' : 'Race already in progress.');
      return false;
    }
    const blocked = this.blockFor(entry.event.id);
    if (blocked) {
      this.refuse(blocked);
      return false;
    }
    if (!dir.start()) {
      this.refuse('Race cannot start now.');
      return false;
    }
    const player = dir.playerSlot;
    if (!player) {
      // A valid route always has a grid slot. If it does not, the attempt is undone and the cause is reported.
      dir.cancel();
      this.refuse('No grid slot on the route.');
      return false;
    }
    this.sim.placeVehicle({ x: player.x, y: 0, z: player.z }, player.yawRadians);
    this.holdTraffic(entry.event.trafficOnRoute === true);
    this.sim.attachOpponents(this.buildOpponents(entry));
    return true;
  }

  /**
   * Q: the meaning depends on the phase. Approach: not now. Countdown: cancel, with no result. Racing: abort (a
   * failure). Results: leave to free roam.
   */
  cancel(): void {
    const entry = this.active;
    if (!entry) return;
    const dir = entry.director;
    switch (dir.state) {
      case 'EVENT_APPROACH':
        dir.dismissApproach();
        entry.dismissed = true;
        this.active = null;
        break;
      case 'COUNTDOWN':
        dir.cancel();
        entry.dismissed = true;
        this.endAttempt();
        break;
      case 'RACING':
        // An aborted race fails here, and its results start where the car is now.
        if (dir.abort()) {
          const position = this.sim.state.position;
          entry.resultsAt = { x: position.x, z: position.z };
        }
        break;
      case 'PAUSED':
        this.refuse('Resume the race first.');
        break;
      case 'FINISHED':
      case 'FAILED':
        dir.leave();
        entry.dismissed = true;
        this.endAttempt();
        break;
      default:
        break;
    }
  }

  /** Called when R or the DEV reset is refused by a race. Tells the player why. */
  refuseReset(): void {
    this.refuse('Reset is locked during a race. Q aborts it, or leaves the results.');
  }

  /** Builds the HUD snapshot from the authoritative race state and writes it to the store. */
  publish(): void {
    useRaceStore.getState().setSnapshot(this.buildSnapshot());
  }

  private buildSnapshot(): RaceSnapshot {
    const now = performance.now();
    const refusal = this.refusal && this.refusal.untilMs > now ? this.refusal.text : null;
    const base = { ...EMPTY_RACE_SNAPSHOT, sessionCredits: this.ledger.total, refusal };
    const entry = this.active;
    if (!entry) return base;
    const dir = entry.director;
    const session = dir.session;
    const player = dir.player;
    const playerRow = dir.standings.find((row) => row.id === PLAYER_ID) ?? null;
    const gates = entry.route.gates;
    const nextGate = player && gates.length > 0 ? gates[player.gatesPassed % gates.length] : undefined;
    const notices = dir.notices.slice(-3).map((notice) => notice.text);
    if (refusal) notices.push(refusal);
    const result: RaceResultInfo | null = dir.result
      ? {
          outcome: dir.result.outcome,
          place: dir.result.place,
          totalRacers: dir.result.totalRacers,
          finishSeconds: dir.result.finishSeconds,
          lapSeconds: dir.result.lapSeconds,
          rewardCredits: dir.result.reward ? dir.result.reward.credits : null,
          standings: dir.result.standings.map((row) => ({ position: row.position, name: row.name, finished: row.finished, isPlayer: row.id === PLAYER_ID })),
        }
      : null;
    return {
      ...base,
      phase: dir.state,
      approach: {
        eventId: entry.event.id,
        name: entry.event.name,
        summary: entry.event.summary,
        difficulty: entry.event.difficulty,
        laps: entry.event.laps,
        checkpointCount: Math.max(0, gates.length - 1),
        opponentCount: entry.event.opponentCount,
        timeLimitSeconds: entry.event.timeLimitSeconds,
        rewardCredits: entry.event.rewardCredits,
        // Shown on the card, so a refused start is explained before the player presses Start.
        blocked: this.blockFor(entry.event.id),
      },
      countdown: session.countdownDisplay,
      goVisible: session.goVisible,
      raceSeconds: session.raceElapsed,
      timeLimitSeconds: session.timeLimitSeconds,
      nextGate: nextGate ? nextGate.label : null,
      lap: player && entry.event.type === 'circuit' ? Math.min(entry.event.laps, (playerRow?.lapsDone ?? 0) + 1) : 0,
      laps: entry.event.type === 'circuit' ? entry.event.laps : 0,
      place: playerRow ? playerRow.position : null,
      totalRacers: dir.standings.length,
      notices,
      result,
      // DEV-only diagnostic. Production snapshots carry null.
      playerTrace: player && import.meta.env.DEV
        ? {
            gatesPassed: player.gatesPassed,
            relocations: player.relocations,
            lastRelocationSeconds: player.lastRelocationSeconds,
            relocationsHeld: player.relocationsHeld,
            routeD: player.routeD,
            onRoute: player.onRoute,
          }
        : null,
    };
  }

  /**
   * Writes the next gate pose of the event in progress into `out`. Returns false when no gate is due (free roam, the
   * approach card, or results).
   */
  nextGatePose(out: { x: number; z: number; yaw: number }): boolean {
    const entry = this.active;
    if (!entry) return false;
    const s = entry.director.state;
    if (s !== 'COUNTDOWN' && s !== 'RACING' && s !== 'PAUSED') return false;
    const player = entry.director.player;
    const gates = entry.route.gates;
    if (!player || gates.length === 0) return false;
    const gate = gates[player.gatesPassed % gates.length];
    if (!gate) return false;
    out.x = gate.x;
    out.z = gate.z;
    out.yaw = gate.headingRadians;
    return true;
  }

  /** True when a marker other than `current` is inside the approach radius. */
  private otherMarkerInRange(current: RaceEntry, x: number, z: number): boolean {
    return this.entries.some((entry) => entry !== current && this.isVisible(entry.event.id) && this.distanceToMarker(entry, x, z) <= RACE_CONFIG.approachRadiusMeters);
  }

  /**
   * Opens the approach card of the first shown marker in range. A hidden marker (locked, or its division retired) never
   * opens a card: the player gets no pop-up for a race they cannot see.
   */
  private updateApproach(x: number, z: number): void {
    for (const entry of this.entries) {
      if (!this.isVisible(entry.event.id)) {
        entry.dismissed = false;
        continue;
      }
      const distance = this.distanceToMarker(entry, x, z);
      if (distance > RACE_CONFIG.exitRadiusMeters) {
        entry.dismissed = false;
        continue;
      }
      if (distance <= RACE_CONFIG.approachRadiusMeters && !entry.dismissed && entry.director.state === 'FREE_ROAM') {
        if (entry.director.openApproach()) this.active = entry;
        return;
      }
    }
  }

  private distanceToMarker(entry: RaceEntry, x: number, z: number): number {
    return Math.hypot(entry.route.marker.x - x, entry.route.marker.z - z);
  }

  private racerIdOf(opponent: AiOpponent): string {
    return `opp-${opponent.id + 1}`;
  }

  private buildOpponents(entry: RaceEntry): OpponentSystem | null {
    const count = entry.director.rivalCount;
    if (count === 0) return null;
    // Each rival's pace is set once, from the grid place it starts in. Passing does not change it.
    const base = eventRivalPaceMps(entry.event);
    const specs: OpponentSpec[] = [];
    for (let k = 0; k < count; k += 1) {
      const slot = entry.director.opponentSlot(k);
      if (!slot) continue;
      specs.push({
        typeId: entry.event.opponents?.[k]?.typeId ?? OPPONENT_TYPE_ORDER[k % OPPONENT_TYPE_ORDER.length] ?? 'sedan',
        laneId: slot.laneId,
        s: slot.s,
        speedMps: 0,
        colourIndex: k + 1,
        speedCapMps: rivalSpeedCapMps(base, entry.director.startingPlaceOf(k)),
        // A race opponent is never teleported. A stalled one stays where it is.
        recyclable: false,
      });
    }
    if (specs.length === 0) return null;
    const route = entry.route;
    this.laneChangeCooldown.clear();
    const routeLaneIndex = this.graph.byId.get(route.grid.laneId)?.laneIndex ?? 0;
    const system = new OpponentSystem(this.graph, this.boundary, specs, {
      // The route's successor map, followed on the rival's own lane index. A rival on the second grid lane follows the
      // twin of each route lane, so it stays on its lane. Beyond the route (after the finish) the lane graph decides, and
      // the opponent stops at the finish anyway.
      nextLaneOf: (lane: LanePath) => {
        const next = route.nextLaneId.get(twinLaneId(lane.id, routeLaneIndex));
        if (next !== undefined) {
          const twin = twinLaneId(next, lane.laneIndex);
          if (this.graph.byId.has(twin)) return twin;
        }
        return successorOf(lane);
      },
    });
    system.setInputOverride((opponent) => this.opponentInput(entry, opponent));
    return system;
  }

  /**
   * Lets a held-up rival move to the neighbouring lane when that lane is clear (see RACE_CONFIG.overtake). A rival is held
   * up when a rival ahead on its own lane is closer than the gap. Each rival waits a cooldown between changes. Called
   * once per race step, after the director has updated.
   */
  private overtakeRivals(): void {
    const opponents = this.sim.opponents;
    if (!opponents) return;
    const rules = RACE_CONFIG.overtake;
    const cooldownSteps = Math.round(rules.cooldownSeconds / FIXED_STEP_SECONDS);
    for (const [id, steps] of this.laneChangeCooldown) {
      if (steps > 0) this.laneChangeCooldown.set(id, steps - 1);
    }
    const rivals = opponents.opponents;
    const player = this.sim.state.position;
    for (const rival of rivals) {
      if ((this.laneChangeCooldown.get(rival.id) ?? 0) > 0) continue;
      const lane = this.graph.byId.get(rival.driver.route.laneId);
      // A lane with no lane-change neighbour (a junction connector) is never changed.
      const neighbour = lane?.lateralIds[0] !== undefined ? this.graph.byId.get(lane.lateralIds[0]) : undefined;
      if (!lane || !neighbour) continue;
      const s = rival.driver.route.s;
      const heldUp = rivals.some((other) => other !== rival && chainDistance(this.graph, lane.id, s, other.driver.route.laneId, other.driver.route.s, rules.gapMeters) !== null);
      if (!heldUp) continue;
      const here = nearestOnLane(neighbour, rival.state.position.x, rival.state.position.z);
      if (!here) continue;
      const rivalBlocks = rivals.some((other) => {
        if (other === rival) return false;
        const otherLane = other.driver.route.laneId;
        const otherS = other.driver.route.s;
        return chainDistance(this.graph, neighbour.id, here.s, otherLane, otherS, rules.clearAheadMeters) !== null
          || chainDistance(this.graph, otherLane, otherS, neighbour.id, here.s, rules.clearBehindMeters) !== null;
      });
      if (rivalBlocks) continue;
      const playerHit = nearestOnLane(neighbour, player.x, player.z);
      const playerBlocks = playerHit !== null && playerHit.distance < rules.playerClearanceMeters
        && playerHit.s >= here.s - rules.clearBehindMeters && playerHit.s <= here.s + rules.clearAheadMeters;
      if (playerBlocks) continue;
      rival.driver.requestLaneChange(neighbour.id);
      this.laneChangeCooldown.set(rival.id, cooldownSteps);
    }
  }

  /** Per-step opponent override: hold on the grid, stop when the race ends, otherwise the AI decides. */
  private opponentInput(entry: RaceEntry, opponent: AiOpponent): InputState | null {
    const dir = entry.director;
    if (isHeldOnGrid(dir.state)) return HOLD_INPUT;
    // The race is over for everyone: all opponents stop. A finished rival is retired (see afterStep), not driven on.
    if (dir.state === 'FINISHED' || dir.state === 'FAILED') return stopInput(opponent.state.speed);
    return null;
  }

  /** Clears the traffic from the grid. Stops new spawns too, unless the race keeps traffic on the route. */
  private holdTraffic(keepSpawning: boolean): void {
    const traffic = this.sim.traffic;
    if (!traffic) return;
    if (!keepSpawning) traffic.spawner.suspend();
    traffic.system.clear();
  }

  /** Ends the attempt's side effects: opponents removed, traffic restored, the entry released. The director keeps its result. */
  private endAttempt(): void {
    this.sim.attachOpponents(null);
    const traffic = this.sim.traffic;
    if (traffic) {
      traffic.spawner.resume();
      this.sim.resetTraffic();
    }
    this.active = null;
  }

  private refuse(text: string): void {
    this.refusal = { text, untilMs: performance.now() + RACE_CONFIG.notificationSeconds * 1000 };
  }
}
