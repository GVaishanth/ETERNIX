/**
 * Part 9 career settings. Data only. The career rules that use these numbers live in career/careerModel.ts.
 *
 * Reputation is the career's progression score. It is separate from credits: credits buy vehicles and upgrades,
 * reputation unlocks events and rivals and sets the rank. Rewards in credits are paid through the one garage balance.
 */
export const CAREER_CONFIG = {
  /** Reputation on a new career. */
  startingReputation: 0,
  /** Upper bound on reputation, so a bad value cannot grow without limit. */
  reputationMax: 100000,
  /**
   * How many processed race attempts the save keeps for duplicate detection. Older entries are dropped first. A race
   * result is processed once when it is produced, so this only has to outlast the attempts in one play session.
   */
  processedAttemptLimit: 500,
  /**
   * Championship points by place, 1-based. Places past the list score zero. A cup event counts once, at its best finish.
   */
  championshipPointsByPlace: [10, 6, 4, 3, 2, 1] as readonly number[],
  /** Largest finish time kept as a best time, seconds. Anything above it is treated as invalid and dropped. */
  bestTimeMaxSeconds: 36000,
  /** Upper bound on the pursuit escape count, so a bad value cannot grow without limit. */
  escapeCountMax: 100000,
} as const;

/** Upper bound on the rank table size. A catalogue with more ranks is refused by validation. */
export const CAREER_MAX_RANKS = 10;
