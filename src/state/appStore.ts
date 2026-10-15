import { create } from 'zustand';
import type { AppStatus } from '../core/types';
import type { DriveDirection } from '../simulation/vehicle';

/**
 * Low-frequency shared application state. Per-frame simulation values never go here.
 * The loop publishes HUD values at about 10 Hz, which is cheap enough for React.
 * `paused` is the single source of pause status. The loop reads it, and the HUD displays it.
 */
export interface HudState {
  speedKph: number;
  direction: DriveDirection;
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
  hud: { speedKph: 0, direction: 'neutral' },
  setStatus: (status) => set({ status }),
  togglePause: () => set((state) => ({ paused: !state.paused })),
  setHud: (hud) => set({ hud }),
}));
