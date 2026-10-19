import { create } from 'zustand';

/**
 * Garage UI state: whether the garage is open and which vehicle it is showing. The entry reason is not stored here:
 * the launcher reads it from the entry rule. Purchases and selection are NOT here. Those live in the garage service.
 */
interface GarageUiState {
  readonly open: boolean;
  /** Vehicle shown in the garage list and preview. Changes only when browsing. Does not change the active car. */
  readonly focusVehicleId: string | null;
  show: () => void;
  close: () => void;
  focus: (vehicleId: string) => void;
}

export const useGarageUiStore = create<GarageUiState>()((set) => ({
  open: false,
  focusVehicleId: null,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
  focus: (vehicleId) => set({ focusVehicleId: vehicleId }),
}));
