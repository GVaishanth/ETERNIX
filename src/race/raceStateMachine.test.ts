import { describe, expect, it } from 'vitest';
import { canTransition, isHeldOnGrid, isRaceActive } from './raceStateMachine';
import type { RaceState } from './raceTypes';

const ALL: RaceState[] = ['FREE_ROAM', 'EVENT_APPROACH', 'COUNTDOWN', 'RACING', 'FINISHED', 'FAILED', 'PAUSED'];

const EXPECTED: Record<RaceState, RaceState[]> = {
  FREE_ROAM: ['EVENT_APPROACH'],
  EVENT_APPROACH: ['FREE_ROAM', 'COUNTDOWN'],
  COUNTDOWN: ['RACING', 'FREE_ROAM', 'PAUSED'],
  RACING: ['FINISHED', 'FAILED', 'PAUSED'],
  FINISHED: ['COUNTDOWN', 'FREE_ROAM'],
  FAILED: ['COUNTDOWN', 'FREE_ROAM'],
  PAUSED: ['COUNTDOWN', 'RACING'],
};

describe('race state table', () => {
  it('allows exactly the documented transitions, and nothing else', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const expected = EXPECTED[from].includes(to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('never allows a finish or a fail straight from free roam or the approach card', () => {
    expect(canTransition('FREE_ROAM', 'FINISHED')).toBe(false);
    expect(canTransition('EVENT_APPROACH', 'RACING')).toBe(false);
    expect(canTransition('COUNTDOWN', 'FINISHED')).toBe(false);
  });

  it('reports active and held states', () => {
    expect(isRaceActive('COUNTDOWN')).toBe(true);
    expect(isRaceActive('RACING')).toBe(true);
    expect(isRaceActive('PAUSED')).toBe(true);
    expect(isRaceActive('FREE_ROAM')).toBe(false);
    expect(isRaceActive('FINISHED')).toBe(false);
    expect(isHeldOnGrid('COUNTDOWN')).toBe(true);
    expect(isHeldOnGrid('RACING')).toBe(false);
  });
});
