import { legProgressMeters, type RacerProgress } from './raceProgress';
import type { RaceRoute } from './raceRoute';
import type { RacerKind } from './raceTypes';

/*
 * Standings (Part 6). Pure. Finished racers rank by finish order and come first. Unfinished racers rank by gates passed,
 * then by progress along the current leg. An exact tie keeps the order the racers are listed in (the player first, then
 * the rivals in grid order), so the order is stable and matches the grid. Straight-line distance is never used.
 */

export interface StandingRow {
  id: string;
  kind: RacerKind;
  name: string;
  /** 1-based rank. */
  position: number;
  gatesPassed: number;
  lapsDone: number;
  legProgressMeters: number;
  finished: boolean;
  finishTime: number | null;
  onRoute: boolean;
}

export function rankRacers(racers: readonly RacerProgress[], route: RaceRoute): StandingRow[] {
  const keyed = racers.map((racer) => ({
    racer,
    leg: legProgressMeters(racer, route),
  }));
  keyed.sort((a, b) => {
    const af = a.racer.finishOrder;
    const bf = b.racer.finishOrder;
    if (af !== null || bf !== null) {
      if (af === null) return 1;
      if (bf === null) return -1;
      return af - bf;
    }
    if (a.racer.gatesPassed !== b.racer.gatesPassed) return b.racer.gatesPassed - a.racer.gatesPassed;
    if (a.leg !== b.leg) return b.leg - a.leg;
    // An exact tie keeps the listed order (Array.prototype.sort is stable).
    return 0;
  });
  return keyed.map(({ racer, leg }, index) => ({
    id: racer.id,
    kind: racer.kind,
    name: racer.name,
    position: index + 1,
    gatesPassed: racer.gatesPassed,
    lapsDone: racer.lapsDone,
    legProgressMeters: leg,
    finished: racer.finished,
    finishTime: racer.finishTime,
    onRoute: racer.onRoute,
  }));
}
