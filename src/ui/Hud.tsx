import type { MouseEvent } from 'react';
import type { GameAction } from '../input/keyBindings';
import { useAppStore } from '../state/appStore';
import type { DriveDirection } from '../simulation/vehicle';

const DEBUG_HINT = import.meta.env.DEV ? ' · ` debug panel' : '';
const DIRECTION_LABEL: Record<DriveDirection, string> = { drive: 'D', reverse: 'R', neutral: 'N' };

export interface HudProps {
  /** Routes HUD buttons through the same action path as the keyboard. */
  onAction: (action: GameAction) => void;
}

/**
 * Minimal in-game HUD: speed, drive direction, pause status, and the pause and reset controls.
 * Values come from the store, which the loop updates at about 10 Hz.
 */
export function Hud({ onAction }: HudProps) {
  const speedKph = useAppStore((state) => state.hud.speedKph);
  const direction = useAppStore((state) => state.hud.direction);
  const paused = useAppStore((state) => state.paused);

  // Buttons take focus on click. Blur them so Space and arrow keys still reach the driving controls.
  const press = (action: GameAction) => (event: MouseEvent<HTMLButtonElement>) => {
    onAction(action);
    event.currentTarget.blur();
  };

  return (
    <>
      <div className="hud">
        <div className="hud-speed" aria-label="Speed">
          {Math.round(speedKph)}
          <span className="hud-unit"> km/h</span>
        </div>
        <div className="hud-gear" aria-label="Drive direction">
          {DIRECTION_LABEL[direction]}
        </div>
        <div className="hud-hint">
          W / ↑ throttle · S / ↓ brake · A / D steer · Space handbrake · Esc pause · R reset{DEBUG_HINT}
        </div>
      </div>

      <div className="hud-controls">
        <span className={paused ? 'hud-status hud-status-paused' : 'hud-status'}>{paused ? 'PAUSED' : 'RUNNING'}</span>
        <button type="button" className="hud-button" onClick={press('pause')}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="hud-button" onClick={press('reset')}>
          Reset
        </button>
      </div>
    </>
  );
}
