import { describe, expect, it } from 'vitest';
import { allTransitions, canTransition, isEngagedState, isRunningState } from './pursuitStateMachine';
import type { PursuitState } from './pursuitTypes';

const STATES: PursuitState[] = ['INACTIVE', 'DETECTION', 'INITIATING', 'PURSUING', 'ESCALATING', 'SEARCHING', 'COOLDOWN', 'BUSTED'];

describe('pursuit state machine', () => {
  it('allows the documented path from detection to cooldown and back to free roam', () => {
    expect(canTransition('INACTIVE', 'DETECTION')).toBe(true);
    expect(canTransition('DETECTION', 'INITIATING')).toBe(true);
    expect(canTransition('INITIATING', 'PURSUING')).toBe(true);
    expect(canTransition('PURSUING', 'SEARCHING')).toBe(true);
    expect(canTransition('SEARCHING', 'COOLDOWN')).toBe(true);
    expect(canTransition('COOLDOWN', 'INACTIVE')).toBe(true);
  });

  it('refuses moves that skip stages, such as starting a pursuit with no detection', () => {
    expect(canTransition('INACTIVE', 'PURSUING')).toBe(false);
    expect(canTransition('INACTIVE', 'COOLDOWN')).toBe(false);
    expect(canTransition('DETECTION', 'PURSUING')).toBe(false);
    expect(canTransition('INITIATING', 'ESCALATING')).toBe(false);
    expect(canTransition('COOLDOWN', 'SEARCHING')).toBe(false);
    expect(canTransition('PURSUING', 'COOLDOWN')).toBe(false);
  });

  it('only leaves BUSTED for INACTIVE, so a capture always ends the session', () => {
    for (const to of STATES) {
      expect(canTransition('BUSTED', to)).toBe(to === 'INACTIVE');
    }
  });

  it('has no self-transitions', () => {
    for (const state of STATES) expect(canTransition(state, state)).toBe(false);
  });

  it('lists every legal transition exactly once', () => {
    const pairs = allTransitions();
    const keys = new Set(pairs.map(([from, to]) => `${from}>${to}`));
    expect(keys.size).toBe(pairs.length);
    expect(pairs.length).toBe(22);
  });

  it('classifies running and engaged states', () => {
    expect(isRunningState('PURSUING')).toBe(true);
    expect(isRunningState('SEARCHING')).toBe(true);
    expect(isRunningState('COOLDOWN')).toBe(false);
    expect(isEngagedState('INITIATING')).toBe(true);
    expect(isEngagedState('DETECTION')).toBe(false);
    expect(isEngagedState('INACTIVE')).toBe(false);
  });
});
