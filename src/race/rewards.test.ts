import { describe, expect, it } from 'vitest';
import { RewardLedger, rewardForPlace } from './rewards';
import { RACE_CONFIG } from '../config/raceConfig';

describe('rewards', () => {
  it('applies the place multiplier and rounds to whole credits', () => {
    expect(rewardForPlace(300, 1)).toBe(300);
    expect(rewardForPlace(300, 2)).toBe(Math.round(300 * RACE_CONFIG.placeRewardMultiplier[1]!));
    expect(rewardForPlace(300, 4)).toBe(Math.round(300 * RACE_CONFIG.placeRewardMultiplier[3]!));
  });

  it('pays only the top four: fifth and sixth earn nothing, and so does a place past the list', () => {
    expect(RACE_CONFIG.placeRewardMultiplier.slice(4)).toEqual([0, 0]);
    expect(rewardForPlace(300, 5)).toBe(0);
    expect(rewardForPlace(300, 6)).toBe(0);
    expect(rewardForPlace(300, 9)).toBe(0);
  });

  it('nothing for an invalid place', () => {
    expect(rewardForPlace(300, 0)).toBe(0);
    expect(rewardForPlace(300, Number.NaN)).toBe(0);
  });

  it('grants once per attempt, and a duplicate grant is refused', () => {
    const ledger = new RewardLedger();
    expect(ledger.grant('sprint-eastside', 1, 1, 300)?.credits).toBe(300);
    expect(ledger.grant('sprint-eastside', 1, 1, 300)).toBeNull();
    expect(ledger.total).toBe(300);
    expect(ledger.count).toBe(1);
  });

  it('a retry is a new attempt and can be granted again, while the old one stays granted', () => {
    const ledger = new RewardLedger();
    ledger.grant('sprint-eastside', 1, 1, 300);
    expect(ledger.grant('sprint-eastside', 2, 1, 300)).not.toBeNull();
    expect(ledger.has('sprint-eastside', 1)).toBe(true);
    expect(ledger.total).toBe(600);
  });

  it('starts empty for each ledger (no hidden global state)', () => {
    const a = new RewardLedger();
    a.grant('sprint-eastside', 1, 1, 300);
    expect(new RewardLedger().total).toBe(0);
  });
});
