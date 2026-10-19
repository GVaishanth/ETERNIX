import { describe, expect, it } from 'vitest';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { PursuitSession, type SessionInput } from './pursuitSession';

const DT = 1 / 60;

function input(over: Partial<SessionInput> = {}): SessionInput {
  return {
    seenCount: 0,
    witnessInView: true,
    nearestPursuerMeters: null,
    pursuingUnits: 1,
    captured: false,
    playerX: 0,
    playerZ: 0,
    ...over,
  };
}

/** Steps a session for `seconds`, with the same input each step. */
function run(session: PursuitSession, seconds: number, over: Partial<SessionInput> = {}): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) session.step(DT, input(over));
}

/** Starts a session and runs it to PURSUING with one unit chasing. */
function pursuing(): PursuitSession {
  const session = new PursuitSession();
  session.reportOffence('speeding');
  run(session, PURSUIT_CONFIG.detectionSeconds + 0.05, { seenCount: 1, witnessInView: true });
  run(session, PURSUIT_CONFIG.initiationSeconds + 0.05, { seenCount: 1, witnessInView: true, pursuingUnits: 1 });
  expect(session.currentState).toBe('PURSUING');
  return session;
}

describe('pursuit session: start and detection', () => {
  it('starts with no session, and an offence starts detection once', () => {
    const session = new PursuitSession();
    expect(session.currentState).toBe('INACTIVE');
    expect(session.reportOffence('speeding')).toBe('started');
    expect(session.currentState).toBe('DETECTION');
    expect(session.reportOffence('collision')).toBe('ignored');
    expect(session.view().sessionsStarted).toBe(1);
  });

  it('moves from detection to initiating to pursuing after the configured times', () => {
    const session = new PursuitSession();
    session.reportOffence('speeding');
    run(session, PURSUIT_CONFIG.detectionSeconds - 0.1, { seenCount: 1 });
    expect(session.currentState).toBe('DETECTION');
    run(session, 0.2, { seenCount: 1 });
    expect(session.currentState).toBe('INITIATING');
    run(session, PURSUIT_CONFIG.initiationSeconds + 0.05, { seenCount: 1, pursuingUnits: 1 });
    expect(session.currentState).toBe('PURSUING');
  });

  it('cancels silently when the witness loses sight during detection, so no pursuit starts', () => {
    const session = new PursuitSession();
    session.reportOffence('speeding');
    session.step(DT, input({ witnessInView: false }));
    expect(session.currentState).toBe('INACTIVE');
    expect(session.drainNotices()).toEqual([]);
    expect(session.view().lastEndReason).toBe('cancelled');
  });

  it('does not reach initiating or pursuing when no unit can respond, and ends after the no-unit time', () => {
    const session = new PursuitSession();
    session.reportOffence('speeding');
    run(session, PURSUIT_CONFIG.detectionSeconds + 0.05, { seenCount: 1 });
    expect(session.currentState).toBe('INITIATING');
    run(session, PURSUIT_CONFIG.stuck.noUnitSeconds + 0.5, { seenCount: 0, pursuingUnits: 0, witnessInView: true });
    expect(session.currentState).toBe('INACTIVE');
    expect(session.view().lastEndReason).toBe('no-units');
  });
});

describe('pursuit session: heat and escalation', () => {
  it('adds detection heat once, and adds heat while running', () => {
    const session = pursuing();
    expect(session.view().heat).toBeGreaterThan(PURSUIT_CONFIG.heat.detectionPoints);
  });

  it('levels up at the threshold and announces it once', () => {
    const session = pursuing();
    run(session, 15, { seenCount: 1, pursuingUnits: 2 });
    expect(session.heatLevel.level).toBeGreaterThanOrEqual(2);
    const notices = session.drainNotices();
    expect(notices.filter((text) => text === 'Heat level 2').length).toBe(1);
  });

  it('is escalating while more units are wanted than are chasing, and back to pursuing when they arrive', () => {
    const session = pursuing();
    run(session, 12, { seenCount: 1, pursuingUnits: 1 });
    expect(session.heatLevel.maxUnits).toBeGreaterThan(1);
    expect(session.currentState).toBe('ESCALATING');
    expect(session.drainNotices()).toContain('Backup requested');
    session.step(DT, input({ seenCount: 1, pursuingUnits: session.heatLevel.maxUnits }));
    expect(session.currentState).toBe('PURSUING');
  });

  it('rate limits repeated offences, and never starts a second session', () => {
    const session = pursuing();
    expect(session.reportOffence('speeding')).toBe('limited');
    run(session, PURSUIT_CONFIG.heat.eventMinIntervalSeconds + 0.1, { seenCount: 1, pursuingUnits: 2 });
    expect(session.reportOffence('collision')).toBe('added');
    expect(session.view().sessionsStarted).toBe(1);
  });
});

