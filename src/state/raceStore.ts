import { create } from 'zustand';
import type { RaceEndReason, RaceState } from '../race/raceTypes';

/*
 * Race state for the HUD (Part 6). Written by the race controller at about 10 Hz from the authoritative race state. The
 * simulation never reads it. Plain values only, so it causes no per-frame React work.
 */

export interface RaceApproachInfo {
  eventId: string;
  name: string;
  summary: string;
  difficulty: 1 | 2 | 3;
  laps: number;
  checkpointCount: number;
  opponentCount: number;
  timeLimitSeconds: number | null;
  rewardCredits: number;
  /** Why this race cannot start now (for example, the police are after the player), or null when it can start. */
  blocked: string | null;
}

export interface RaceResultInfo {
  outcome: RaceEndReason;
  place: number | null;
  totalRacers: number;
  finishSeconds: number | null;
  lapSeconds: number[];
  /** Provisional credits granted for this attempt. Session only: nothing is saved. */
  rewardCredits: number | null;
  /** Standings at the end, top rows first. */
  standings: { position: number; name: string; finished: boolean; isPlayer: boolean }[];
}

export interface RaceSnapshot {
  phase: RaceState;
  approach: RaceApproachInfo | null;
  /** Whole seconds until GO, shown as 3, 2, 1. Null outside the countdown. */
  countdown: number | null;
  goVisible: boolean;
  raceSeconds: number;
  timeLimitSeconds: number | null;
  /** Label of the next gate the player must reach, or null. */
  nextGate: string | null;
  lap: number;
  laps: number;
  place: number | null;
  totalRacers: number;
  /** Most recent notices, oldest first. */
  notices: string[];
  result: RaceResultInfo | null;
  /** Session total of provisional credits. */
  sessionCredits: number;
  /** Set when an action was refused (for example, reset during a race). Cleared on the next publish. */
  refusal: string | null;
  /** DEV trace of the player's progress: gates, relocations, route distance. Null outside a race. */
  playerTrace: {
    gatesPassed: number;
    relocations: number;
    relocationsHeld: number;
    lastRelocationSeconds: number | null;
    routeD: number;
    onRoute: boolean;
  } | null;
}

export const EMPTY_RACE_SNAPSHOT: RaceSnapshot = {
  phase: 'FREE_ROAM',
  approach: null,
  countdown: null,
  goVisible: false,
  raceSeconds: 0,
  timeLimitSeconds: null,
  nextGate: null,
  lap: 0,
  laps: 0,
  place: null,
  totalRacers: 0,
  notices: [],
  result: null,
  sessionCredits: 0,
  refusal: null,
  playerTrace: null,
};

interface RaceStoreState {
  snapshot: RaceSnapshot;
  setSnapshot: (snapshot: RaceSnapshot) => void;
}

export const useRaceStore = create<RaceStoreState>()((set) => ({
  snapshot: EMPTY_RACE_SNAPSHOT,
  setSnapshot: (snapshot) => set({ snapshot }),
}));
