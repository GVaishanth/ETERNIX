import { useEffect, useState, type MouseEvent } from 'react';
import type { GameSimulation } from '../engine/gameSimulation';
import type { GameAction } from '../input/keyBindings';
import { evaluateGarageEntryAt, type GarageEntryDecision } from '../garage/garageGate';
import { useGarageStore } from '../garage/garageService';
import { useGarageUiStore } from '../state/garageUiStore';
import type { PursuitController } from '../pursuit/pursuitController';
import type { RaceController } from '../race/raceController';
import type { WorldDefinition } from '../world/worlds';
import { Garage } from './Garage';

/** How often the entry rule is re-read for the button. The key press is always checked fresh in the render loop. */
const GATE_POLL_MS = 200;

export interface GarageLauncherProps {
  simulation: GameSimulation;
  race: RaceController | null;
  pursuit: PursuitController | null;
  world: WorldDefinition;
  onAction: (action: GameAction) => void;
}

/**
 * The garage's entry point in the HUD: the credits balance, the Garage button, and the reason it is unavailable.
 * It shows the overlay while the garage is open. It reads the same entry rule as the V key.
 */
export function GarageLauncher({ simulation, race, pursuit, world, onAction }: GarageLauncherProps) {
  const open = useGarageUiStore((state) => state.open);
  const balance = useGarageStore((state) => state.garage.credits);
  const persistence = useGarageStore((state) => state.persistence);
  const [gate, setGate] = useState<GarageEntryDecision>({ allowed: false, reason: 'Checking the garage entrance.' });

  useEffect(() => {
    if (world.garage === null) return;
    const read = () => {
      const state = simulation.state;
      const decision = evaluateGarageEntryAt({
        position: state.position,
        speedMps: state.speed,
        entrance: world.garage,
        periodMeters: world.periodMeters,
        racePhase: race ? race.phase : 'FREE_ROAM',
        pursuitState: pursuit ? pursuit.session.currentState : 'INACTIVE',
      });
      // Only update when the answer changes, so the button does not re-render every poll.
      setGate((previous) => (sameDecision(previous, decision) ? previous : decision));
    };
    read();
    const id = window.setInterval(read, GATE_POLL_MS);
    return () => window.clearInterval(id);
  }, [simulation, race, pursuit, world]);

  const press = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    onAction('garage');
  };

  if (open) return <Garage />;

  return (
    <>
      <div className="garage-credits" aria-label="Credits balance">
        <span className="garage-balance-label">Credits</span>
        <span className="garage-balance-value">{balance.toLocaleString('en-US')}</span>
        {!persistence.writable ? <span className="garage-credits-note">not saved</span> : null}
      </div>
      {/* A save problem found at load is shown on the HUD, not only inside the garage, so a player with a damaged save
          is told before they try to buy anything. It does not block play. */}
      {persistence.notice ? (
        <p className="garage-save-notice" role="status">
          {persistence.notice}
        </p>
      ) : null}
      {world.garage !== null ? (
        <div className="garage-launch">
          <button type="button" className="hud-button" disabled={!gate.allowed} onClick={press}>
            Garage · V
          </button>
          <span className="garage-launch-reason" role="status">
            {gate.allowed ? 'Ready. Press V or the button to open the garage.' : gate.reason}
          </span>
        </div>
      ) : null}
    </>
  );
}

function sameDecision(a: GarageEntryDecision, b: GarageEntryDecision): boolean {
  if (a.allowed || b.allowed) return a.allowed === b.allowed;
  return a.reason === b.reason;
}
