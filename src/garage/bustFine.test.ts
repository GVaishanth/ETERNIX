import { describe, expect, it } from 'vitest';
import { chargeBustFine, createDefaultGarage, type GarageState } from './garageModel';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';

/*
 * The busted fine (pure rule). It takes a share of the credits, rounded to whole credits, and never more than the
 * balance. The garage service saves it in one write (see garageService tests).
 */

function withCredits(credits: number): GarageState {
  return { ...createDefaultGarage(), credits };
}

describe('busted fine: the rule', () => {
  it('takes the share of the balance: 40 percent of 1500 is 600, leaving 900', () => {
    const result = chargeBustFine(withCredits(1500), 40);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chargedCredits).toBe(600);
    expect(result.state.credits).toBe(900);
    expect(result.message).toContain('600');
  });

  it('rounds to whole credits: 40 percent of 1001 is 400.4, which takes 400', () => {
    const result = chargeBustFine(withCredits(1001), 40);
    if (!result.ok) throw new Error('expected ok');
    expect(result.chargedCredits).toBe(400);
    expect(result.state.credits).toBe(601);
  });

  it('a balance too small to round to a credit loses nothing, and says so', () => {
    const result = chargeBustFine(withCredits(1), 40);
    if (!result.ok) throw new Error('expected ok');
    expect(result.chargedCredits).toBe(0);
    expect(result.state.credits).toBe(1);
    expect(result.message).toBe('Busted: no credits to lose.');
  });

  it('an empty balance is charged nothing, with no error', () => {
    const result = chargeBustFine(withCredits(0), 40);
    if (!result.ok) throw new Error('expected ok');
    expect(result.chargedCredits).toBe(0);
    expect(result.state.credits).toBe(0);
  });

  it('never takes more than the balance, even at 100 percent or above', () => {
    const result = chargeBustFine(withCredits(250), 150);
    if (!result.ok) throw new Error('expected ok');
    expect(result.chargedCredits).toBe(250);
    expect(result.state.credits).toBe(0);
  });

  it('a negative percent takes nothing', () => {
    const result = chargeBustFine(withCredits(500), -20);
    if (!result.ok) throw new Error('expected ok');
    expect(result.chargedCredits).toBe(0);
    expect(result.state.credits).toBe(500);
  });

  it('does not change the state it was given', () => {
    const before = withCredits(1500);
    chargeBustFine(before, 40);
    expect(before.credits).toBe(1500);
  });

  it('the configured fine is applied at its configured percent', () => {
    const result = chargeBustFine(withCredits(1350), PURSUIT_CONFIG.capture.bustFinePercent);
    if (!result.ok) throw new Error('expected ok');
    expect(result.chargedCredits).toBe(540);
    expect(result.state.credits).toBe(810);
  });
});
