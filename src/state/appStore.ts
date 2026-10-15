import { create } from 'zustand';
import type { AppStatus } from '../core/types';

/**
 * Low-frequency shared application state. Per-frame simulation values never go here.
 * The loop publishes the HUD speed at about 10 Hz, which is cheap enough for React.
 */
interface AppState {
  status: AppStatus;
  hudSpeedKph: number;
  setStatus: (status: AppStatus) => void;
  setHudSpeedKph: (speedKph: number) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  status: 'booting',
  hudSpeedKph: 0,
  setStatus: (status) => set({ status }),
  setHudSpeedKph: (hudSpeedKph) => set({ hudSpeedKph }),
}));
