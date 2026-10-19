/*
 * The session's onEnd hook. The career counts an escape from it, so it must fire exactly once per session, with the reason,
 * after the session has returned to INACTIVE. A pursuit that was never started must not call it.
 */
import { describe, expect, it } from 'vitest';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { PursuitSession, type SessionInput } from './pursuitSession';
import type { PursuitEndReason, PursuitState } from './pursuitTypes';

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

function run(session: PursuitSession, seconds: number, over: Partial<SessionInput> = {}): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) session.step(DT, input(over));
}

interface Recorder {
  readonly calls: { reason: PursuitEndReason; stateInCallback: PursuitState }[];
}

function recordedSession(): { session: PursuitSession; recorder: Recorder } {
  const calls: { reason: PursuitEndReason; stateInCallback: PursuitState }[] = [];
  const session: PursuitSession = new PursuitSession({
    onEnd: (reason) => {
      calls.push({ reason, stateInCallback: session.currentState });
    },
  });
  return { session, recorder: { calls } };
}

describe('pursuit session: onEnd', () => {
  it('fires once with the cooldown reason when a pursuit escapes, after the session is inactive', () => {
    const { session, recorder } = recordedSession();
    session.reportOffence('speeding');
    run(session, PURSUIT_CONFIG.detectionSeconds + 0.05, { seenCount: 1, witnessInView: true });
    run(session, PURSUIT_CONFIG.initiationSeconds + 0.05, { seenCount: 1, witnessInView: true, pursuingUnits: 1 });
    expect(session.currentState).toBe('PURSUING');
    // Out of sight and far enough away: the pursuit goes to cooldown, then ends as an escape.
    run(session, PURSUIT_CONFIG.lostSightSeconds + 0.1, { seenCount: 0, pursuingUnits: 1 });
    run(session, PURSUIT_CONFIG.escape.outOfSightSeconds + 0.2, { seenCount: 0, pursuingUnits: 1, nearestPursuerMeters: 300 });
    expect(session.currentState).toBe('COOLDOWN');
    run(session, PURSUIT_CONFIG.cooldownSeconds + 0.1, { seenCount: 0, pursuingUnits: 0 });
    expect(session.currentState).toBe('INACTIVE');
    expect(session.view().lastEndReason).toBe('cooldown');
    expect(recorder.calls).toEqual([{ reason: 'cooldown', stateInCallback: 'INACTIVE' }]);
  });

  it('fires with the cancelled reason, and a silent end is still reported', () => {
    const { session, recorder } = recordedSession();
    session.reportOffence('speeding');
    session.step(DT, input({ witnessInView: false }));
    expect(recorder.calls).toEqual([{ reason: 'cancelled', stateInCallback: 'INACTIVE' }]);
  });

  it('fires once per session: a second end with nothing running does nothing', () => {
    const { session, recorder } = recordedSession();
    session.reportOffence('speeding');
    session.abort('aborted-reset');
    session.abort('aborted-reset');
    expect(recorder.calls).toHaveLength(1);
  });

  it('fires again for a new session', () => {
    const { session, recorder } = recordedSession();
    session.reportOffence('speeding');
    session.abort('aborted-reset');
    session.reportOffence('speeding');
    session.abort('aborted-reset');
    expect(recorder.calls.map((call) => call.reason)).toEqual(['aborted-reset', 'aborted-reset']);
  });

  it('does not fire for a session that never started', () => {
    const { recorder } = recordedSession();
    expect(recorder.calls).toEqual([]);
  });

  it('a session without a hook still works', () => {
    const session = new PursuitSession();
    session.reportOffence('speeding');
    session.abort('aborted-reset');
    expect(session.currentState).toBe('INACTIVE');
  });
});
