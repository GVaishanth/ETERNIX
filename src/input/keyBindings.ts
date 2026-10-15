import type { InputState } from '../core/types';

/**
 * Key bindings use KeyboardEvent.code (physical key position), so WASD stays on the same
 * physical keys regardless of keyboard layout.
 */
export const KEY_BINDINGS = {
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
} as const;

const ALL_GAME_CODES: ReadonlySet<string> = new Set<string>(
  Object.values(KEY_BINDINGS).flat(),
);

export function isGameKeyCode(code: string): boolean {
  return ALL_GAME_CODES.has(code);
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
  };
}
