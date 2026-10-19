import { useAppStore } from '../state/appStore';
import { useDiagnosticsStore, type DiagnosticError } from './diagnosticsStore';
import type { DiagnosticsSnapshot } from './snapshot';

/**
 * Development-only read access for browser tests. Installed only in DEV builds (see main.tsx),
 * so it never ships to production. It exposes read-only views of the stores.
 */

export interface StreetRacerDebugApi {
  getSnapshot(): DiagnosticsSnapshot | null;
  getErrors(): DiagnosticError[];
  getHud(): { speedKph: number; speedMph: number; direction: string; drifting: boolean };
  isPaused(): boolean;
  /** Race read access and staging (Part 6). Set by installRaceDebug while a race-enabled world is mounted. */
  race?: import('../race/raceDebug').RaceDebugApi;
  /** Police pursuit read access (Part 7). Set by installPursuitDebug while a city world is mounted. */
  pursuit?: import('../pursuit/pursuitDebug').PursuitDebugApi;
  /** Lighting, weather, quality, audio, and renderer read-out (Part 10). Installed by the PresentationProbe in DEV. */
  presentation?: () => import('./presentationDebug').PresentationReadout;
  /** Navigation route read-out (the goal, lane count, length, and end points). Installed while a world with lanes is mounted. */
  navigation?: { getRoute(): import('../navigation/navigationRuntime').NavigationReadout | null };
}

declare global {
  interface Window {
    __STREET_RACER_DEBUG__?: StreetRacerDebugApi;
  }
}

export function installDevHooks(target: Window): () => void {
  const api: StreetRacerDebugApi = {
    getSnapshot: () => useDiagnosticsStore.getState().snapshot,
    getErrors: () => useDiagnosticsStore.getState().errors,
    getHud: () => {
      const hud = useAppStore.getState().hud;
      return { speedKph: hud.speedKph, speedMph: hud.speedMph, direction: hud.direction, drifting: hud.drifting };
    },
    isPaused: () => useAppStore.getState().paused,
  };
  target.__STREET_RACER_DEBUG__ = api;
  return () => {
    delete target.__STREET_RACER_DEBUG__;
  };
}
