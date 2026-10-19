/*
 * Automated tests for the environment target store (Part 10): the N and M cycles change only the target, and an unknown
 * id is ignored. The live lighting values are never written by the store.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { useEnvironmentStore } from './environmentStore';
import { AUTOMATIC_CYCLE, ENVIRONMENT_STORAGE_KEY, parseEnvironmentRecord } from './environmentClock';

/** A fake window.localStorage for the store, so the tests can read back what was saved. */
function installFakeStorage(): Map<string, string> {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
  return data;
}

beforeEach(() => {
  useEnvironmentStore.setState({ timeOfDay: 'day', weather: 'clear', cycle: AUTOMATIC_CYCLE });
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('environment targets', () => {
  it('starts at day and clear weather', () => {
    const state = useEnvironmentStore.getState();
    expect(state.timeOfDay).toBe('day');
    expect(state.weather).toBe('clear');
  });

  it('cycles time of day through the N action and back to the start', () => {
    const { cycleTimeOfDay } = useEnvironmentStore.getState();
    cycleTimeOfDay();
    expect(useEnvironmentStore.getState().timeOfDay).toBe('evening');
    cycleTimeOfDay();
    expect(useEnvironmentStore.getState().timeOfDay).toBe('night');
    cycleTimeOfDay();
    expect(useEnvironmentStore.getState().timeOfDay).toBe('day');
  });

  it('toggles weather through the M action', () => {
    useEnvironmentStore.getState().cycleWeather();
    expect(useEnvironmentStore.getState().weather).toBe('rain');
    useEnvironmentStore.getState().cycleWeather();
    expect(useEnvironmentStore.getState().weather).toBe('clear');
  });

  it('ignores an unknown id from a setter', () => {
    useEnvironmentStore.getState().setTimeOfDay('noon' as never);
    useEnvironmentStore.getState().setWeather('snow' as never);
    expect(useEnvironmentStore.getState().timeOfDay).toBe('day');
    expect(useEnvironmentStore.getState().weather).toBe('clear');
  });
});

describe('manual environment settings', () => {
  it('a hand change turns off the automatic cycle for that part only', () => {
    useEnvironmentStore.getState().cycleTimeOfDay();
    expect(useEnvironmentStore.getState().cycle).toEqual({ timeOfDay: false, weather: true });
    useEnvironmentStore.getState().cycleWeather();
    expect(useEnvironmentStore.getState().cycle).toEqual({ timeOfDay: false, weather: false });
  });

  it('saves a hand change with its cycle flags, and keeps the original interval start', () => {
    const data = installFakeStorage();
    data.set(ENVIRONMENT_STORAGE_KEY, JSON.stringify({ timeOfDay: 'day', weather: 'clear', changedAt: 1234 }));
    useEnvironmentStore.getState().setWeather('rain');
    const saved = parseEnvironmentRecord(data.get(ENVIRONMENT_STORAGE_KEY) ?? null);
    expect(saved).toMatchObject({ timeOfDay: 'day', weather: 'rain', changedAt: 1234, cycle: { timeOfDay: true, weather: false } });
  });

  it('toggles automatic on for both parts, and off for both (freezing the current values)', () => {
    const { toggleAutomatic } = useEnvironmentStore.getState();
    toggleAutomatic();
    expect(useEnvironmentStore.getState().cycle).toEqual({ timeOfDay: false, weather: false });
    useEnvironmentStore.getState().toggleAutomatic();
    expect(useEnvironmentStore.getState().cycle).toEqual({ timeOfDay: true, weather: true });
  });

  it('ignores an unknown id and does not change the cycle flags', () => {
    useEnvironmentStore.getState().setTimeOfDay('noon' as never);
    expect(useEnvironmentStore.getState().cycle).toEqual(AUTOMATIC_CYCLE);
  });
});

