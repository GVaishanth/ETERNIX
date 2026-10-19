import { create } from 'zustand';

/**
 * One question the player must answer before an action runs: leaving the game, or a purchase. While a request is open
 * the render loop pauses the car, the same way it does for the garage and the career hub.
 */
export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Runs once, only when the player confirms. Cancelling, Escape, or a new request never runs it. */
  readonly onConfirm: () => void;
}

interface ConfirmUiState {
  readonly request: ConfirmRequest | null;
  ask: (request: ConfirmRequest) => void;
  answer: (confirmed: boolean) => void;
}

export const useConfirmUiStore = create<ConfirmUiState>()((set, get) => ({
  request: null,
  ask: (request) => set({ request }),
  answer: (confirmed) => {
    const current = get().request;
    set({ request: null });
    if (confirmed && current !== null) current.onConfirm();
  },
}));
