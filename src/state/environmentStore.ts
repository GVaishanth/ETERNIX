import { create } from 'zustand';
import { TIME_OF_DAY_PRESETS, WEATHER_PRESETS, type TimeOfDayId, type WeatherId } from '../config/environmentConfig';
import { nextTimeOfDay, nextWeather } from '../environment/environmentModel';
import { browserStorage } from '../save/saveFile';
import {
  AUTOMATIC_CYCLE,
  ENVIRONMENT_INTERVAL_MS,
  cycleOf,
  environmentFromStorageEvent,
  readEnvironmentRecord,
  resolveEnvironment,
  startEnvironmentClock,
  writeEnvironmentRecord,
  type EnvironmentCycle,
  type EnvironmentView,
} from './environmentClock';

/**
 * The target time of day and weather, and which parts follow the automatic cycle. The Environment component blends the
 * live values toward these, a little each frame. The interval clock changes only the parts on automatic cycle. A part
 * the player sets by hand (N, M, or a setter) is manual: it stays fixed until the player changes it again or turns the
 * automatic cycle back on (L). Every change is saved, so the home page and the game agree. UI and input never write the
 * live lighting values.
 */
interface EnvironmentState {
  readonly timeOfDay: TimeOfDayId;
  readonly weather: WeatherId;
  readonly cycle: EnvironmentCycle;
  setTimeOfDay: (id: TimeOfDayId) => void;
  setWeather: (id: WeatherId) => void;
  cycleTimeOfDay: () => void;
  cycleWeather: () => void;
  /** Turns the automatic cycle on for both parts, or off for both (both parts become manual at their current values). */
  toggleAutomatic: () => void;
}

/**
 * The environment at page load. It uses the saved record if it is still inside its interval, so the game and the home
 * page agree. Otherwise it starts at day and clear. Reading only: the clock writes.
 */
function initialEnvironment(): EnvironmentView {
  const { record } = resolveEnvironment({
    stored: readEnvironmentRecord(browserStorage()),
    now: Date.now(),
    random: Math.random,
    intervalMs: ENVIRONMENT_INTERVAL_MS,
  });
  return { timeOfDay: record.timeOfDay, weather: record.weather, cycle: cycleOf(record) };
}

/**
 * Saves the current targets and cycle flags. The timestamp of the last change is kept, so a manual change does not
 * restart the interval. A missing record starts one. A storage that refuses the write is ignored, as elsewhere.
 */
function persist(view: EnvironmentView): void {
  const storage = browserStorage();
  const stored = readEnvironmentRecord(storage);
  writeEnvironmentRecord(storage, {
    timeOfDay: view.timeOfDay,
    weather: view.weather,
    changedAt: stored?.changedAt ?? Date.now(),
    cycle: view.cycle,
  });
}

export const useEnvironmentStore = create<EnvironmentState>()((set, get) => {
  const apply = (patch: Partial<EnvironmentView>): void => {
    set(patch);
    const { timeOfDay, weather, cycle } = get();
    persist({ timeOfDay, weather, cycle });
  };
  const setManual = (part: keyof EnvironmentCycle, patch: Partial<EnvironmentView>): void => {
    apply({ ...patch, cycle: { ...get().cycle, [part]: false } });
  };
  return {
    ...initialEnvironment(),
    setTimeOfDay: (id) => {
      if (TIME_OF_DAY_PRESETS[id]) setManual('timeOfDay', { timeOfDay: id });
    },
    setWeather: (id) => {
      if (WEATHER_PRESETS[id]) setManual('weather', { weather: id });
    },
    cycleTimeOfDay: () => setManual('timeOfDay', { timeOfDay: nextTimeOfDay(get().timeOfDay) }),
    cycleWeather: () => setManual('weather', { weather: nextWeather(get().weather) }),
    toggleAutomatic: () => {
      const { cycle } = get();
      const allAutomatic = cycle.timeOfDay && cycle.weather;
      apply({ cycle: allAutomatic ? { timeOfDay: false, weather: false } : AUTOMATIC_CYCLE });
    },
  };
});

let stopClock: (() => void) | null = null;

/**
 * Starts the interval clock. It changes the parts on automatic cycle, once every ENVIRONMENT_CHANGE_SECONDS. Both pages
 * call it at startup. Calling it again while it runs does nothing. Returns a function that stops it.
 */
export function startEnvironmentChanges(): () => void {
  if (stopClock === null) {
    // Another page's change arrives as a storage event; apply it at once.
    const onStorage = (event: StorageEvent): void => {
      const view = environmentFromStorageEvent(event.key, event.newValue);
      if (view) useEnvironmentStore.setState(view);
    };
    window.addEventListener('storage', onStorage);
    const stopTimer = startEnvironmentClock({
      storage: browserStorage(),
      now: () => Date.now(),
      random: Math.random,
      intervalMs: ENVIRONMENT_INTERVAL_MS,
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (handle) => window.clearTimeout(handle as number),
      apply: (view) => useEnvironmentStore.setState(view),
    });
    stopClock = () => {
      stopTimer();
      window.removeEventListener('storage', onStorage);
    };
  }
  return () => {
    stopClock?.();
    stopClock = null;
  };
}
