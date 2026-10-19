import { RACE_CONFIG, RACE_DIFFICULTY_SPEED_FACTOR } from '../config/raceConfig';
import type { RaceEventDefinition } from './raceTypes';

/*
 * Rival pace (race difficulty). Pure: no simulation and no React. Units: m/s.
 *
 * A rival's speed cap is its event pace (the event's opponent top speed times the difficulty factor) times the pace
 * factor for the grid place the rival starts in. The cap is set once, at the start, and does not change with the
 * standings. So the cars behind the player are the faster ones, and passing is decided by driving.
 */

/** The event's base rival pace, m/s, before the place factor. */
export function eventRivalPaceMps(event: Pick<RaceEventDefinition, 'opponentTopSpeedMps' | 'difficulty'>): number {
  return event.opponentTopSpeedMps * RACE_DIFFICULTY_SPEED_FACTOR[event.difficulty];
}

/** The pace factor for a 1-based place. Places past the table use its last value; a place below 1 uses the first. */
export function placePaceFactor(place: number): number {
  const table = RACE_CONFIG.placePaceFactor;
  if (table.length === 0) return 1;
  const index = Math.min(Math.max(Math.floor(place) - 1, 0), table.length - 1);
  return table[index] ?? 1;
}

/** A rival's speed cap, m/s, for its starting grid place. Includes the race AI multiplier (RACE_CONFIG.aiSpeedMultiplier). */
export function rivalSpeedCapMps(basePaceMps: number, place: number): number {
  return basePaceMps * placePaceFactor(place) * RACE_CONFIG.aiSpeedMultiplier;
}
