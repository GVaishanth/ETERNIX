import type { RaceState } from './raceTypes';

/*
 * The race state machine (Part 6). A table of allowed transitions, plus a guard for each attempt. Pure, so every
 * transition can be tested without the game running. An attempted illegal transition is refused and counted by the
 * caller. It is never forced, and it never throws.
 *
 *   FREE_ROAM      -> EVENT_APPROACH   player enters an event's approach radius
 *   EVENT_APPROACH -> FREE_ROAM        player leaves the radius, or dismisses the card
 *   EVENT_APPROACH -> COUNTDOWN        player starts the event (grid is assigned, countdown begins)
 *   COUNTDOWN      -> RACING           GO (the timer starts here)
 *   COUNTDOWN      -> FREE_ROAM        cancel before GO. Nothing is granted.
 *   RACING         -> FINISHED         the final gate is passed in order
 *   RACING         -> FAILED           abort, or the time limit
 *   COUNTDOWN, RACING -> PAUSED        the app is paused
 *   PAUSED         -> COUNTDOWN | RACING   resume, to the state that was paused
 *   FINISHED, FAILED -> COUNTDOWN      retry (a new attempt)
 *   FINISHED, FAILED -> FREE_ROAM      leave the results
 */
const ALLOWED: Readonly<Record<RaceState, readonly RaceState[]>> = {
  FREE_ROAM: ['EVENT_APPROACH'],
  EVENT_APPROACH: ['FREE_ROAM', 'COUNTDOWN'],
  COUNTDOWN: ['RACING', 'FREE_ROAM', 'PAUSED'],
  RACING: ['FINISHED', 'FAILED', 'PAUSED'],
  FINISHED: ['COUNTDOWN', 'FREE_ROAM'],
  FAILED: ['COUNTDOWN', 'FREE_ROAM'],
  // PAUSED returns to whichever state was paused. The caller records that state, so both are allowed here.
  PAUSED: ['COUNTDOWN', 'RACING'],
};

export function canTransition(from: RaceState, to: RaceState): boolean {
  return ALLOWED[from].includes(to);
}

/** States in which a race is in progress, so a second start, a new marker, or a DEV reset must wait. */
export function isRaceActive(state: RaceState): boolean {
  return state === 'COUNTDOWN' || state === 'RACING' || state === 'PAUSED';
}

/** States in which the player's car is held by the grid (the countdown only). */
export function isHeldOnGrid(state: RaceState): boolean {
  return state === 'COUNTDOWN';
}
