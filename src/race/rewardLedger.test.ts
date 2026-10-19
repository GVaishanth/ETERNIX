import { describe, expect, it } from 'vitest';
import { RewardLedger, type RewardGrant } from './rewards';

/*
 * Part 8: race rewards now credit the garage balance through the ledger's onGrant. These tests pin the rule that the
 * balance is credited exactly once per attempt: retries are new attempts, and a duplicate call never credits again.
 */
describe('reward ledger to garage credit', () => {
  it('calls onGrant once for a new attempt, with the place-based credits', () => {
    const grants: RewardGrant[] = [];
    const ledger = new RewardLedger((grant) => grants.push(grant));
    ledger.grant('event-a', 1, 1, 300);
    expect(grants).toEqual([{ eventId: 'event-a', attemptId: 1, place: 1, credits: 300 }]);
  });

  it('does not call onGrant again for the same attempt (a duplicate finish cannot double-credit)', () => {
    const grants: RewardGrant[] = [];
    const ledger = new RewardLedger((grant) => grants.push(grant));
    ledger.grant('event-a', 1, 1, 300);
    expect(ledger.grant('event-a', 1, 1, 300)).toBeNull();
    expect(ledger.grant('event-a', 1, 2, 300)).toBeNull();
    expect(grants.length).toBe(1);
  });

  it('a retry is a new attempt and credits again, as the provisional rule says', () => {
    const grants: RewardGrant[] = [];
    const ledger = new RewardLedger((grant) => grants.push(grant));
    ledger.grant('event-a', 1, 1, 300);
    ledger.grant('event-a', 2, 2, 300);
    expect(grants.map((grant) => grant.credits)).toEqual([300, 180]);
  });

  it('a place past the list earns nothing, so it is recorded but not reported (the table pays the top four)', () => {
    const grants: RewardGrant[] = [];
    const ledger = new RewardLedger((grant) => grants.push(grant));
    ledger.grant('event-a', 1, 99, 300);
    expect(grants).toHaveLength(0);
    expect(ledger.has('event-a', 1)).toBe(true);
  });

  it('a zero-credit grant is recorded but not reported, so the balance never gets a zero entry', () => {
    const grants: RewardGrant[] = [];
    const ledger = new RewardLedger((grant) => grants.push(grant));
    expect(ledger.grant('event-a', 1, 1, 0)?.credits).toBe(0);
    expect(grants.length).toBe(0);
    expect(ledger.grant('event-a', 1, 1, 300)).toBeNull();
  });

  it('works without a listener (the existing session-only behaviour is unchanged)', () => {
    const ledger = new RewardLedger();
    expect(ledger.grant('event-a', 1, 1, 300)?.credits).toBe(300);
    expect(ledger.total).toBe(300);
  });
});
