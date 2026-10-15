import { create } from 'zustand';
import type { AppStatus } from '../core/types';
import type { DriveDirection } from '../simulation/vehicle';

/**
 * Low-frequency shared application state. Per-frame simulation values never go here.
 * The loop publishes HUD values at about 10 Hz, which is cheap enough for React.
 * `paused` is the single source of pause status. The loop reads it, and the HUD displays it.
 */
export interface HudState {
  /** Unsigned speed in km/h, converted through metersPerSecondToKph. */
  speedKph: number;
  /** Unsigned speed in mph, converted through metersPerSecondToMph. */
  speedMph: number;
  /** Unsigned speed as a fraction of the forward top speed, 0..1. Drives the gauge. */
  speedFraction: number;
  direction: DriveDirection;
  /** True while the car is sliding beyond the drift threshold. */
  drifting: boolean;
}

interface AppState {
  status: AppStatus;
  paused: boolean;
  hud: HudState;
  setStatus: (status: AppStatus) => void;
  togglePause: () => void;
  setHud: (hud: HudState) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  status: 'booting',
  paused: false,
  hud: { speedKph: 0, speedMph: 0, speedFraction: 0, direction: 'neutral', drifting: false },
  setStatus: (status) => set({ status }),
  togglePause: () => set((state) => ({ paused: !state.paused })),
  setHud: (hud) => set({ hud }),
}));
