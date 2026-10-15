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
