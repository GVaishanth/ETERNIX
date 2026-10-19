import { useEffect, useState, type MouseEvent } from 'react';
import type { GameSimulation } from '../engine/gameSimulation';
import type { GameAction } from '../input/keyBindings';
import { careerService, type CareerService } from '../career/careerService';
import { evaluateCareerHubGate, type CareerHubDecision } from '../career/careerHubGate';
import { buildCareerView } from '../career/careerModel';
import { useGarageStore } from '../garage/garageService';
import { useCareerUiStore } from '../state/careerUiStore';
import { useRaceStore } from '../state/raceStore';
import type { PursuitController } from '../pursuit/pursuitController';
import type { RaceController } from '../race/raceController';
import { CareerHub } from './CareerHub';

/** How often the hub's entry rule is re-read for the button. The key press is always checked fresh in the render loop. */
const GATE_POLL_MS = 200;

export interface CareerLauncherProps {
  simulation: GameSimulation;
  race: RaceController | null;
  pursuit: PursuitController | null;
  onAction: (action: GameAction) => void;
  service?: CareerService;
}

/**
 * The career's entry point in the HUD: the rank and reputation, the current target, the Career button, and the reason
 * the hub is unavailable. It shows the hub while the hub is open, and the outcome card after a career result.
 */
export function CareerLauncher({ simulation, race, pursuit, onAction, service = careerService }: CareerLauncherProps) {
  const open = useCareerUiStore((state) => state.open);
  const garage = useGarageStore((state) => state.garage);
  const career = useGarageStore((state) => state.career);
  const [gate, setGate] = useState<CareerHubDecision>({ allowed: true });
  const racePhase = useRaceStore((state) => state.snapshot.phase);
  // A finished or failed attempt stays on screen until it is left (Q). The next race's card opens only after that.
  const resultOpen = racePhase === 'FINISHED' || racePhase === 'FAILED';

  useEffect(() => {
    const read = () => {
      const decision = evaluateCareerHubGate({
        racePhase: race ? race.phase : 'FREE_ROAM',
        pursuitState: pursuit ? pursuit.session.currentState : 'INACTIVE',
      });
      // Only update when the answer changes, so the button does not re-render every poll.
      setGate((previous) => (sameDecision(previous, decision) ? previous : decision));
    };
    read();
    const id = window.setInterval(read, GATE_POLL_MS);
    return () => window.clearInterval(id);
  }, [simulation, race, pursuit]);

  if (open) return <CareerHub onAction={onAction} />;

  const view = buildCareerView({ garage, career });
  const press = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    onAction('career');
  };

  return (
    <>
      <div className="career-launch">
        <button type="button" className="career-button career-launch-button" onClick={press} disabled={!gate.allowed} aria-label="Open career hub">
          <span className="career-launch-title">Career</span>
          <span className="career-muted">
            {view.started ? `${view.rank.name} · ${view.reputation} rep` : 'Not started'}
          </span>
        </button>
        {!gate.allowed ? <p className="career-muted career-launch-note">{gate.reason}</p> : null}
        {view.target ? (
          <p className="career-muted career-launch-note">
            Target: {view.target.title}
            {view.target.explicit ? '' : ' (suggested)'}
          </p>
        ) : null}
        {resultOpen ? <p className="career-muted career-launch-note">Press Q to leave this result before the next race.</p> : null}
      </div>
      <CareerOutcomeCard service={service} />
    </>
  );
}

function sameDecision(a: CareerHubDecision, b: CareerHubDecision): boolean {
  if (a.allowed || b.allowed) return a.allowed === b.allowed;
  return a.reason === b.reason;
}

/** The result of the last career race, shown after the race. Nothing here changes progress. */
export function CareerOutcomeCard({ service = careerService }: { service?: CareerService }) {
  const summary = service.noticeStore((state) => state.lastOutcome);
  const error = service.noticeStore((state) => state.error);
  if (!summary && !error) return null;
  if (error) {
    return (
      <div className="career-outcome career-outcome-error" role="status">
        <p>Career result not recorded. {error}</p>
        <button type="button" className="career-button" onClick={() => service.dismissOutcome()}>
          OK
        </button>
      </div>
    );
  }
  if (!summary) return null;
  const lines: string[] = [];
  if (summary.replay) lines.push('Replay. Race credits only.');
  if (summary.completedEventTitle) lines.push(`${summary.completedEventTitle} complete.`);
  if (summary.reputationGained > 0) lines.push(`+${summary.reputationGained} reputation.`);
  if (summary.objectiveMet) lines.push(`Objective met: ${summary.objectiveMet}.`);
  if (summary.rivalDefeated) lines.push(`${summary.rivalDefeated} beaten.`);
  for (const rank of summary.rankUps) lines.push(`Rank up: ${rank}.`);
  for (const milestone of summary.milestones) lines.push(`Milestone: ${milestone}.`);
  if (summary.creditsGained > 0) lines.push(`+${summary.creditsGained} credits.`);
  if (summary.nextRivalName) lines.push(`Next rival: ${summary.nextRivalName}.`);
  if (summary.outcome !== 'finished') lines.push(summary.outcome === 'timeout' ? 'Time ran out. No career reward.' : 'Race aborted. No career reward.');
  if (summary.outcome === 'finished' && summary.reputationGained === 0 && summary.creditsGained === 0) lines.push('No new progress from this result.');
  return (
    <div className="career-outcome" role="status" aria-label="Career result">
      <p className="career-outcome-title">Career result</p>
      {lines.map((line) => (
        <p key={line} className="career-outcome-line">
          {line}
        </p>
      ))}
      <button type="button" className="career-button" onClick={() => service.dismissOutcome()}>
        Dismiss
      </button>
    </div>
  );
}
