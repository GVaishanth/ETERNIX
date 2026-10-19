/*
 * Automated tests for the shared environment clock: the stored record, the rule that keeps a fresh record or rolls a
 * stale one, the first environment from the device clock, and the interval timer. Fake time and a fake storage, so no
 * browser is needed.
 */
import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_CHANGE_SECONDS } from '../config/environmentConfig';
import type { StorageLike } from '../save/saveFile';
import {
  environmentFromStorageEvent,
  ENVIRONMENT_STORAGE_KEY,
  parseEnvironmentRecord,
  cycleOf,
  describeCycle,
  readEnvironmentRecord,
  resolveEnvironment,
  startEnvironmentClock,
  writeEnvironmentRecord,
  type EnvironmentRecord,
} from './environmentClock';

const INTERVAL = 300_000;

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] ?? null) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

function record(overrides: Partial<EnvironmentRecord> = {}): EnvironmentRecord {
  return { timeOfDay: 'day', weather: 'clear', changedAt: 1_000_000, ...overrides };
}

describe('environment interval', () => {
  it('changes the time of day and weather once every 5 minutes', () => {
    expect(ENVIRONMENT_CHANGE_SECONDS).toBe(300);
    expect(INTERVAL).toBe(ENVIRONMENT_CHANGE_SECONDS * 1000);
  });
});

describe('parseEnvironmentRecord', () => {
  it('reads a valid record', () => {
    const value = record({ timeOfDay: 'night', weather: 'rain', changedAt: 42 });
    expect(parseEnvironmentRecord(JSON.stringify(value))).toEqual(value);
  });

  it('rejects nothing stored, bad JSON, and unknown ids', () => {
    expect(parseEnvironmentRecord(null)).toBeNull();
    expect(parseEnvironmentRecord('{not json')).toBeNull();
    expect(parseEnvironmentRecord(JSON.stringify({ timeOfDay: 'noon', weather: 'clear', changedAt: 1 }))).toBeNull();
    expect(parseEnvironmentRecord(JSON.stringify({ timeOfDay: 'day', weather: 'snow', changedAt: 1 }))).toBeNull();
  });

  it('rejects inherited object keys, so a stored "constructor" is not a time of day', () => {
    expect(parseEnvironmentRecord(JSON.stringify({ timeOfDay: 'constructor', weather: 'clear', changedAt: 1 }))).toBeNull();
    expect(parseEnvironmentRecord(JSON.stringify({ timeOfDay: 'day', weather: 'toString', changedAt: 1 }))).toBeNull();
  });

  it('rejects a missing or non-numeric start time', () => {
    expect(parseEnvironmentRecord(JSON.stringify({ timeOfDay: 'day', weather: 'clear' }))).toBeNull();
    expect(parseEnvironmentRecord(JSON.stringify({ timeOfDay: 'day', weather: 'clear', changedAt: 'soon' }))).toBeNull();
  });
});

describe('storage helpers', () => {
  it('writes and reads back the same record', () => {
    const storage = memoryStorage();
    const value = record({ weather: 'rain' });
    writeEnvironmentRecord(storage, value);
    expect(readEnvironmentRecord(storage)).toEqual(value);
    expect(storage.data[ENVIRONMENT_STORAGE_KEY]).toBeDefined();
  });

  it('treats no storage as no record and never throws', () => {
    expect(readEnvironmentRecord(null)).toBeNull();
    expect(() => writeEnvironmentRecord(null, record())).not.toThrow();
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readEnvironmentRecord(refusing)).toBeNull();
    expect(() => writeEnvironmentRecord(refusing, record())).not.toThrow();
  });
});

