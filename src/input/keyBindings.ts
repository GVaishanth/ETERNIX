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

/** `roadDebug`, `overview`, `trafficReset`, and `devReset` are development views and tools. The loop ignores them in production builds. */
/** `raceConfirm` (E) and `raceCancel` (Q) act on the race in progress, or on the event marker nearby. See RaceController. */
/** `garage` (V) opens or closes the garage at the city entrance. It is refused during a race or a pursuit (garageGate.ts). */
export type GameAction = 'pause' | 'reset' | 'debugPanel' | 'roadDebug' | 'overview' | 'trafficReset' | 'devReset' | 'raceConfirm' | 'raceCancel' | 'garage' | 'career' | 'timeOfDay' | 'weather' | 'quality' | 'environmentAuto';

export const ACTION_BINDINGS: Readonly<Record<GameAction, readonly string[]>> = {
  pause: ['Escape'],
  reset: ['KeyR'],
  debugPanel: ['Backquote'],
  roadDebug: ['KeyG'],
  overview: ['KeyO'],
  trafficReset: ['KeyT'],
  devReset: ['KeyY'],
  raceConfirm: ['KeyE'],
  raceCancel: ['KeyQ'],
  garage: ['KeyV'],
  career: ['KeyC'],
  timeOfDay: ['KeyN'],
  weather: ['KeyM'],
  quality: ['KeyU'],
  environmentAuto: ['KeyL'],
};

/** Actions that need Shift held too. Shift + ` opens the diagnostics panel, in every build. Plain ` does nothing. */
const SHIFT_REQUIRED_ACTIONS: ReadonlySet<GameAction> = new Set<GameAction>(['debugPanel']);

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

/** Returns the action bound to a key, if any. Shift-only actions need shiftKey. */
export function actionForKeyCode(code: string, shiftKey = false): GameAction | null {
  for (const action of Object.keys(ACTION_BINDINGS) as GameAction[]) {
    if (!ACTION_BINDINGS[action].includes(code)) continue;
    if (SHIFT_REQUIRED_ACTIONS.has(action) && !shiftKey) continue;
    return action;
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
