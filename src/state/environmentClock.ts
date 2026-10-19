/*
 * The shared environment clock (pure rules and a small timer). Every ENVIRONMENT_CHANGE_SECONDS the parts of the
 * environment that are on automatic cycle change at random, avoiding a repeat of the current value. The saved record
 * also holds a manual flag per part: a part the player set by hand (N, M, or the home page controls) stays fixed until
 * the player changes it again or turns automatic cycling back on. The current environment is saved in localStorage, so
 * the home page and the game show the same one, even though they are separate pages. The game save is never touched.
 *
 * A record written before cycle flags existed has no `cycle` field. It is read as fully automatic, so older saves keep
 * their behaviour.
 *
 * Nothing here imports React or three.js. The timer takes its clock, random source, and storage as parameters, so it
 * is tested with fake time.
 */
import { ENVIRONMENT_CHANGE_SECONDS, TIME_OF_DAY_ORDER, TIME_OF_DAY_PRESETS, WEATHER_ORDER, WEATHER_PRESETS } from '../config/environmentConfig';
import { pickNextEnvironment, type EnvironmentChoice } from '../environment/environmentModel';
import type { StorageLike } from '../save/saveFile';

/** localStorage key for the shared environment. Separate from the game save. */
export const ENVIRONMENT_STORAGE_KEY = 'street-racer.environment.v1';

/** Own properties only, so a stored "constructor" or "toString" is rejected. */
function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export const ENVIRONMENT_INTERVAL_MS = ENVIRONMENT_CHANGE_SECONDS * 1000;

/** Which parts of the environment follow the automatic cycle. true is automatic, false is manual (fixed). */
export interface EnvironmentCycle {
  readonly timeOfDay: boolean;
  readonly weather: boolean;
}

/** Both parts automatic. The default, and what a record without a cycle field means. */
export const AUTOMATIC_CYCLE: EnvironmentCycle = { timeOfDay: true, weather: true };

/** The environment the game shows, with the cycle flags. */
export interface EnvironmentView extends EnvironmentChoice {
  readonly cycle: EnvironmentCycle;
}

/** The stored environment and when it began (epoch milliseconds). */
export interface EnvironmentRecord extends EnvironmentChoice {
  readonly changedAt: number;
  /** Absent in records written before cycle flags existed. Use cycleOf() to read it. */
  readonly cycle?: EnvironmentCycle;
}

/** The cycle flags of a record. A record without them is fully automatic. */
export function cycleOf(record: { readonly cycle?: EnvironmentCycle }): EnvironmentCycle {
  return record.cycle ?? AUTOMATIC_CYCLE;
}

/** Reads a stored record. Anything malformed or with an unknown id is treated as no record. */
export function parseEnvironmentRecord(raw: string | null): EnvironmentRecord | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const timeOfDay = record.timeOfDay;
    const weather = record.weather;
    const changedAt = record.changedAt;
    if (typeof timeOfDay !== 'string' || !hasOwn(TIME_OF_DAY_PRESETS, timeOfDay)) return null;
    if (typeof weather !== 'string' || !hasOwn(WEATHER_PRESETS, weather)) return null;
    if (typeof changedAt !== 'number' || !Number.isFinite(changedAt)) return null;
    const cycle = parseCycle(record.cycle);
    if (cycle === 'invalid') return null;
    return {
      timeOfDay: timeOfDay as EnvironmentChoice['timeOfDay'],
      weather: weather as EnvironmentChoice['weather'],
      changedAt,
      ...(cycle === undefined ? {} : { cycle }),
    };
  } catch {
    return null;
  }
}

/** undefined when absent (an older record), 'invalid' when present but malformed. */
function parseCycle(raw: unknown): EnvironmentCycle | undefined | 'invalid' {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null) return 'invalid';
  const cycle = raw as Record<string, unknown>;
  if (typeof cycle.timeOfDay !== 'boolean' || typeof cycle.weather !== 'boolean') return 'invalid';
  return { timeOfDay: cycle.timeOfDay, weather: cycle.weather };
}

/**
 * The environment carried by a `storage` event from another page, or null when the event is for another key, was a
 * removal, or holds a malformed record. The listener applies it at once, so a change made in one page shows in the
 * others straight away instead of at their next tick.
 */
export function environmentFromStorageEvent(key: string | null, newValue: string | null): EnvironmentView | null {
  if (key !== ENVIRONMENT_STORAGE_KEY) return null;
  const record = parseEnvironmentRecord(newValue);
  return record === null ? null : { timeOfDay: record.timeOfDay, weather: record.weather, cycle: cycleOf(record) };
}

