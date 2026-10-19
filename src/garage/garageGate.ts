/**
 * Part 8 garage entry rules. One pure function decides whether the garage may open. The keyboard action, the HUD
 * button, and the tests all use it, so they cannot disagree.
 *
 * Rules, in the order they are reported:
 * 1. The garage exists only in the city world (an entrance is defined).
 * 2. No race in progress or on approach. A race owns the car until it ends or is cancelled.
 * 3. No pursuit. Entering the garage does not clear a pursuit, so a pursuit blocks entry. It is not paused away.
 * 4. Inside the entrance zone.
 * 5. Stopped, within the entrance speed limit. Switching cars never happens while the car is moving.
 */
import { GARAGE_CONFIG } from '../config/garageConfig';
import { wrapDelta } from '../world/wrap/worldWrap';
import type { PursuitState } from '../pursuit/pursuitTypes';
import type { RaceState } from '../race/raceTypes';

export interface GarageEntryInputs {
  readonly hasEntrance: boolean;
  readonly distanceToEntranceMeters: number;
  readonly speedMps: number;
  readonly racePhase: RaceState;
  readonly pursuitState: PursuitState;
}

export type GarageEntryDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export function evaluateGarageEntry(inputs: GarageEntryInputs): GarageEntryDecision {
  if (!inputs.hasEntrance) return refuse('The garage is in the city. Drive into the city to use it.');
  if (inputs.racePhase !== 'FREE_ROAM') return refuse('Finish or cancel the race before entering the garage.');
  if (inputs.pursuitState !== 'INACTIVE') return refuse('Lose the police before entering the garage.');
  if (!(inputs.distanceToEntranceMeters <= GARAGE_CONFIG.entranceRadiusMeters)) {
    return refuse('Drive to the garage entrance (the amber ring on the road at the start).');
  }
  if (!(inputs.speedMps <= GARAGE_CONFIG.entranceMaxSpeedMps)) return refuse('Stop inside the garage entrance first.');
  return { allowed: true };
}

function refuse(reason: string): GarageEntryDecision {
  return { allowed: false, reason };
}

export interface GarageEntryPlace {
  readonly position: { readonly x: number; readonly z: number };
  readonly speedMps: number;
  /** The world's entrance point, or null where the world has no garage. */
  readonly entrance: { readonly position: { readonly x: number; readonly z: number } } | null;
  /** Loop period in metres, or null for a finite world. The distance is measured the short way round the period. */
  readonly periodMeters?: number | null;
  readonly racePhase: RaceState;
  readonly pursuitState: PursuitState;
}

/**
 * The gate for a car at a place. The render loop (V key) and the launcher (button) both call this with the same
 * simulation state, so the button's disabled reason and the key's refusal always agree.
 */
export function evaluateGarageEntryAt(place: GarageEntryPlace): GarageEntryDecision {
  const entrance = place.entrance;
  const distance = entrance
    ? distanceOnWorld(place.position, entrance.position, place.periodMeters ?? null)
    : Number.POSITIVE_INFINITY;
  return evaluateGarageEntry({
    hasEntrance: entrance !== null,
    distanceToEntranceMeters: distance,
    speedMps: Math.abs(place.speedMps),
    racePhase: place.racePhase,
    pursuitState: place.pursuitState,
  });
}

/**
 * Planar distance between two points. On a looping world the distance is the short way round the period, so a car one
 * period away from the entrance is at the entrance.
 */
export function distanceOnWorld(
  a: { readonly x: number; readonly z: number },
  b: { readonly x: number; readonly z: number },
  periodMeters: number | null,
): number {
  if (periodMeters === null) return Math.hypot(a.x - b.x, a.z - b.z);
  return Math.hypot(wrapDelta(b.x, a.x, periodMeters), wrapDelta(b.z, a.z, periodMeters));
}
