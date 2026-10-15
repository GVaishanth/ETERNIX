import type { InputState } from '../core/types';
import { isGameKeyCode, keysToInput } from './keyBindings';

/**
 * Tracks held game keys from DOM events. It does not hold React state and is never read
 * by React rendering. The game loop calls sample() once per frame.
 */
export class InputController {
  private readonly pressedCodes = new Set<string>();

  /** Attaches listeners to `target`. Returns a detach function that removes them. */
  attach(target: Window): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isGameKeyCode(event.code)) return;
      // Prevent arrow keys from scrolling the page while driving.
      event.preventDefault();
      this.pressedCodes.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      this.pressedCodes.delete(event.code);
    };
    // Losing focus leaves keys stuck down unless the set is cleared.
    const onBlur = (): void => {
      this.pressedCodes.clear();
    };

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);

    return () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      this.pressedCodes.clear();
    };
  }

  sample(): InputState {
    return keysToInput(this.pressedCodes);
  }

  get pressedKeys(): string[] {
    return [...this.pressedCodes].sort();
  }
}
