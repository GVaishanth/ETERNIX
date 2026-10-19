/**
 * When the "Press C to start career mode" prompt shows. Pure, so it is tested without the HUD.
 *
 * The prompt shows while the career has not started, the career hub is closed (the hub is where the career starts),
 * and the player has not dismissed it in this session.
 */
export interface CareerPromptInput {
  /** The career has been started (the hub's Start career). */
  readonly started: boolean;
  /** The career hub is open. The prompt steps aside while it is. */
  readonly hubOpen: boolean;
  /** The player closed the prompt this session. */
  readonly dismissed: boolean;
}

export function careerPromptVisible(input: CareerPromptInput): boolean {
  return !input.started && !input.hubOpen && !input.dismissed;
}
