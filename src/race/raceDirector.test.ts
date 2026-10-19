import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, type LaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute, type RaceRoute } from './raceRoute';
import { SPRINT_EASTSIDE } from './raceEvents';
import { RaceDirector, PLAYER_ID } from './raceDirector';
import { RewardLedger } from './rewards';
import type { RaceEventDefinition } from './raceTypes';

const STEP = 1 / 60;
const graph: LaneGraph = buildLaneGraph(buildCityNetwork());
const route = buildRaceRoute(SPRINT_EASTSIDE, graph).route as RaceRoute;

/**
 * Points along the route from the grid onward, in travel order, interpolated at 0.5 m. One point per fixed step is then
 * about 30 m/s, a plausible pace, so a full lap fits inside the time limit. Every gate is crossed by a swept step.
 */
function samplesFromGrid(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const { xs, zs, ds } = route.polyline;
  const STEP_M = 0.5;
  let next = route.grid.s;
  for (let i = 0; i + 1 < xs.length; i += 1) {
    const d0 = ds[i] ?? 0;
    const d1 = ds[i + 1] ?? d0;
    if (d1 < next || d1 <= d0) continue;
    while (next <= d1) {
      const t = (next - d0) / (d1 - d0);
      out.push({ x: (xs[i] ?? 0) + ((xs[i + 1] ?? 0) - (xs[i] ?? 0)) * t, z: (zs[i] ?? 0) + ((zs[i + 1] ?? 0) - (zs[i] ?? 0)) * t });
      next += STEP_M;
    }
  }
  return out;
}

function makeDirector(event: RaceEventDefinition = SPRINT_EASTSIDE, ledger = new RewardLedger(), opponents = event.opponentCount) {
  return new RaceDirector(event, route, graph, ledger, opponents);
}

/** Approach the event, then start it. The approach card must come first, as in play. */
function begin(d: RaceDirector): boolean {
  return d.openApproach() && d.start();
}

function countdown(d: RaceDirector): void {
  let guard = 0;
  while (d.state === 'COUNTDOWN' && guard < 2000) {
    d.update(STEP);
    guard += 1;
  }
}

/** Drives the player through the samples, one per fixed step. Opponents, if any, hold at their slots. */
function drive(d: RaceDirector, samples: { x: number; z: number }[], playerLag = 0): string[] {
  const slots = d.gridSlots;
  for (let k = 1; k < slots.length; k += 1) {
    const slot = d.opponentSlot(k - 1)!;
    d.setRacerPosition(`opp-${k}`, slot.x, slot.z);
  }
  // Notices expire after a few seconds, so collect them as they appear.
  const seen: string[] = [];
  let i = 0;
  let guard = 0;
  while (d.state === 'RACING' && guard < 20000) {
    const p = samples[Math.min(Math.max(i - playerLag, 0), samples.length - 1)]!;
    d.setRacerPosition(PLAYER_ID, p.x, p.z);
    d.update(STEP);
    for (const n of d.notices) if (!seen.includes(n.text)) seen.push(n.text);
    i += 1;
    guard += 1;
  }
  return seen;
}

