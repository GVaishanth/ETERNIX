import { useId, useState, type MouseEvent } from 'react';
import { CONTROL_HELP } from '../input/controlHelp';

export interface ControlsInfoProps {
  /** Class prefix for the styles: 'hud' in the game, 'ex' on the ETERNIX front page. */
  classPrefix: 'hud' | 'ex';
}

/**
 * An Info button that shows the controls. Closed by default. The button gives up focus after a click, so the
 * driving keys keep reaching the game (Space and the arrows would otherwise activate the focused button).
 */
export function ControlsInfo({ classPrefix }: ControlsInfoProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    setOpen((value) => !value);
    event.currentTarget.blur();
  };

  return (
    <div className={`${classPrefix}-info`}>
      <button
        type="button"
        className={`${classPrefix}-info-button`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        Info
      </button>
      {open ? (
        <div id={panelId} className={`${classPrefix}-info-panel`} role="region" aria-label="Controls">
          {CONTROL_HELP.map((group) => (
            <section key={group.title} className={`${classPrefix}-info-group`}>
              <p className={`${classPrefix}-info-title`}>{group.title}</p>
              <dl className={`${classPrefix}-info-rows`}>
                {group.rows.map((row) => (
                  <div key={row.keys} className={`${classPrefix}-info-row`}>
                    <dt>{row.keys}</dt>
                    <dd>{row.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