describe('resolveEnvironment', () => {
  const base = { random: () => 0, intervalMs: INTERVAL };

  it('starts at day and clear when nothing is stored, whatever the device clock says', () => {
    const result = resolveEnvironment({ ...base, stored: null, now: 5_000 });
    expect(result.rolled).toBe(true);
    expect(result.record).toEqual({ timeOfDay: 'day', weather: 'clear', changedAt: 5_000 });
  });

  it('keeps a stored record that is still inside its interval', () => {
    const stored = record({ changedAt: 10_000, weather: 'rain' });
    const result = resolveEnvironment({ ...base, stored, now: 10_000 + INTERVAL - 1 });
    expect(result.rolled).toBe(false);
    expect(result.record).toBe(stored);
  });

  it('rolls a stored record once its interval has passed, to a different pair', () => {
    const stored = record({ timeOfDay: 'day', weather: 'clear', changedAt: 10_000 });
    const result = resolveEnvironment({ ...base, stored, now: 10_000 + INTERVAL, random: () => 0.5 });
    expect(result.rolled).toBe(true);
    expect(result.record.changedAt).toBe(10_000 + INTERVAL);
    expect(result.record.timeOfDay === 'day' && result.record.weather === 'clear').toBe(false);
  });

  it('rolls a record whose start time is in the future, for example after a clock change', () => {
    const stored = record({ changedAt: 50_000 });
    const result = resolveEnvironment({ ...base, stored, now: 10_000 });
    expect(result.rolled).toBe(true);
  });
});

describe('environmentFromStorageEvent', () => {
  it('reads the environment from a change to the shared key', () => {
    const raw = JSON.stringify(record({ timeOfDay: 'evening', weather: 'rain', changedAt: INTERVAL }));
    expect(environmentFromStorageEvent(ENVIRONMENT_STORAGE_KEY, raw)).toEqual({ timeOfDay: 'evening', weather: 'rain', cycle: { timeOfDay: true, weather: true } });
  });

  it('ignores other keys, removals, and malformed records', () => {
    const raw = JSON.stringify(record());
    expect(environmentFromStorageEvent('street-racer.save.v1', raw)).toBeNull();
    expect(environmentFromStorageEvent(ENVIRONMENT_STORAGE_KEY, null)).toBeNull();
    expect(environmentFromStorageEvent(ENVIRONMENT_STORAGE_KEY, '{"timeOfDay":"noon"}')).toBeNull();
  });
});

describe('startEnvironmentClock', () => {
  function fakeClock(startNow: number, storage: StorageLike | null) {
    let now = startNow;
    const applied: Array<{ timeOfDay: string; weather: string }> = [];
    const scheduled: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = [];
    const deps = {
      storage,
      now: () => now,
      random: () => 0.25,
      intervalMs: INTERVAL,
      schedule: (callback: () => void, delayMs: number) => {
        const entry = { callback, delayMs, cancelled: false };
        scheduled.push(entry);
        return entry;
      },
      cancel: (handle: unknown) => {
        (handle as { cancelled: boolean }).cancelled = true;
      },
      apply: (choice: { timeOfDay: string; weather: string }) => applied.push(choice),
    };
    return {
      deps,
      applied,
      scheduled,
      setNow: (value: number) => {
        now = value;
      },
    };
  }

  it('applies the environment at once and schedules the next change at the end of the interval', () => {
    const storage = memoryStorage();
    const clock = fakeClock(1_000, storage);
    const stop = startEnvironmentClock(clock.deps);
    expect(clock.applied).toEqual([{ timeOfDay: 'day', weather: 'clear', cycle: { timeOfDay: true, weather: true } }]);
    expect(clock.scheduled).toHaveLength(1);
    expect(clock.scheduled[0]!.delayMs).toBe(INTERVAL);
    stop();
    expect(clock.scheduled[0]!.cancelled).toBe(true);
  });

  it('rolls and saves a new environment each interval', () => {
    const storage = memoryStorage();
    const clock = fakeClock(0, storage);
    startEnvironmentClock(clock.deps);
    clock.setNow(INTERVAL);
    clock.scheduled[0]!.callback();
    expect(clock.applied).toHaveLength(2);
    expect(clock.applied[1]).not.toEqual(clock.applied[0]);
    expect(readEnvironmentRecord(storage)?.changedAt).toBe(INTERVAL);
    expect(clock.scheduled[1]!.delayMs).toBe(INTERVAL);
  });

  it('adopts a fresher record written by another page, without rolling again', () => {
    const storage = memoryStorage();
    const clock = fakeClock(0, storage);
    startEnvironmentClock(clock.deps);
    const other = record({ timeOfDay: 'night', weather: 'rain', changedAt: 30_000 });
    writeEnvironmentRecord(storage, other);
    clock.setNow(30_500);
    clock.scheduled[0]!.callback();
    const last = clock.applied[clock.applied.length - 1];
    expect(last).toEqual({ timeOfDay: 'night', weather: 'rain', cycle: { timeOfDay: true, weather: true } });
    expect(readEnvironmentRecord(storage)).toEqual(other);
    expect(clock.scheduled[1]!.delayMs).toBe(INTERVAL - 500);
  });

  it('applies the record that is stored when another page wrote over this one at the same interval', () => {
    const storage = memoryStorage();
    const clock = fakeClock(0, storage);
    startEnvironmentClock(clock.deps);
    const other = record({ timeOfDay: 'night', weather: 'rain', changedAt: INTERVAL });
    const realSet = storage.setItem;
    storage.setItem = (key, value) => {
      realSet(key, value);
      realSet(key, JSON.stringify(other));
    };
    clock.setNow(INTERVAL);
    clock.scheduled[0]!.callback();
    expect(clock.applied[clock.applied.length - 1]).toEqual({ timeOfDay: 'night', weather: 'rain', cycle: { timeOfDay: true, weather: true } });
    expect(clock.scheduled[1]!.delayMs).toBe(INTERVAL);
  });

  it('ignores a stored record older than the one this page wrote, so the schedule never lags', () => {
    const storage = memoryStorage();
    const clock = fakeClock(0, storage);
    startEnvironmentClock(clock.deps);
    // The write is refused: the stored record stays the old, expired one.
    storage.setItem = () => undefined;
    clock.setNow(INTERVAL);
    clock.scheduled[0]!.callback();
    expect(clock.applied).toHaveLength(2);
    expect(clock.scheduled[1]!.delayMs).toBe(INTERVAL);
  });

  it('keeps working with no storage, so the environment still changes', () => {
    const clock = fakeClock(0, null);
    startEnvironmentClock(clock.deps);
    clock.setNow(INTERVAL);
    clock.scheduled[0]!.callback();
    expect(clock.applied).toHaveLength(2);
  });

  it('does nothing after it is stopped', () => {
    const clock = fakeClock(0, null);
    const stop = startEnvironmentClock(clock.deps);
    stop();
    clock.scheduled[0]!.callback();
    expect(clock.applied).toHaveLength(1);
  });
});

