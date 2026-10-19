import { create } from 'zustand';
import type { DiagnosticsSnapshot } from './snapshot';

/** Development-only diagnostics state. Production builds never write to this store. */

export interface DiagnosticError {
  id: number;
  timestampMs: number;
  source: string;
  message: string;
}

export const MAX_DIAGNOSTIC_ERRORS = 20;

interface DiagnosticsState {
  snapshot: DiagnosticsSnapshot | null;
  errors: DiagnosticError[];
  panelVisible: boolean;
  /** Road debug overlay (centrelines, boundaries, ports, ids). Development only. */
  roadDebug: boolean;
  setSnapshot: (snapshot: DiagnosticsSnapshot) => void;
  pushError: (source: string, message: string) => void;
  togglePanel: () => void;
  toggleRoadDebug: () => void;
}

let nextErrorId = 1;

export const useDiagnosticsStore = create<DiagnosticsState>()((set) => ({
  snapshot: null,
  errors: [],
  panelVisible: false,
  roadDebug: false,
  setSnapshot: (snapshot) => set({ snapshot }),
  pushError: (source, message) =>
    set((state) => {
      const entry: DiagnosticError = { id: nextErrorId++, timestampMs: Date.now(), source, message };
      return { errors: [entry, ...state.errors].slice(0, MAX_DIAGNOSTIC_ERRORS) };
    }),
  togglePanel: () => set((state) => ({ panelVisible: !state.panelVisible })),
  toggleRoadDebug: () => set((state) => ({ roadDebug: !state.roadDebug })),
}));
