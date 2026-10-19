import { useState } from 'react';
import { careerService } from '../career/careerService';
import { buildCareerView, type CareerView, type LeaderboardRow, type MilestoneView } from '../career/careerModel';
import { RIVALS, careerEventById, completedDivisionLead } from '../career/careerCatalogue';
import { useCareerUiStore, type CareerTab } from '../state/careerUiStore';
import { useGarageStore } from '../garage/garageService';
import { vehicleDefinition } from '../vehicles/catalogue';
import type { GameAction } from '../input/keyBindings';
import type { CareerEventFormat } from '../career/careerTypes';
import { formatRaceTime } from '../race/raceFormat';

/*
 * The career hub (Part 9). A view over the career state: it reads the derived view and calls the career service for
 * every change. It never changes reputation, defeats, or unlocks itself. Every button here either calls the service,
 * changes what the hub shows, or closes the hub into free roam or the garage.
 */

export interface CareerHubProps {
  onAction: (action: GameAction) => void;
}

const TABS: readonly { id: CareerTab; label: string }[] = [
  { id: 'events', label: 'Events' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'milestones', label: 'Milestones' },
];

export function CareerHub({ onAction }: CareerHubProps) {
  const garage = useGarageStore((state) => state.garage);
  const career = useGarageStore((state) => state.career);
  const tab = useCareerUiStore((state) => state.tab);
  const selectedRivalId = useCareerUiStore((state) => state.selectedRivalId);
  const [message, setMessage] = useState<string | null>(null);
  const view = buildCareerView({ garage, career });

  const close = () => useCareerUiStore.getState().close();

  const start = () => {
    const result = careerService.start();
    setMessage(result.message);
  };

  /** Chooses an event as the target, then leaves the hub so the player can drive to its marker. */
  const setTarget = (eventId: string) => {
    const result = careerService.track(eventId);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    close();
  };

  const openGarage = () => {
    close();
    onAction('garage');
  };

  return (
    <div className="garage-overlay career-overlay" role="dialog" aria-label="Career hub">
      <div className="career-panel">
        <header className="career-header">
          <div>
            <h2 className="career-title">Career</h2>
            <p className="career-rank">
              <span className="career-rank-name">{view.rank.name}</span>
              <span className="career-muted">
                {' '}
                Rank {view.rank.index + 1} of {view.rank.total}
              </span>
            </p>
          </div>
          <button type="button" className="career-button" onClick={close}>
            Close
          </button>
        </header>

        {!view.started ? (
          <section className="career-intro">
            <p>{view.introduction}</p>
            <button type="button" className="career-button career-primary" onClick={start}>
              Start career
            </button>
          </section>
        ) : null}

        <Summary view={view} />

        <DivisionPanel view={view} />

        <nav className="career-tabs" aria-label="Career sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === tab ? 'career-tab career-tab-active' : 'career-tab'}
              aria-pressed={item.id === tab}
              onClick={() => useCareerUiStore.getState().setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="career-body">
          {tab === 'events' ? (
            <>
              <EventsList view={view} onTarget={setTarget} />
              <Championships view={view} />
            </>
          ) : null}
          {tab === 'leaderboard' ? (
            <Leaderboard view={view} selectedRivalId={selectedRivalId} onTarget={setTarget} onMessage={setMessage} />
          ) : null}
          {tab === 'milestones' ? <Milestones milestones={view.milestones} /> : null}
        </div>

        {message ? (
          <p className="career-message" role="status">
            {message}
          </p>
        ) : null}

        <footer className="career-footer">
          <button type="button" className="career-button" onClick={openGarage}>
            Garage
          </button>
          <button type="button" className="career-button" onClick={close}>
            Free roam
          </button>
        </footer>
      </div>
    </div>
  );
}

function Summary({ view }: { view: CareerView }) {
  const percent = Math.round(view.fraction * 100);
  return (
    <section className="career-summary" aria-label="Career progress">
      <div className="career-stat">
        <span className="career-label">Reputation</span>
        <span className="career-value">{view.reputation}</span>
      </div>
      <div className="career-stat career-stat-wide">
        <span className="career-label">Next rank{view.nextRankName ? `: ${view.nextRankName}` : ''}</span>
        <div className="career-bar" aria-hidden="true">
          <div className="career-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="career-muted">
          {view.reputationToNext === null ? 'Top rank reached' : `${view.reputationToNext} reputation to go`}
        </span>
      </div>
      <div className="career-stat">
        <span className="career-label">Events</span>
        <span className="career-value">
          {view.completedEventCount} done · {view.unlockedEventCount} open
        </span>
      </div>
      <div className="career-stat">
        <span className="career-label">Rivals beaten</span>
        <span className="career-value">
          {view.defeatedCount} / {view.totalRivals}
        </span>
      </div>
      <div className="career-stat career-stat-wide">
        <span className="career-label">Next rival</span>
        <span className="career-value">{view.nextRival ? view.nextRival.name : 'None left. The ladder is yours.'}</span>
      </div>
      <div className="career-stat career-stat-wide">
        <span className="career-label">Main objective</span>
        <span className="career-value">{view.mainObjective}</span>
      </div>
      <div className="career-stat career-stat-wide">
        <span className="career-label">Target</span>
        <span className="career-value">
          {view.target
            ? `${view.target.title} at ${view.target.areaLabel}${view.target.explicit ? '' : ' (suggested)'}`
            : view.started
              ? 'No open event. Pick one from the list.'
              : 'Start your career to see your first event.'}
        </span>
      </div>
    </section>
  );
}

const FORMAT_LABEL: Record<CareerEventFormat, string> = {
  sprint: 'Sprint',
  circuit: 'Circuit',
  checkpoint: 'Checkpoint',
  'time-attack': 'Time attack',
  rival: 'Rival challenge',
};

/** The division header: the current division, then all five in order. Planned divisions say they are not in this build. */
function DivisionPanel({ view }: { view: CareerView }) {
  const current = view.divisions.find((division) => division.id === view.currentDivisionId) ?? null;
  const lead = completedDivisionLead(view.divisions.filter((division) => division.complete).map((division) => division.id));
  return (
    <section className="career-division" aria-label="Divisions">
      {current ? (
        <>
          <h3 className="career-division-title">
            Division {current.number}: {current.name}
          </h3>
          <p className="career-item-text">{current.intro}</p>
          <p className="career-muted">
            {current.eventsDone} of {current.eventsTotal} events · {current.championshipsDone} of {current.championshipsTotal} championship
            {current.championName ? ` · ${current.championName} ${current.championDefeated ? 'beaten' : 'to beat'}` : ''}
          </p>
        </>
      ) : (
        <p className="career-item-text">
          {view.started ? 'Every open division is complete.' : 'Divisions are cleared in order. Division 1 opens when you start.'}
        </p>
      )}
      {!current && lead ? <p className="career-lead">{lead}</p> : null}
      <ul className="career-list" aria-label="Division list">
        {view.divisions.map((division) => {
          const label = division.status === 'planned' ? 'Not in this build' : division.complete ? 'Complete' : 'Open';
          const pill = division.status === 'planned' ? 'locked' : division.complete ? 'completed' : 'available';
          return (
            <li key={division.id} className={`career-item career-item-${pill}`}>
              <div className="career-item-head">
                <span className="career-item-title">
                  {division.number}. {division.name}
                </span>
                <span className={`career-pill career-pill-${pill}`}>{label}</span>
              </div>
              <p className="career-item-text">{division.intro}</p>
              <p className="career-muted">{division.requirementText}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Cup standings for each championship: points per event, the total, and the reward paid once when it is complete. */
function Championships({ view }: { view: CareerView }) {
  if (view.championships.length === 0) return null;
  return (
    <section className="career-championships" aria-label="Championships">
      <h3 className="career-division-title">Championships</h3>
      {view.championships.map((cup) => (
        <div key={cup.id} className={cup.complete ? 'career-item career-item-completed' : 'career-item'}>
          <div className="career-item-head">
            <span className="career-item-title">{cup.name}</span>
            <span className={cup.complete ? 'career-pill career-pill-completed' : 'career-pill career-pill-locked'}>
              {cup.complete ? 'Complete' : `${cup.points} points`}
            </span>
          </div>
          <p className="career-item-text">{cup.summary}</p>
          <ul className="career-list" aria-label={`${cup.name} standings`}>
            {cup.events.map((event) => (
              <li key={event.id} className="career-board-row">
                <span className="career-board-name">{event.title}</span>
                <span className="career-muted">{event.finished ? `${event.points ?? 0} points` : 'Not finished'}</span>
              </li>
            ))}
          </ul>
          <p className="career-rewards">
            Reward: +{cup.reward.reputation} reputation · {cup.reward.credits} credits (once, when every race is finished)
          </p>
        </div>
      ))}
    </section>
  );
}

function EventsList({ view, onTarget }: { view: CareerView; onTarget: (eventId: string) => void }) {
  return (
    <ul className="career-list" aria-label="Career events">
      {view.events.map((event) => {
        const statusLabel = event.status === 'completed' ? 'Completed' : event.status === 'available' ? 'Open' : 'Locked';
        return (
          <li key={event.id} className={`career-item career-item-${event.status}`}>
            <div className="career-item-head">
              <span className="career-item-title">{event.title}</span>
              <span className={`career-pill career-pill-${event.status}`}>{statusLabel}</span>
            </div>
            <p className="career-muted">
              {event.kind === 'rival' ? 'Rival challenge' : FORMAT_LABEL[event.format]} · {event.areaLabel}
              {event.rivalName ? ` · ${event.rivalName}` : ''}
            </p>
            {event.bestSeconds !== null ? <p className="career-muted">Best finish {formatRaceTime(event.bestSeconds)}</p> : null}
            <p className="career-item-text">{event.summary}</p>
            <p className="career-rewards">
              Reward: +{event.reputationReward} reputation · {event.raceCredits} credits for a{' '}
              {event.completion === 'win' ? 'win' : 'finish'}
              {event.objective
                ? ` · Objective: ${event.objective.label}${event.objective.met ? ' (met)' : ''}`
                : ''}
            </p>
            {event.status === 'locked' ? (
              <p className="career-reasons">Locked: {event.reasons.join(' ')}</p>
            ) : (
              <button
                type="button"
                className="career-button"
                onClick={() => onTarget(event.id)}
                disabled={!view.started}
              >
                {event.status === 'completed' ? 'Replay as target' : 'Set as target'}
              </button>
            )}
            {event.status === 'completed' ? <p className="career-muted">A replay pays race credits only.</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Leaderboard({
  view,
  selectedRivalId,
  onTarget,
  onMessage,
}: {
  view: CareerView;
  selectedRivalId: string | null;
  onTarget: (eventId: string) => void;
  onMessage: (text: string | null) => void;
}) {
  const board = view.leaderboard;
  const selected = selectedRivalId ? RIVALS.find((rival) => rival.id === selectedRivalId) ?? null : null;
  return (
    <div className="career-leaderboard">
      <ol className="career-board" aria-label="Leaderboard">
        {board.rows.map((row) => (
          <LeaderRow key={row.id} row={row} selected={row.id === selectedRivalId} onSelect={() => selectRow(row)} />
        ))}
      </ol>
      {selected ? <ChallengeCard rivalId={selected.id} view={view} onTarget={onTarget} onMessage={onMessage} /> : null}
    </div>
  );

  function selectRow(row: LeaderboardRow) {
    if (row.kind !== 'rival') return;
    useCareerUiStore.getState().selectRival(row.id === selectedRivalId ? null : row.id);
    onMessage(null);
  }
}

const PILL_FOR_STATE: Record<LeaderboardRow['state'], 'completed' | 'available' | 'locked'> = {
  player: 'completed',
  beaten: 'completed',
  available: 'available',
  locked: 'locked',
};

function LeaderRow({ row, selected, onSelect }: { row: LeaderboardRow; selected: boolean; onSelect: () => void }) {
  const stateLabel = row.state === 'player' ? 'You' : row.state === 'beaten' ? 'Beaten' : row.state === 'available' ? 'Open' : 'Locked';
  const selectable = row.kind === 'rival';
  const content = (
    <>
      <span className="career-board-pos">{row.position}</span>
      <span className="career-board-name">
        {row.name}
        {row.isTarget ? <span className="career-tag"> next</span> : null}
      </span>
      <span className="career-muted">{row.vehicleName ?? ''}</span>
      <span className={`career-pill career-pill-${PILL_FOR_STATE[row.state]}`}>{stateLabel}</span>
    </>
  );
  if (!selectable) return <li className="career-board-row career-board-player">{content}</li>;
  return (
    <li className={selected ? 'career-board-row career-board-row-selected' : 'career-board-row'}>
      <button type="button" className="career-board-button" onClick={onSelect} aria-pressed={selected}>
        {content}
      </button>
    </li>
  );
}

function ChallengeCard({
  rivalId,
  view,
  onTarget,
  onMessage,
}: {
  rivalId: string;
  view: CareerView;
  onTarget: (eventId: string) => void;
  onMessage: (text: string | null) => void;
}) {
  const rival = RIVALS.find((candidate) => candidate.id === rivalId);
  const row = view.leaderboard.rows.find((candidate) => candidate.id === rivalId);
  if (!rival || !row) return null;
  const challenge = rival.challengeEventIds[0] ? careerEventById(rival.challengeEventIds[0]) : null;
  const eventRow = challenge ? view.events.find((event) => event.id === challenge.id) : undefined;
  const vehicle = vehicleDefinition(rival.vehicleId);
  const beaten = row.state === 'beaten';
  const available = row.state === 'available' && challenge !== null && eventRow?.status === 'available';
  const tracked = challenge !== null && eventRow?.isTracked === true;

  const cancel = () => {
    // Cancel leaves the challenge: the card closes, and a challenge that was set as the target is cleared.
    if (tracked) careerService.track(null);
    useCareerUiStore.getState().selectRival(null);
    onMessage(null);
  };
  const accept = () => {
    if (challenge) onTarget(challenge.id);
  };
  const requirements = eventRow?.reasons ?? [];

  return (
    <section className="career-challenge" aria-label={`Challenge: ${rival.name}`}>
      <h3 className="career-challenge-title">{rival.name}</h3>
      <p className="career-muted">
        {vehicle?.name ?? rival.vehicleId} · prefers {rival.preferredEventType === 'sprint' ? 'sprints' : 'circuits'} · ladder {rival.ladderPosition}
      </p>
      <p className="career-item-text">{rival.biography}</p>
      <p className="career-item-text">
        <span className="career-label">Driving:</span> {rival.drivingStyle}
      </p>
      <p className="career-rewards">
        Win: +{rival.defeatReward.reputation} reputation · {rival.defeatReward.credits} credits (once)
      </p>
      {challenge ? <p className="career-item-text">Challenge: {challenge.title}. {challenge.summary}</p> : null}
      {beaten ? (
        <p className="career-muted">Beaten. The reward is paid once, so this challenge pays nothing new.</p>
      ) : requirements.length > 0 ? (
        <p className="career-reasons">Needs: {requirements.join(' ')}</p>
      ) : (
        <p className="career-muted">Requirements met.</p>
      )}
      <div className="career-challenge-actions">
        {!beaten ? (
          <button type="button" className="career-button career-primary" onClick={accept} disabled={!available}>
            Accept challenge
          </button>
        ) : null}
        <button type="button" className="career-button" onClick={cancel}>
          Cancel
        </button>
      </div>
      {!beaten ? <p className="career-muted">Accepting sets the target. Drive to the marker and press E to race.</p> : null}
    </section>
  );
}

function Milestones({ milestones }: { milestones: readonly MilestoneView[] }) {
  return (
    <ul className="career-list" aria-label="Milestones">
      {milestones.map((view) => (
        <li key={view.milestone.id} className={view.done ? 'career-item career-item-completed' : 'career-item'}>
          <div className="career-item-head">
            <span className="career-item-title">{view.milestone.title}</span>
            <span className={view.done ? 'career-pill career-pill-completed' : 'career-pill career-pill-locked'}>
              {view.done ? 'Done' : `${Math.min(view.current, view.target)} / ${view.target}`}
            </span>
          </div>
          <p className="career-item-text">{view.milestone.description}</p>
          <p className="career-rewards">Reward: {view.milestone.creditReward} credits (once)</p>
        </li>
      ))}
    </ul>
  );
}