describe('pursuit session: lost sight, search, and reacquire', () => {
  it('moves to searching after the lost-sight time, and back to pursuing when a unit sees the player', () => {
    const session = pursuing();
    run(session, PURSUIT_CONFIG.lostSightSeconds + 0.2, { seenCount: 0, pursuingUnits: 1 });
    expect(session.currentState).toBe('SEARCHING');
    expect(session.drainNotices()).toContain('Lost visual, searching');
    session.step(DT, input({ seenCount: 1, pursuingUnits: 1, playerX: 12, playerZ: 34 }));
    expect(session.currentState).toBe('PURSUING');
    expect(session.drainNotices()).toContain('Spotted again');
    expect(session.lastKnownPosition).toEqual({ x: 12, z: 34 });
  });

  it('does not search while one unit still sees the player', () => {
    const session = pursuing();
    run(session, 10, { seenCount: 1, pursuingUnits: 1 });
    expect(session.currentState).not.toBe('SEARCHING');
  });

  it('cools down only when out of sight for the escape time AND separated from every pursuer', () => {
    const session = pursuing();
    run(session, PURSUIT_CONFIG.lostSightSeconds + 0.1, { seenCount: 0, pursuingUnits: 1 });
    // Out of sight for long enough, but the nearest unit is still close: no escape.
    run(session, PURSUIT_CONFIG.escape.outOfSightSeconds + 1, { seenCount: 0, pursuingUnits: 1, nearestPursuerMeters: 40 });
    expect(session.currentState).toBe('SEARCHING');
    // Separated, but not for long enough out of sight: continue to search with the close unit gone.
    const second = pursuing();
    run(second, PURSUIT_CONFIG.lostSightSeconds + 0.1, { seenCount: 0, pursuingUnits: 1 });
    run(second, 1, { seenCount: 0, pursuingUnits: 1, nearestPursuerMeters: 300 });
    expect(second.currentState).toBe('SEARCHING');
    // Both conditions met: cooldown.
    run(second, PURSUIT_CONFIG.escape.outOfSightSeconds, { seenCount: 0, pursuingUnits: 1, nearestPursuerMeters: 300 });
    expect(second.currentState).toBe('COOLDOWN');
    expect(second.drainNotices()).toContain('Lost them, cooling down');
  });

  it('calls off the search when the level search time runs out without sight, which is bounded', () => {
    const session = pursuing();
    run(session, PURSUIT_CONFIG.lostSightSeconds + 0.1, { seenCount: 0, pursuingUnits: 1 });
    // A close pursuer blocks the escape, so only the search timer can end the search. The level can rise while
    // searching, so the bound is checked against the level in force, step by step.
    const cap = 60 * 60;
    let steps = 0;
    while (session.currentState === 'SEARCHING' && steps < cap) {
      session.step(DT, input({ seenCount: 0, pursuingUnits: 1, nearestPursuerMeters: 90 }));
      steps += 1;
    }
    expect(session.currentState).toBe('COOLDOWN');
    expect(steps).toBeLessThan(cap);
    expect(session.drainNotices()).toContain('Search called off');
  });
});

