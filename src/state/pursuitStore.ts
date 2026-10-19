import { create } from 'zustand';
import { EMPTY_PURSUIT_SNAPSHOT, type PursuitSnapshot } from '../pursuit/pursuitTypes';

/*
 * Pursuit state for the HUD (Part 7). Written by the pursuit controller at about 10 Hz, from the authoritative session.
 * The simulation never reads it. Plain values only.
 */

/** The busted result, shown once after the reset. The id changes with each bust, so the HUD can key its timer on it. */
export interface BustNotice {
  id: number;
  text: string;
}

export interface PursuitStoreState {
  snapshot: PursuitSnapshot;
  /** The newest bust, or null before any. Set once per bust, when the car is sent back to the spawn. */
  bust: BustNotice | null;
  setSnapshot: (snapshot: PursuitSnapshot) => void;
  showBust: (text: string) => void;
}

export const usePursuitStore = create<PursuitStoreState>()((set) => ({
  snapshot: EMPTY_PURSUIT_SNAPSHOT,
  bust: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  showBust: (text) => set((state) => ({ bust: { id: (state.bust?.id ?? 0) + 1, text } })),
}));
