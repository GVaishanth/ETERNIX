/**
 * The controls listed in the Info panel, in the game HUD and on the ETERNIX front page. This is text only: the keys
 * are bound in keyBindings.ts. When a binding changes, change its row here too.
 */

export interface ControlHelpRow {
  readonly keys: string;
  readonly label: string;
}

export interface ControlHelpGroup {
  readonly title: string;
  readonly rows: readonly ControlHelpRow[];
}

export const CONTROL_HELP: readonly ControlHelpGroup[] = [
  {
    title: 'Drive',
    rows: [
      { keys: 'W / ↑', label: 'throttle' },
      { keys: 'S / ↓', label: 'brake' },
      { keys: 'A / D', label: 'steer' },
      { keys: 'Space', label: 'handbrake' },
    ],
  },
  {
    title: 'Game',
    rows: [
      { keys: 'Esc', label: 'pause' },
      { keys: 'R', label: 'reset' },
      { keys: 'E', label: 'confirm race' },
      { keys: 'Q', label: 'cancel race' },
      { keys: 'V', label: 'garage' },
      { keys: 'C', label: 'career' },
      { keys: 'N', label: 'time of day' },
      { keys: 'M', label: 'weather' },
      { keys: 'L', label: 'auto cycle' },
      { keys: 'U', label: 'quality' },
    ],
  },
];
