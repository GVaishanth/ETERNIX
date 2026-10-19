/**
 * Part 8 economy and garage settings. All prices are in credits (whole numbers). Race rewards are 300 to 400 for
 * a win (raceEvents.ts), so the prices below are set in multiples of a few race wins.
 *
 * Cosmetic rule (stated for players in the garage and in PROJECT_CONTEXT.md): a vehicle's factory paint is free.
 * Any other palette colour costs PAINT_CHANGE_COST_CREDITS per change, paid through the same transaction service as
 * vehicles and upgrades.
 */
export const GARAGE_CONFIG = {
  /** Credits on a new save. Enough for one mid-priced vehicle, or a vehicle plus an upgrade. */
  startingCredits: 1500,
  /** Cost of upgrade tier 1, 2, 3, in credits. The same for every vehicle. */
  upgradeTierCostCredits: [150, 400, 900] as readonly number[],
  /** Cost of applying a non-factory palette colour. */
  paintChangeCostCredits: 150,
  /** A stop is required to enter the garage. Above this speed (m/s) the entrance refuses. */
  entranceMaxSpeedMps: 3,
  /** Radius of the entrance zone, measured from the entrance point on the road (m). */
  entranceRadiusMeters: 12,
} as const;

/** Duplicate-click guard: the same intent within this window (ms) is ignored. Stops double clicks from charging twice. */
export const DUPLICATE_INTENT_WINDOW_MS = 400;
