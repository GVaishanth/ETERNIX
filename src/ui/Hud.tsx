import type { MouseEvent } from 'react';
import type { GameAction } from '../input/keyBindings';
import type { DriveDirection } from '../simulation/vehicle';
import { useAppStore } from '../state/appStore';
import { useConfirmUiStore } from '../state/confirmUiStore';
import { ControlsInfo } from './ControlsInfo';

const DIRECTION_LABEL: Record<DriveDirection, string> = { drive: 'D', reverse: 'R', neutral: 'N' };
/** A 240-degree arc, from lower-left, clockwise over the top, to lower-right. */
const GAUGE_ARC_PATH = 'M 16.7 85 A 50 50 0 1 1 103.3 85';

export interface HudProps {
  /** Routes HUD buttons through the same action path as the keyboard. */
  onAction: (action: GameAction) => void;
  /** Leaves the game in-page (the embedded game). Without it, Leave opens the front page as a page. */
  onLeave?: () => void;
}

/**
 * Minimal in-game HUD. Every value is real telemetry from the authoritative simulation, published at about 10 Hz:
 * speed (km/h and mph), an arc gauge scaled to the forward top speed, drive direction (D / R / N), and a DRIFT badge.
 * No RPM and no gear are shown, because the model does not simulate them.
 */
export function Hud({ onAction, onLeave }: HudProps) {
  const speedKph = useAppStore((state) => state.hud.speedKph);
  const speedMph = useAppStore((state) => state.hud.speedMph);
  const speedFraction = useAppStore((state) => state.hud.speedFraction);
  const direction = useAppStore((state) => state.hud.direction);
  const drifting = useAppStore((state) => state.hud.drifting);
  const paused = useAppStore((state) => state.paused);

  // Buttons take focus on click. Blur them so Space and arrow keys still reach the driving controls.
  const press = (action: GameAction) => (event: MouseEvent<HTMLButtonElement>) => {
    onAction(action);
    event.currentTarget.blur();
  };

  const gaugeValue = Math.min(Math.max(speedFraction, 0), 1) * 100;

  const askLeave = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    useConfirmUiStore.getState().ask({
      title: 'Leave the game?',
      message: 'Do you really want to leave? Your current drive is not saved.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      onConfirm: () => {
        if (onLeave) onLeave();
        else window.location.assign('./index.html');
      },
    });
  };

  return (
    <>
      <div className="hud">
        <div className="hud-cluster">
          <svg className="hud-gauge" viewBox="0 0 120 120" aria-hidden="true">
            <path d={GAUGE_ARC_PATH} pathLength={100} className="hud-gauge-track" />
            <path
              d={GAUGE_ARC_PATH}
              pathLength={100}
              className={drifting ? 'hud-gauge-value hud-gauge-value-drift' : 'hud-gauge-value'}
              strokeDasharray={`${gaugeValue} 100`}
            />
          </svg>
          <div className="hud-readout">
            <div className="hud-speed" aria-label="Speed">
              {Math.round(speedKph)}
              <span className="hud-unit"> km/h</span>
            </div>
            <div className="hud-subline">
              <span aria-label="Speed in miles per hour">{Math.round(speedMph)} mph</span>
              <span className="hud-direction" aria-label="Drive direction">
                {DIRECTION_LABEL[direction]}
              </span>
            </div>
          </div>
        </div>
        {drifting ? (
          <div className="hud-drift" role="status">
            DRIFT
          </div>
        ) : null}
        <ControlsInfo classPrefix="hud" />
      </div>

      <div className="hud-controls">
        <span className={paused ? 'hud-status hud-status-paused' : 'hud-status'}>{paused ? 'PAUSED' : 'RUNNING'}</span>
        <button type="button" className="hud-button" onClick={press('pause')}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="hud-button" onClick={press('reset')}>
          Reset
        </button>
        <button type="button" className="hud-button hud-door" aria-label="Leave to the front page" title="Leave to the front page" onClick={askLeave}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21h18" />
            <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21" />
            <circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
    </>
  );
}
