/*
 * The career hub's entry rule (Part 9). The hub pauses the car, so it may not open while a race is running or a pursuit
 * is on. Opening the hub never changes progress, so the rule is only about the car and the race. It is pure, so the
 * render loop, the launcher, and the tests read the same answer.
 */
import type { RaceState } from '../race/raceTypes';
import type { PursuitState } from '../pursuit/pursuitTypes';

export interface CareerHubGateInput {
  readonly racePhase: RaceState;
  readonly pursuitState: PursuitState;
}

export type CareerHubDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export function evaluateCareerHubGate(input: CareerHubGateInput): CareerHubDecision {
  if (input.pursuitState !== 'INACTIVE') return { allowed: false, reason: 'The police are after you. Lose them before opening the career hub.' };
  if (input.racePhase === 'COUNTDOWN' || input.racePhase === 'RACING' || input.racePhase === 'PAUSED') {
    return { allowed: false, reason: 'Finish or abort the race before opening the career hub.' };
  }
  return { allowed: true };
}
