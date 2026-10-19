/*
 * The loading bars on the handoff page. They complete one at a time, and each takes a random time in the configured
 * range. Pure, so the range and the count are tested without the page.
 */

export interface BarRange {
  readonly minMs: number;
  readonly maxMs: number;
}

/** One bar's run time in milliseconds, from the random source (0 to 1), kept inside the range. */
export function pickBarMs(range: BarRange, random: () => number): number {
  const value = Math.round(range.minMs + random() * (range.maxMs - range.minMs));
  return Math.min(range.maxMs, Math.max(range.minMs, value));
}

/** One run time per bar, in order. */
export function pickBarDurations(count: number, range: BarRange, random: () => number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => pickBarMs(range, random));
}
