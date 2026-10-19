import { useEffect, useState } from 'react';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { usePursuitStore } from '../state/pursuitStore';
import type { PursuitSnapshot, PursuitState } from '../pursuit/pursuitTypes';

/*
 * Pursuit HUD (Part 7). Every value comes from the pursuit store, which the controller writes from the session at about
 * 10 Hz. It is not rendered at all when no pursuit is active. The only text shown outside a pursuit is the end toast,
 * and only for an escape: the notices that come with a state change are shown only while a pursuit is on, so the two
 * can never disagree.
 */

const STATE_TITLE: Record<Exclude<PursuitState, 'INACTIVE'>, string> = {
  DETECTION: 'Spotted',
  INITIATING: 'Police responding',
  PURSUING: 'Pursuit',
  ESCALATING: 'Pursuit, backup',
  SEARCHING: 'Searching',
  COOLDOWN: 'Cooling down',
  BUSTED: 'Busted',
};

const TOAST_SECONDS = 3;
/** The busted notice stays a little longer: it says what the reset cost. */
const BUST_TOAST_SECONDS = 5;

function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

function Gauge({ label, value }: { label: string; value: number }) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div className="pursuit-gauge" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
      <span className="pursuit-gauge-label">{label}</span>
      <span className="pursuit-gauge-track">
        <span className="pursuit-gauge-fill" style={{ width: percent(clamped) }} />
      </span>
    </div>
  );
}

function StatusLine({ snapshot }: { snapshot: PursuitSnapshot }) {
  switch (snapshot.state) {
    case 'DETECTION':
      return <p className="pursuit-status">Keep them in view</p>;
    case 'INITIATING':
      return <p className="pursuit-status">Units on their way</p>;
    case 'PURSUING':
    case 'ESCALATING':
      return snapshot.lostSightSeconds > 0 ? (
        <p className="pursuit-status">Out of sight {snapshot.lostSightSeconds.toFixed(1)} s</p>
      ) : (
        <p className="pursuit-status">In sight</p>
      );
    case 'SEARCHING':
      return <p className="pursuit-status">Search {Math.ceil(snapshot.searchSecondsLeft)} s left</p>;
    case 'COOLDOWN':
      return <p className="pursuit-status">Clear in {Math.ceil(snapshot.cooldownSecondsLeft)} s</p>;
    case 'BUSTED':
      return <p className="pursuit-status">Pulled over</p>;
    default:
      return null;
  }
}

export function PursuitHud() {
  const snapshot = usePursuitStore((store) => store.snapshot);

  // The end toast is keyed by the session that ended: sessionsStarted is unique per session. It shows only after an
  // escape (cooldown ran out). Timers only schedule the dismissal; the render derives the visible state from the key.
  const escapeKey = snapshot.state === 'INACTIVE' && snapshot.lastEndReason === 'cooldown' ? snapshot.sessionsStarted : null;
  const [dismissedEscape, setDismissedEscape] = useState<number | null>(null);
  useEffect(() => {
    if (escapeKey === null) return;
    const timer = window.setTimeout(() => setDismissedEscape(escapeKey), TOAST_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [escapeKey]);
  const escaped = escapeKey !== null && dismissedEscape !== escapeKey;

  // A notice is keyed by its id. It is shown for the notice time, and only while a pursuit is on (see below).
  const noticeId = snapshot.notice?.id ?? null;
  const [expiredNotice, setExpiredNotice] = useState<number | null>(null);
  useEffect(() => {
    if (noticeId === null) return;
    const timer = window.setTimeout(() => setExpiredNotice(noticeId), PURSUIT_CONFIG.noticeSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [noticeId]);
  const notice = snapshot.notice !== null && snapshot.notice.id !== expiredNotice ? snapshot.notice.text : null;

  // The busted notice is keyed by its id, and shown whatever the pursuit state is, so a new pursuit cannot hide it early.
  const bust = usePursuitStore((store) => store.bust);
  const bustId = bust?.id ?? null;
  const [dismissedBust, setDismissedBust] = useState<number | null>(null);
  useEffect(() => {
    if (bustId === null) return;
    const timer = window.setTimeout(() => setDismissedBust(bustId), BUST_TOAST_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [bustId]);
  const bustToast =
    bust !== null && bust.id !== dismissedBust ? (
      <div className="pursuit-toast" role="status">
        {bust.text}
      </div>
    ) : null;

  if (snapshot.state === 'INACTIVE') {
    return (
      <>
        {bustToast}
        {escaped ? (
          <div className="pursuit-toast" role="status">
            Escaped. The police have given up.
          </div>
        ) : null}
      </>
    );
  }

  const state = snapshot.state;
  const level = snapshot.level;
  const lit = Array.from({ length: PURSUIT_CONFIG.heatLevels.length }, (_, index) => index < level);
  const detectionGauge = state === 'DETECTION' ? snapshot.detectionAgeSeconds / PURSUIT_CONFIG.detectionSeconds : 0;
  const running = state === 'PURSUING' || state === 'ESCALATING' || state === 'SEARCHING';

  return (
    <>
    {bustToast}
    <section className="pursuit-hud" aria-label="Police pursuit">
      <div className="pursuit-header">
        <span className="pursuit-title">{STATE_TITLE[state]}</span>
        <span className="pursuit-level" aria-label={`Heat level ${level} of ${lit.length}`}>
          {lit.map((on, index) => (
            <span key={index} className={on ? 'pursuit-pip pursuit-pip-on' : 'pursuit-pip'} />
          ))}
        </span>
      </div>
      <p className="pursuit-units">
        {snapshot.pursuingUnits > 0 ? `${snapshot.pursuingUnits} engaged` : 'No units engaged'} · {snapshot.patrolUnits} on patrol
      </p>
      <StatusLine snapshot={snapshot} />
      {state === 'DETECTION' ? <Gauge label="Detected" value={detectionGauge} /> : null}
      {running || state === 'COOLDOWN' ? <Gauge label="Escape" value={snapshot.escapeProgress} /> : null}
      {running && snapshot.captureProgress > 0 ? <Gauge label="Stopping you" value={snapshot.captureProgress} /> : null}
      {notice !== null ? (
        <p className="pursuit-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </section>
    </>
  );
}