describe('pursuit session: cooldown, end, and cleanup', () => {
  it('ends after cooldown exactly once, resets heat, and reports the cooldown reason', () => {
    const session = pursuing();
    run(session, PURSUIT_CONFIG.lostSightSeconds + 0.1, { seenCount: 0, pursuingUnits: 1 });
    run(session, PURSUIT_CONFIG.escape.outOfSightSeconds + 0.2, { seenCount: 0, pursuingUnits: 1, nearestPursuerMeters: 300 });
    expect(session.currentState).toBe('COOLDOWN');
    run(session, PURSUIT_CONFIG.cooldownSeconds + 0.1, { seenCount: 0, pursuingUnits: 0 });
    expect(session.currentState).toBe('INACTIVE');
    const view = session.view();
    expect(view.lastEndReason).toBe('cooldown');
    expect(view.heat).toBe(0);
    expect(view.level).toBe(1);
    expect(session.drainNotices().filter((text) => text === 'Pursuit over')).toHaveLength(1);
  });

  it('does not lose heat on a quick corner: heat is unchanged while searching, and only falls in cooldown', () => {
    const session = pursuing();
    run(session, PURSUIT_CONFIG.lostSightSeconds + 0.1, { seenCount: 0, pursuingUnits: 1 });
    const before = session.view().heat;
    run(session, 0.5, { seenCount: 0, pursuingUnits: 1, nearestPursuerMeters: 30 });
    expect(session.view().heat).toBeGreaterThanOrEqual(before);
  });

  it('reacquires during cooldown, and starts no new session', () => {
    const session = pursuing();
    run(session, PURSUIT_CONFIG.lostSightSeconds + 0.1, { seenCount: 0, pursuingUnits: 1 });
    run(session, PURSUIT_CONFIG.escape.outOfSightSeconds + 0.2, { seenCount: 0, pursuingUnits: 1, nearestPursuerMeters: 300 });
    expect(session.currentState).toBe('COOLDOWN');
    session.step(DT, input({ seenCount: 1, pursuingUnits: 1 }));
    expect(session.currentState).toBe('PURSUING');
    expect(session.view().sessionsStarted).toBe(1);
  });

  it('a capture goes to BUSTED, then ends the session once, with the capture reason', () => {
    const session = pursuing();
    session.step(DT, input({ seenCount: 1, pursuingUnits: 1, captured: true }));
    expect(session.currentState).toBe('BUSTED');
    run(session, PURSUIT_CONFIG.capture.bustedShowSeconds + 0.1, { seenCount: 1, pursuingUnits: 1 });
    expect(session.currentState).toBe('INACTIVE');
    expect(session.view().lastEndReason).toBe('busted');
    const notices = session.drainNotices();
    expect(notices.filter((text) => text === 'Busted. Pursuit over')).toHaveLength(1);
    expect(notices).not.toContain('Pursuit over');
  });

  it('a reset aborts any session, clears its state, and ends it once', () => {
    const session = pursuing();
    session.abort('aborted-reset');
    expect(session.currentState).toBe('INACTIVE');
    expect(session.view()).toMatchObject({ heat: 0, lastEndReason: 'aborted-reset', lastKnown: null });
    session.abort('aborted-reset');
    expect(session.rejectedTransitions).toBe(0);
    expect(session.view().sessionsStarted).toBe(1);
  });

  it('a session that has ended can start a new one', () => {
    const session = new PursuitSession();
    session.reportOffence('speeding');
    session.abort('aborted-reset');
    expect(session.reportOffence('speeding')).toBe('started');
    expect(session.view().sessionsStarted).toBe(2);
  });
});

describe('pursuit session: invariants over a long run', () => {
  it('never takes an illegal transition, and keeps heat in range, under varied inputs', () => {
    const session = new PursuitSession();
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const seen = new Set<string>();
    // Sight comes in bursts: it switches on or off with a small chance each step, so losses last seconds, as in driving.
    let sightOn = true;
    for (let step = 0; step < 60 * 60 * 20; step += 1) {
      if (session.currentState === 'INACTIVE' && random() < 0.01) session.reportOffence('speeding');
      if (random() < 0.002) session.reportOffence('collision');
      if (random() < 0.004) sightOn = !sightOn;
      session.step(DT, {
        seenCount: sightOn ? 1 : 0,
        witnessInView: random() < 0.97,
        nearestPursuerMeters: random() < 0.5 ? random() * 300 : null,
        pursuingUnits: random() < 0.9 ? 1 + Math.floor(random() * 3) : 0,
        captured: random() < 0.0008,
        playerX: 0,
        playerZ: 0,
      });
      seen.add(session.currentState);
      const view = session.view();
      expect(view.heat).toBeGreaterThanOrEqual(0);
      expect(view.heat).toBeLessThanOrEqual(PURSUIT_CONFIG.heat.maxHeat);
      expect(Number.isFinite(view.escapeProgress)).toBe(true);
      expect(view.level).toBeGreaterThanOrEqual(1);
      expect(view.level).toBeLessThanOrEqual(5);
    }
    expect(session.rejectedTransitions).toBe(0);
    expect(session.view().sessionsStarted).toBeGreaterThan(1);
    expect(seen.has('PURSUING')).toBe(true);
    expect(seen.has('SEARCHING')).toBe(true);
  });
});
