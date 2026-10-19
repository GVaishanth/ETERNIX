import { create } from 'zustand';

/**
 * Career hub UI state: whether the hub is open, which tab it shows, and which rival's challenge is being read. The
 * hub changes no career progress. Accepting a challenge, or any progress change, goes through the career service.
 */
export type CareerTab = 'events' | 'leaderboard' | 'milestones';

interface CareerUiState {
  readonly open: boolean;
  readonly tab: CareerTab;
  /** The rival whose challenge card is open on the leaderboard, or null. */
  readonly selectedRivalId: string | null;
  show: () => void;
  close: () => void;
  setTab: (tab: CareerTab) => void;
  selectRival: (rivalId: string | null) => void;
}

export const useCareerUiStore = create<CareerUiState>()((set) => ({
  open: false,
  tab: 'events',
  selectedRivalId: null,
  show: () => set({ open: true }),
  close: () => set({ open: false, selectedRivalId: null }),
  setTab: (tab) => set({ tab, selectedRivalId: null }),
  selectRival: (rivalId) => set({ selectedRivalId: rivalId }),
}));