describe('race director: full attempt on the Eastside Sprint', () => {
  it('starts with the player and the opponents on the grid, and the countdown running', () => {
    const d = makeDirector();
    expect(begin(d)).toBe(true);
    expect(d.state).toBe('COUNTDOWN');
    // Nine rivals and the player: the player starts 7th, in the third row, with the faster rivals behind.
    expect(d.racerList.map((r) => r.id)).toEqual([PLAYER_ID, ...Array.from({ length: 9 }, (_, k) => `opp-${k + 1}`)]);
    expect(d.gridSlots).toHaveLength(10);
    expect(d.player?.routeD).toBeCloseTo(d.gridSlots[6]!.routeD, 6);
    expect(d.player?.routeD).toBeLessThan(d.gridSlots[0]!.routeD);
    expect(d.standings[6]?.id).toBe(PLAYER_ID);
  });

  it('a clean run finishes once, with the player at place 1, and grants the reward once', () => {
    const ledger = new RewardLedger();
    const d = makeDirector(SPRINT_EASTSIDE, ledger, 0);
    begin(d);
    countdown(d);
    expect(d.state).toBe('RACING');
    const texts = drive(d, samplesFromGrid());
    expect(d.state).toBe('FINISHED');
    const result = d.result!;
    expect(result.outcome).toBe('finished');
    expect(result.place).toBe(1);
    expect(result.reward?.credits).toBe(SPRINT_EASTSIDE.rewardCredits);
    expect(ledger.total).toBe(SPRINT_EASTSIDE.rewardCredits);
    expect(result.finishSeconds).not.toBeNull();
    expect(result.finishSeconds!).toBeGreaterThan(10);
    // Each gate was announced once, in order, and the finish was announced last.
    const gateNotices = texts.filter((t) => t.endsWith('passed'));
    expect(gateNotices).toEqual(['Checkpoint 1 passed', 'Checkpoint 2 passed', 'Finish passed']);
  });

  it('a retry rebuilds every racer, clears the result, and can be granted as a new attempt', () => {
    const ledger = new RewardLedger();
    const d = makeDirector(SPRINT_EASTSIDE, ledger, 2);
    begin(d);
    countdown(d);
    drive(d, samplesFromGrid());
    expect(d.result?.outcome).toBe('finished');
    const firstAttempt = d.attemptId;
    expect(d.start()).toBe(true);
    expect(d.result).toBeNull();
    expect(d.attemptId).toBe(firstAttempt + 1);
    expect(d.racerList).toHaveLength(3);
    expect(d.racerList.every((r) => r.gatesPassed === 0 && !r.finished)).toBe(true);
    countdown(d);
    drive(d, samplesFromGrid());
    expect(ledger.count).toBe(2);
    expect(ledger.has(SPRINT_EASTSIDE.id, firstAttempt)).toBe(true);
  });

  it('a cancel during the countdown leaves no result and grants nothing', () => {
    const ledger = new RewardLedger();
    const d = makeDirector(SPRINT_EASTSIDE, ledger, 2);
    begin(d);
    d.update(STEP);
    expect(d.cancel()).toBe(true);
    expect(d.state).toBe('FREE_ROAM');
    expect(d.result).toBeNull();
    expect(ledger.count).toBe(0);
    expect(d.racerList).toHaveLength(0);
  });

  it('an abort during the race ends it as aborted, with no reward', () => {
    const ledger = new RewardLedger();
    const d = makeDirector(SPRINT_EASTSIDE, ledger, 2);
    begin(d);
    countdown(d);
    for (let i = 0; i < 120; i += 1) d.update(STEP);
    expect(d.abort()).toBe(true);
    expect(d.state).toBe('FAILED');
    expect(d.result?.outcome).toBe('aborted');
    expect(d.result?.reward).toBeNull();
    expect(ledger.count).toBe(0);
  });

  it('the time limit fails the race as timeout, with no reward', () => {
    const ledger = new RewardLedger();
    const short: RaceEventDefinition = { ...SPRINT_EASTSIDE, timeLimitSeconds: 5 };
    const d = makeDirector(short, ledger, 0);
    begin(d);
    countdown(d);
    let guard = 0;
    while (d.state === 'RACING' && guard < 2000) {
      d.update(STEP);
      guard += 1;
    }
    expect(d.state).toBe('FAILED');
    expect(d.result?.outcome).toBe('timeout');
    expect(ledger.count).toBe(0);
  });

  it('leaving the results clears the racers and returns to free roam', () => {
    const d = makeDirector(SPRINT_EASTSIDE, new RewardLedger(), 0);
    begin(d);
    countdown(d);
    d.abort();
    expect(d.leave()).toBe(true);
    expect(d.state).toBe('FREE_ROAM');
    expect(d.racerList).toHaveLength(0);
  });

  it('pause freezes the countdown; resume does not restart it', () => {
    const d = makeDirector(SPRINT_EASTSIDE, new RewardLedger(), 0);
    begin(d);
    for (let i = 0; i < 60; i += 1) d.update(STEP);
    const left = d.session.countdownRemaining;
    expect(d.pause()).toBe(true);
    // The renderer skips simulation updates while paused, so nothing is called here.
    expect(d.session.countdownRemaining).toBe(left);
    expect(d.resume()).toBe(true);
    expect(d.session.countdownRemaining).toBe(left);
    expect(d.state).toBe('COUNTDOWN');
  });

  it('pause during the race freezes the race timer', () => {
    const d = makeDirector(SPRINT_EASTSIDE, new RewardLedger(), 0);
    begin(d);
    countdown(d);
    for (let i = 0; i < 90; i += 1) d.update(STEP);
    const t = d.session.raceElapsed;
    d.pause();
    d.resume();
    expect(d.session.raceElapsed).toBe(t);
  });

  it('a later checkpoint crossed early is reported and does not advance', () => {
    const d = makeDirector(SPRINT_EASTSIDE, new RewardLedger(), 0);
    begin(d);
    countdown(d);
    const finish = route.gates[route.gates.length - 1]!;
    const behind = { x: finish.x - Math.sin(finish.headingRadians) * 2, z: finish.z - Math.cos(finish.headingRadians) * 2 };
    const ahead = { x: finish.x + Math.sin(finish.headingRadians) * 2, z: finish.z + Math.cos(finish.headingRadians) * 2 };
    d.setRacerPosition(PLAYER_ID, behind.x, behind.z);
    d.update(STEP);
    d.setRacerPosition(PLAYER_ID, ahead.x, ahead.z);
    d.update(STEP);
    expect(d.player?.gatesPassed).toBe(0);
    expect(d.notices.some((n) => n.text.includes('is not next'))).toBe(true);
    expect(d.state).toBe('RACING');
  });

  it('an opponent finishing first puts the player second, with the second-place reward', () => {
    const ledger = new RewardLedger();
    const d = makeDirector(SPRINT_EASTSIDE, ledger, 1);
    begin(d);
    countdown(d);
    const samples = samplesFromGrid();
    const lead = 25;
    let i = 0;
    let guard = 0;
    while (d.state === 'RACING' && guard < 20000) {
      const opp = samples[Math.min(i + lead, samples.length - 1)]!;
      d.setRacerPosition('opp-1', opp.x, opp.z);
      const me = samples[Math.min(i, samples.length - 1)]!;
      d.setRacerPosition(PLAYER_ID, me.x, me.z);
      d.update(STEP);
      i += 1;
      guard += 1;
      if (d.player?.finished) break;
    }
    expect(d.racerList.find((r) => r.id === 'opp-1')?.finished).toBe(true);
    expect(d.state).toBe('FINISHED');
    expect(d.result?.place).toBe(2);
    expect(ledger.total).toBe(Math.round(SPRINT_EASTSIDE.rewardCredits * 0.6));
  });
});