describe('manual environment settings', () => {
  it('keeps a part set by hand when its interval expires, and rolls only the automatic part', () => {
    const stored = record({ timeOfDay: 'night', weather: 'clear', changedAt: 10_000, cycle: { timeOfDay: false, weather: true } });
    const result = resolveEnvironment({ stored, now: 10_000 + INTERVAL, random: () => 0.9, intervalMs: INTERVAL });
    expect(result.rolled).toBe(true);
    expect(result.record.timeOfDay).toBe('night');
    expect(result.record.weather).toBe('rain');
    expect(result.record.cycle).toEqual({ timeOfDay: false, weather: true });
  });

  it('keeps both parts when both are manual, and only renews the timestamp so the timer does not spin', () => {
    const stored = record({ timeOfDay: 'evening', weather: 'rain', changedAt: 10_000, cycle: { timeOfDay: false, weather: false } });
    const now = 10_000 + INTERVAL * 3;
    const result = resolveEnvironment({ stored, now, random: () => 0.1, intervalMs: INTERVAL });
    expect(result.record.timeOfDay).toBe('evening');
    expect(result.record.weather).toBe('rain');
    expect(result.record.changedAt).toBe(now);
  });

  it('reads a record written before cycle flags existed as fully automatic', () => {
    const legacy = JSON.stringify({ timeOfDay: 'day', weather: 'clear', changedAt: 5 });
    const parsed = parseEnvironmentRecord(legacy);
    expect(parsed).not.toBeNull();
    expect(cycleOf(parsed!)).toEqual({ timeOfDay: true, weather: true });
  });

  it('rejects a record whose cycle flags are not booleans', () => {
    const bad = JSON.stringify({ timeOfDay: 'day', weather: 'clear', changedAt: 5, cycle: { timeOfDay: 'yes', weather: true } });
    expect(parseEnvironmentRecord(bad)).toBeNull();
  });

  it('labels the cycle for the HUD', () => {
    expect(describeCycle({ timeOfDay: true, weather: true })).toBe('Auto');
    expect(describeCycle({ timeOfDay: false, weather: false })).toBe('Manual');
    expect(describeCycle({ timeOfDay: true, weather: false })).toBe('Auto time, manual weather');
    expect(describeCycle({ timeOfDay: false, weather: true })).toBe('Auto weather, manual time');
  });
});