export function readEnvironmentRecord(storage: StorageLike | null): EnvironmentRecord | null {
  if (storage === null) return null;
  try {
    return parseEnvironmentRecord(storage.getItem(ENVIRONMENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Writes the record. A storage that refuses the write is ignored: the environment still runs, it just is not shared. */
export function writeEnvironmentRecord(storage: StorageLike | null, record: EnvironmentRecord): void {
  if (storage === null) return;
  try {
    storage.setItem(ENVIRONMENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Not shared across pages in this browser. Nothing else depends on the write.
  }
}

export interface ResolveInput {
  readonly stored: EnvironmentRecord | null;
  readonly now: number;
  readonly random: () => number;
  readonly intervalMs: number;
}

export interface ResolveResult {
  readonly record: EnvironmentRecord;
  /** True when the record changed (a roll, or a timestamp renewal), so it must be saved. */
  readonly rolled: boolean;
}

/** The environment a fresh start shows: day and clear. The device clock does not set it. */
export const DEFAULT_ENVIRONMENT = { timeOfDay: 'day', weather: 'clear' } as const;

/** A different value from the order, picked at random. Used when only one part cycles. */
function pickOther<T extends string>(order: readonly T[], current: T, random: () => number): T {
  const others = order.filter((value) => value !== current);
  if (others.length === 0) return current;
  const index = Math.min(others.length - 1, Math.floor(random() * others.length));
  return others[index] ?? current;
}

/**
 * The environment that applies now. A stored record that is still inside its interval is kept. With nothing stored, a
 * fresh start shows day and clear. An expired record rolls only the parts on automatic cycle. Parts set by hand keep
 * their value. When no part is automatic, the record only has its timestamp renewed, so the timer never spins.
 */
export function resolveEnvironment(input: ResolveInput): ResolveResult {
  const { stored, now, random, intervalMs } = input;
  if (stored !== null) {
    const age = now - stored.changedAt;
    if (age >= 0 && age < intervalMs) return { record: stored, rolled: false };
    const cycle = cycleOf(stored);
    if (!cycle.timeOfDay && !cycle.weather) {
      return { record: { ...stored, changedAt: now }, rolled: true };
    }
    if (cycle.timeOfDay && cycle.weather) {
      const next = pickNextEnvironment(stored, random);
      return { record: { ...next, changedAt: now, cycle }, rolled: true };
    }
    const timeOfDay = cycle.timeOfDay ? pickOther(TIME_OF_DAY_ORDER, stored.timeOfDay, random) : stored.timeOfDay;
    const weather = cycle.weather ? pickOther(WEATHER_ORDER, stored.weather, random) : stored.weather;
    return { record: { timeOfDay, weather, changedAt: now, cycle }, rolled: true };
  }
  return { record: { ...DEFAULT_ENVIRONMENT, changedAt: now }, rolled: true };
}

export interface ClockDeps {
  readonly storage: StorageLike | null;
  readonly now: () => number;
  readonly random: () => number;
  readonly intervalMs: number;
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  readonly cancel: (handle: unknown) => void;
  /** Receives every environment that applies, including the first. */
  readonly apply: (view: EnvironmentView) => void;
}

/**
 * Starts the interval clock. It applies the current environment at once, then schedules the next change for the exact
 * end of the current interval. Another page's change is picked up at the next tick, so the pages stay in step. Returns a
 * stop function.
 */
export function startEnvironmentClock(deps: ClockDeps): () => void {
  let stopped = false;
  let handle: unknown = null;
  const tick = (): void => {
    if (stopped) return;
    const now = deps.now();
    const { record, rolled } = resolveEnvironment({
      stored: readEnvironmentRecord(deps.storage),
      now,
      random: deps.random,
      intervalMs: deps.intervalMs,
    });
    if (rolled) writeEnvironmentRecord(deps.storage, record);
    // Another page may have written over this one a moment ago. Adopt what is stored, so every page shows the same
    // environment. A stored record older than this one (the write was refused) is ignored, so the schedule never lags.
    const saved = rolled ? readEnvironmentRecord(deps.storage) : null;
    const current = saved !== null && saved.changedAt >= record.changedAt ? saved : record;
    deps.apply({ timeOfDay: current.timeOfDay, weather: current.weather, cycle: cycleOf(current) });
    handle = deps.schedule(tick, Math.max(0, current.changedAt + deps.intervalMs - now));
  };
  tick();
  return () => {
    stopped = true;
    if (handle !== null) deps.cancel(handle);
  };
}

/** Short player-facing label for a cycle: Auto, Manual, or which part is still automatic. */
export function describeCycle(cycle: EnvironmentCycle): string {
  if (cycle.timeOfDay && cycle.weather) return 'Auto';
  if (cycle.timeOfDay) return 'Auto time, manual weather';
  if (cycle.weather) return 'Auto weather, manual time';
  return 'Manual';
}
