import { RACE_CONFIG } from '../config/raceConfig';

/*
 * Provisional race rewards (Part 6). The reward is a session-only ledger: there is no profile or save system, so nothing
 * is persisted. Each attempt can be granted at most once, keyed by event id and attempt id. A retry is a new attempt, so
 * it can grant again. A cancelled or failed attempt never reaches the ledger.
 *
 * The ledger is an instance owned by the race director, not a module-level global, so each session starts empty.
 */

export interface RewardGrant {
  eventId: string;
  attemptId: number;
  place: number;
  credits: number;
}

/** Credits for a finishing place. Base times the place multiplier, rounded to whole credits. Places past the list use the last value. */
export function rewardForPlace(baseCredits: number, place: number, multipliers: readonly number[] = RACE_CONFIG.placeRewardMultiplier): number {
  if (!(place >= 1) || multipliers.length === 0) return 0;
  const index = Math.min(Math.floor(place) - 1, multipliers.length - 1);
  const multiplier = multipliers[index] ?? 0;
  return Math.max(0, Math.round(baseCredits * multiplier));
}

export class RewardLedger {
  private readonly grants = new Map<string, RewardGrant>();

  /**
   * `onGrant` is called once for each NEW grant, after it is recorded. Part 8 uses it to credit the garage balance.
   * A duplicate attempt returns null and does not call it, so the balance is never credited twice for one attempt.
   */
  constructor(private readonly onGrant: ((grant: RewardGrant) => void) | null = null) {}

  /** Grants once per attempt. Returns the grant, or null when this attempt was already granted. */
  grant(eventId: string, attemptId: number, place: number, baseCredits: number): RewardGrant | null {
    const key = attemptKey(eventId, attemptId);
    if (this.grants.has(key)) return null;
    const credits = rewardForPlace(baseCredits, place);
    const entry: RewardGrant = { eventId, attemptId, place, credits };
    this.grants.set(key, entry);
    // A zero-credit grant is recorded (so the attempt is not granted again) but is not reported as a credit.
    if (credits > 0) this.onGrant?.(entry);
    return entry;
  }

  has(eventId: string, attemptId: number): boolean {
    return this.grants.has(attemptKey(eventId, attemptId));
  }

  get total(): number {
    let sum = 0;
    for (const grant of this.grants.values()) sum += grant.credits;
    return sum;
  }

  get count(): number {
    return this.grants.size;
  }
}

function attemptKey(eventId: string, attemptId: number): string {
  return `${eventId}#${attemptId}`;
}
