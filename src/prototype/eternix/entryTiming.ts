/*
 * When the loading page may give way to the game. Pure, so it is tested. The game runs behind the loading page from the
 * moment ENTER GAME is pressed. The page reveals the game only when all three hold: the readiness steps finished
 * successfully, the game has mounted behind the page, and the minimum hold has passed.
 */
import type { ReadinessOutcome } from './readiness';

export interface RevealInput {
  /** The result of the readiness steps, or null while they still run. */
  readonly outcome: ReadinessOutcome | null;
  /** True once the game's first frame has mounted behind the loading page. */
  readonly gameReady: boolean;
  /** True once the minimum hold (C.handoffLoadSeconds) has passed. */
  readonly holdDone: boolean;
  /** True once every loading bar has completed (each in turn, after its real step). */
  readonly barsDone: boolean;
}

export function canReveal(input: RevealInput): boolean {
  return input.outcome === 'ready' && input.gameReady && input.holdDone && input.barsDone;
}

export interface ReturnInput {
  /** True once the minimum hold on the loading page has passed. */
  readonly holdDone: boolean;
  /** True once the front page's canvas is drawn behind the loading page. */
  readonly homeReady: boolean;
}

/** The front page may take over from the game once the loading page has held and the front page is drawn. */
export function canReturn(input: ReturnInput): boolean {
  return input.holdDone && input.homeReady;
}
