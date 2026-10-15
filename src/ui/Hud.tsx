import { useAppStore } from '../state/appStore';

const DEBUG_HINT = import.meta.env.DEV ? ' · ` debug panel' : '';

/** Minimal in-game HUD: speed readout and control hints. Speed is published at about 10 Hz. */
export function Hud() {
  const speedKph = useAppStore((state) => state.hudSpeedKph);

  return (
    <div className="hud">
      <div className="hud-speed" aria-label="Speed">
        {Math.round(speedKph)}
        <span className="hud-unit"> km/h</span>
      </div>
      <div className="hud-hint">W / ↑ throttle · S / ↓ brake · A / ← steer left · D / → steer right{DEBUG_HINT}</div>
    </div>
  );
}
