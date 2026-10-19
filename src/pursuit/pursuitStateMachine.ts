import type { PursuitState } from './pursuitTypes';

/*
 * The pursuit state machine (Part 7). The transition table is the only definition of legal moves. Anything not listed
 * is refused, and the refusal is counted, so a bad move is visible in diagnostics and tests rather than silent.
 *
 *   INACTIVE    -> DETECTION                                   (an offence in view of a patrol)
 *   DETECTION   -> INITIATING | INACTIVE                       (sight held | sight lost: nothing starts)
 *   INITIATING  -> PURSUING | INACTIVE                         (the response is ready | no unit could respond)
 *   PURSUING    -> ESCALATING | SEARCHING | BUSTED | INACTIVE   (more units wanted | sight lost | capture | reset)
 *   ESCALATING  -> PURSUING | SEARCHING | BUSTED | INACTIVE
 *   SEARCHING   -> PURSUING | ESCALATING | COOLDOWN | BUSTED | INACTIVE
 *   COOLDOWN    -> PURSUING | ESCALATING | INACTIVE           (sight again | cooldown elapsed | reset)
 *   BUSTED      -> INACTIVE                                   (the capture notice has been shown)
 */
const TRANSITIONS: Record<PursuitState, readonly PursuitState[]> = {
  INACTIVE: ['DETECTION'],
  DETECTION: ['INITIATING', 'INACTIVE'],
  INITIATING: ['PURSUING', 'INACTIVE'],
  PURSUING: ['ESCALATING', 'SEARCHING', 'BUSTED', 'INACTIVE'],
  ESCALATING: ['PURSUING', 'SEARCHING', 'BUSTED', 'INACTIVE'],
  SEARCHING: ['PURSUING', 'ESCALATING', 'COOLDOWN', 'BUSTED', 'INACTIVE'],
  COOLDOWN: ['PURSUING', 'ESCALATING', 'INACTIVE'],
  BUSTED: ['INACTIVE'],
};

export function canTransition(from: PursuitState, to: PursuitState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The states a pursuit session can be in. INACTIVE has no session. */
export function isSessionState(state: PursuitState): boolean {
  return state !== 'INACTIVE';
}

/** True while the pursuers are actively chasing or searching. Heat rises only in these states. */
export function isRunningState(state: PursuitState): boolean {
  return state === 'PURSUING' || state === 'ESCALATING' || state === 'SEARCHING';
}

/** The states in which units can be deployed and sight counts toward the pursuit. */
export function isEngagedState(state: PursuitState): boolean {
  return state === 'INITIATING' || state === 'PURSUING' || state === 'ESCALATING' || state === 'SEARCHING';
}

/** Every legal transition, as pairs. Used by tests to check the table covers what the session does. */
export function allTransitions(): Array<[PursuitState, PursuitState]> {
  const pairs: Array<[PursuitState, PursuitState]> = [];
  for (const from of Object.keys(TRANSITIONS) as PursuitState[]) {
    for (const to of TRANSITIONS[from]) pairs.push([from, to]);
  }
  return pairs;
}
