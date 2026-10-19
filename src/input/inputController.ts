import type { InputState } from '../core/types';
import {
  actionForKeyCode,
  isHeldGameKeyCode,
  keysToInput,
  shouldPreventDefault,
  type GameAction,
} from './keyBindings';

/*
 * The single keyboard input system. It owns the only keyboard listeners in the app.
 *   - Held keys (driving) are tracked from keydown and keyup, and cleared on blur and tab hiding,
 *     so a missed keyup cannot leave a key stuck down.
 *   - Actions (pause, reset, debug panel) are queued once per press and consumed by the game loop.
 *   - Keystrokes aimed at form controls (buttons, inputs) are ignored, except Escape, so UI
 *     interaction cannot accidentally drive the car.
 * The controller holds no React state. The loop calls sample() and consumeActions() once per frame.
 */

const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);
const MAX_QUEUED_ACTIONS = 16;

/** True when a keystroke targets a control the user is typing into or activating. */
export function isFormControlTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (typeof element.tagName === 'string' && FORM_CONTROL_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }
  return element.isContentEditable === true;
}

export interface InputAttachOptions {
  /** Called when the page visibility changes. True means the tab is hidden. */
  readonly onVisibilityChange?: (hidden: boolean) => void;
}

export class InputController {
  private readonly heldCodes = new Set<string>();
  private queuedActions: GameAction[] = [];

  /**
   * Attaches listeners to the window (and, if provided, the document for visibility changes).
   * This is the app's only window and document listener set. `onVisibilityChange` receives the page visibility, so
   * other systems (the audio) can react without adding a second listener.
   * Returns a function that removes every listener and clears all state.
   */
  attach(view: EventTarget, doc?: EventTarget, options: InputAttachOptions = {}): () => void {
    const onKeyDown = (event: Event): void => this.handleKeyDown(event as KeyboardEvent);
    const onKeyUp = (event: Event): void => {
      this.heldCodes.delete((event as KeyboardEvent).code);
    };
    const onBlur = (): void => this.heldCodes.clear();
    const onVisibilityChange = (): void => {
      const hidden = (doc as Document | undefined)?.hidden === true;
      if (hidden) this.heldCodes.clear();
      options.onVisibilityChange?.(hidden);
    };

    view.addEventListener('keydown', onKeyDown);
    view.addEventListener('keyup', onKeyUp);
    view.addEventListener('blur', onBlur);
    doc?.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      view.removeEventListener('keydown', onKeyDown);
      view.removeEventListener('keyup', onKeyUp);
      view.removeEventListener('blur', onBlur);
      doc?.removeEventListener('visibilitychange', onVisibilityChange);
      this.heldCodes.clear();
      this.queuedActions = [];
    };
  }

  /** Queues an action from a UI control. It goes through the same path as a key press. */
  queueAction(action: GameAction): void {
    if (this.queuedActions.length < MAX_QUEUED_ACTIONS) this.queuedActions.push(action);
  }

  /** Returns the queued actions in order and clears the queue. Call once per frame. */
  consumeActions(): GameAction[] {
    const actions = this.queuedActions;
    this.queuedActions = [];
    return actions;
  }

  /** Current driver intent from the held keys. Call once per frame. */
  sample(): InputState {
    return keysToInput(this.heldCodes);
  }

  get pressedKeys(): string[] {
    return [...this.heldCodes].sort();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const code = event.code;
    const isEscape = actionForKeyCode(code) === 'pause';
    if (!isEscape && isFormControlTarget(event.target)) return;

    if (shouldPreventDefault(code)) event.preventDefault();
    if (isHeldGameKeyCode(code)) this.heldCodes.add(code);

    const action = actionForKeyCode(code, event.shiftKey);
    if (action && !event.repeat) this.queueAction(action);
  }
}
