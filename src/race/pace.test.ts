import { describe, expect, it } from 'vitest';
import { RACE_CONFIG, RACE_MIN_RACERS } from '../config/raceConfig';
import { CAREER_RACE_EVENTS } from '../career/careerRaces';
import { LOOP_RACE_EVENTS, RACE_EVENTS, SPRINT_EASTSIDE } from './raceEvents';
import { eventRivalPaceMps, placePaceFactor, rivalSpeedCapMps } from './pace';
import { RACE_DIFFICULTY_SPEED_FACTOR } from '../config/raceConfig';

/*
 * Rival pace (pure). A rival's cap is its event pace times the factor for the place it holds now. The cars behind the
 * player are the faster ones: the leader is the slowest and the last place the fastest, so a player who starts 7th is
 * chased. Places are 1-based, and a ten-racer field has ten places.
 */

describe('rival pace: the place table', () => {
  it('covers every place in a full field, so no racer falls off the table', () => {
    expect(RACE_CONFIG.placePaceFactor).toHaveLength(RACE_MIN_RACERS);
  });

  it('the factor never falls down the order: the leader is slowest, the last place fastest', () => {
    const factors = Array.from({ length: RACE_MIN_RACERS }, (_, index) => placePaceFactor(index + 1));
    for (let i = 1; i < factors.length; i += 1) expect(factors[i]!).toBeGreaterThanOrEqual(factors[i - 1]!);
    expect(placePaceFactor(RACE_MIN_RACERS)).toBeGreaterThan(placePaceFactor(1));
  });

  it('the cars behind the player (places 8 to 10) are faster than the player at 7th, and the cars ahead of it are slower', () => {
    expect(placePaceFactor(7)).toBe(1);
    for (const place of [8, 9, 10]) expect(placePaceFactor(place), `place ${place}`).toBeGreaterThan(placePaceFactor(7));
    for (const place of [1, 2, 3, 4, 5, 6]) expect(placePaceFactor(place), `place ${place}`).toBeLessThan(placePaceFactor(7));
  });

  it('a place past the table uses its last value, and a place below first uses the first', () => {
    expect(placePaceFactor(RACE_MIN_RACERS + 3)).toBe(RACE_CONFIG.placePaceFactor[RACE_MIN_RACERS - 1]);
    expect(placePaceFactor(0)).toBe(RACE_CONFIG.placePaceFactor[0]);
    expect(placePaceFactor(-3)).toBe(RACE_CONFIG.placePaceFactor[0]);
  });
});

describe('rival pace: caps', () => {
  it('a cap is the base pace times the place factor times the race AI multiplier', () => {
    expect(RACE_CONFIG.aiSpeedMultiplier).toBe(2.5);
    expect(rivalSpeedCapMps(20, 1)).toBeCloseTo(20 * RACE_CONFIG.placePaceFactor[0]! * 2.5, 9);
    expect(rivalSpeedCapMps(20, 10)).toBeCloseTo(20 * RACE_CONFIG.placePaceFactor[9]! * 2.5, 9);
  });

  it('a rival that moves back gets a faster cap, and the last place is faster than the leader', () => {
    const caps = Array.from({ length: RACE_MIN_RACERS }, (_, index) => rivalSpeedCapMps(20, index + 1));
    for (let i = 1; i < caps.length; i += 1) expect(caps[i]!).toBeGreaterThanOrEqual(caps[i - 1]!);
    expect(caps[RACE_MIN_RACERS - 1]!).toBeGreaterThan(caps[0]!);
    expect(caps.every((cap) => cap > 0)).toBe(true);
  });

  it('the event base pace is its opponent top speed times the difficulty factor', () => {
    expect(eventRivalPaceMps(SPRINT_EASTSIDE)).toBeCloseTo(SPRINT_EASTSIDE.opponentTopSpeedMps * RACE_DIFFICULTY_SPEED_FACTOR[SPRINT_EASTSIDE.difficulty], 9);
  });

  it('a harder difficulty gives a faster base pace on the same event', () => {
    const easy = eventRivalPaceMps({ opponentTopSpeedMps: 30, difficulty: 1 });
    const hard = eventRivalPaceMps({ opponentTopSpeedMps: 30, difficulty: 3 });
    expect(hard).toBeGreaterThan(easy);
  });

  it('every race event with rivals has a positive base pace (the solo Clock Run has no rivals, so no pace)', () => {
    for (const event of [...RACE_EVENTS, ...LOOP_RACE_EVENTS, ...CAREER_RACE_EVENTS]) {
      if (event.opponentCount === 0) {
        expect(event.opponentTopSpeedMps, event.id).toBe(0);
        continue;
      }
      expect(eventRivalPaceMps(event), event.id).toBeGreaterThan(0);
    }
  });
});
