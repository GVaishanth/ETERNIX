import type { MouseEvent } from 'react';
import type { GameAction } from '../input/keyBindings';
import { formatPlace, formatRaceTime } from '../race/raceFormat';
import { useRaceStore, type RaceApproachInfo, type RaceResultInfo, type RaceSnapshot } from '../state/raceStore';

/*
 * Race HUD (Part 6). Every value comes from the race store, which the race controller writes from the authoritative
 * race state at about 10 Hz. Buttons go through the same action queue as the keys (E and Q), so there is one input path.
 */

export interface RaceHudProps {
  onAction: (action: GameAction) => void;
}

type Press = (action: GameAction) => (event: MouseEvent<HTMLButtonElement>) => void;

const OUTCOME_TITLE: Record<RaceResultInfo['outcome'], string> = {
  finished: 'Finished',
  aborted: 'Race aborted',
  timeout: 'Time limit reached',
};

function ApproachCard({ approach, press }: { approach: RaceApproachInfo; press: Press }) {
  const laps = approach.laps > 1 ? `${approach.laps} laps` : 'One run';
  return (
    <section className="race-card" aria-label={`Race: ${approach.name}`}>
      <div className="race-kicker">Race available</div>
      <h2 className="race-title">{approach.name}</h2>
      <p className="race-summary">{approach.summary}</p>
      <dl className="race-facts">
        <div><dt>Route</dt><dd>{laps}</dd></div>
        <div><dt>Checkpoints</dt><dd>{approach.checkpointCount + 1}</dd></div>
        <div><dt>Rivals</dt><dd>{approach.opponentCount}</dd></div>
        <div><dt>Time limit</dt><dd>{approach.timeLimitSeconds === null ? 'None' : formatRaceTime(approach.timeLimitSeconds)}</dd></div>
        <div><dt>Reward</dt><dd>up to {approach.rewardCredits} credits</dd></div>
      </dl>
      <div className="race-actions">
        <button
          type="button"
          className="hud-button race-primary"
          onClick={press('raceConfirm')}
          disabled={approach.blocked !== null}
        >
          Start race · E
        </button>
        <button type="button" className="hud-button" onClick={press('raceCancel')}>Not now · Q</button>
      </div>
      {approach.blocked !== null ? <p className="race-blocked" role="status">{approach.blocked}</p> : null}
      <p className="race-note">Rewards are provisional and kept for this session only.</p>
    </section>
  );
}

function Countdown({ race, press }: { race: RaceSnapshot; press: Press }) {
  const label = race.countdown !== null ? String(race.countdown) : 'Get ready';
  return (
    <div className="race-countdown" role="status" aria-live="assertive">
      <div className="race-countdown-number">{label}</div>
      <div className="race-countdown-hint">Hold on the grid · Q to cancel</div>
      <button type="button" className="hud-button" onClick={press('raceCancel')}>Cancel · Q</button>
    </div>
  );
}

function RaceStrip({ race, press }: { race: RaceSnapshot; press: Press }) {
  const remaining = race.timeLimitSeconds === null ? null : Math.max(0, race.timeLimitSeconds - race.raceSeconds);
  return (
    <div className="race-strip">
      <div className="race-strip-row">
        {race.goVisible ? <span className="race-go">GO</span> : null}
        {race.phase === 'PAUSED' ? <span className="race-paused">PAUSED</span> : null}
        <span className="race-timer" aria-label="Race time">{formatRaceTime(race.raceSeconds)}</span>
        {remaining !== null ? <span className="race-limit">limit {formatRaceTime(remaining)}</span> : null}
        {race.place !== null ? (
          <span className="race-place" aria-label="Position">
            {formatPlace(race.place)} / {race.totalRacers}
          </span>
        ) : null}
        {race.laps > 0 ? <span className="race-lap">Lap {race.lap} / {race.laps}</span> : null}
        {race.nextGate ? <span className="race-next">Next: {race.nextGate}</span> : null}
        <button type="button" className="hud-button" onClick={press('raceCancel')}>Abort · Q</button>
      </div>
      <Notices notices={race.notices} />
    </div>
  );
}

function Notices({ notices }: { notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <ul className="race-notices" role="status" aria-live="polite">
      {notices.map((text, index) => (
        <li key={`${index}-${text}`}>{text}</li>
      ))}
    </ul>
  );
}

function ResultCard({ result, sessionCredits, press }: { result: RaceResultInfo; sessionCredits: number; press: Press }) {
  const won = result.outcome === 'finished' && result.place === 1;
  return (
    <section className="race-card race-result" aria-label="Race result">
      <div className={won ? 'race-kicker race-kicker-win' : 'race-kicker'}>{won ? 'You win' : OUTCOME_TITLE[result.outcome]}</div>
      {result.outcome === 'finished' && result.place !== null ? (
        <h2 className="race-title">{formatPlace(result.place)} of {result.totalRacers}</h2>
      ) : (
        <h2 className="race-title">{OUTCOME_TITLE[result.outcome]}</h2>
      )}
      <dl className="race-facts">
        <div>
          <dt>Time</dt>
          <dd>{result.finishSeconds === null ? 'Did not finish' : formatRaceTime(result.finishSeconds)}</dd>
        </div>
        <div>
          <dt>Reward</dt>
          <dd>{result.rewardCredits === null ? 'None' : `+${result.rewardCredits} credits`}</dd>
        </div>
      </dl>
      {result.standings.length > 0 ? (
        <ol className="race-standings" aria-label="Standings">
          {result.standings.map((row) => (
            <li key={`${row.position}-${row.name}`} className={row.isPlayer ? 'race-standing-player' : undefined}>
              <span>{row.position}. {row.name}</span>
              <span>{row.finished ? 'Finished' : 'DNF'}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="race-actions">
        <button type="button" className="hud-button race-primary" onClick={press('raceConfirm')}>Retry · E</button>
        <button type="button" className="hud-button" onClick={press('raceCancel')}>Leave · Q</button>
      </div>
      <p className="race-note">Provisional, this session only. Session total: {sessionCredits} credits.</p>
    </section>
  );
}

/** Race UI for the current phase. Free roam shows nothing here, so the HUD stays compact. */
export function RaceHud({ onAction }: RaceHudProps) {
  const race = useRaceStore((state) => state.snapshot);

  // Buttons take focus on click. Blur them so Space and the arrow keys still reach the driving controls.
  const press: Press = (action) => (event) => {
    onAction(action);
    event.currentTarget.blur();
  };

  return (
    <div className="race-layer">
      {race.phase === 'EVENT_APPROACH' && race.approach ? <ApproachCard approach={race.approach} press={press} /> : null}
      {race.phase === 'COUNTDOWN' ? <Countdown race={race} press={press} /> : null}
      {(race.phase === 'RACING' || race.phase === 'PAUSED') ? <RaceStrip race={race} press={press} /> : null}
      {(race.phase === 'FINISHED' || race.phase === 'FAILED') && race.result ? (
        <ResultCard result={race.result} sessionCredits={race.sessionCredits} press={press} />
      ) : null}
      {race.refusal ? <div className="race-toast" role="status">{race.refusal}</div> : null}
    </div>
  );
}
