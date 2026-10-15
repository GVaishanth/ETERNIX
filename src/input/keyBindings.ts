import type { InputState } from '../core/types';

/**
 * Key bindings use KeyboardEvent.code (physical key position), so the layout of the keyboard does not matter.
 * Held keys drive the vehicle every frame. Action keys fire once per press.
 */
export const KEY_BINDINGS = {
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  handbrake: ['Space'],
} as const;

/** `roadDebug` and `overview` are development views. The loop ignores them in production builds. */
export type GameAction = 'pause' | 'reset' | 'debugPanel' | 'roadDebug' | 'overview';

export const ACTION_BINDINGS: Readonly<Record<GameAction, readonly string[]>> = {
  pause: ['Escape'],
  reset: ['KeyR'],
  debugPanel: ['Backquote'],
  roadDebug: ['KeyG'],
  overview: ['KeyO'],
};

/** Keys that would otherwise scroll the page or activate focused controls while driving. */
const PREVENT_DEFAULT_CODES: ReadonlySet<string> = new Set([
  ...KEY_BINDINGS.steerLeft,
  ...KEY_BINDINGS.steerRight,
  ...KEY_BINDINGS.throttle,
  ...KEY_BINDINGS.brake,
  ...KEY_BINDINGS.handbrake,
]);

const HELD_GAME_CODES: ReadonlySet<string> = new Set(
  [
    ...KEY_BINDINGS.steerLeft,
    ...KEY_BINDINGS.steerRight,
    ...KEY_BINDINGS.throttle,
    ...KEY_BINDINGS.brake,
    ...KEY_BINDINGS.handbrake,
  ],
);

export function isHeldGameKeyCode(code: string): boolean {
  return HELD_GAME_CODES.has(code);
}

export function shouldPreventDefault(code: string): boolean {
  return PREVENT_DEFAULT_CODES.has(code);
}

/** Returns the action bound to a key, if any. */
export function actionForKeyCode(code: string): GameAction | null {
  for (const action of Object.keys(ACTION_BINDINGS) as GameAction[]) {
    if (ACTION_BINDINGS[action].includes(code)) return action;
  }
  return null;
}

function anyPressed(pressed: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((code) => pressed.has(code));
}

/** Pure mapping from the set of held key codes to a driver-intent snapshot. */
export function keysToInput(pressed: ReadonlySet<string>): InputState {
  const left = anyPressed(pressed, KEY_BINDINGS.steerLeft);
  const right = anyPressed(pressed, KEY_BINDINGS.steerRight);
  return {
    steer: (right ? 1 : 0) - (left ? 1 : 0),
    throttle: anyPressed(pressed, KEY_BINDINGS.throttle) ? 1 : 0,
    brake: anyPressed(pressed, KEY_BINDINGS.brake) ? 1 : 0,
    handbrake: anyPressed(pressed, KEY_BINDINGS.handbrake) ? 1 : 0,
  };
}
