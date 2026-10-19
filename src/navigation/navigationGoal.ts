import { careerEventById } from '../career/careerCatalogue';
import { CAREER_RACE_EVENTS } from '../career/careerRaces';
import { RACE_EVENTS } from '../race/raceEvents';
import type { RaceState } from '../race/raceTypes';
import { laneSample, type LaneGraph } from '../traffic/laneGraph';
import { nearestLane, type NavigationGoal } from './navigationPath';

/*
 * Navigation goals. A goal is a lane and a distance along it. The destinations are:
 *   - a career event's race marker: the roadside place where the player drives to start the race (not the grid start),
 *   - the next checkpoint of the race in progress,
 *   - the garage entrance.
 * `chooseGoal` picks one from the race state. Pure: the caller supplies the lane graph and the current state.
 */

export interface NavigationPlace {
  readonly x: number;
  readonly z: number;
}

export interface NavigationTargets {
  /** The race state. A race that is counting down or paused has no route. */
  readonly phase: RaceState;
  /** The career target event id, or null when there is none. */
  readonly careerEventId: string | null;
  /** The next checkpoint of the race in progress, or null. */
  readonly checkpoint: NavigationPlace | null;
  /** The garage entrance, or null where the world has none. */
  readonly garage: NavigationPlace | null;
}

function goalAt(graph: LaneGraph, kind: NavigationGoal['kind'], label: string, laneId: string, s: number): NavigationGoal | null {
  const lane = graph.byId.get(laneId);
  if (!lane) return null;
  const distance = Math.min(Math.max(s, 0), lane.lengthMeters);
  const pose = laneSample(lane, distance);
  return { kind, label, laneId, s: distance, x: pose.x, z: pose.z };
}

/** The roadside marker of a career event's race: where the player drives to start it. Null when there is no race. */
export function careerGoal(graph: LaneGraph, eventId: string): NavigationGoal | null {
  const event = careerEventById(eventId);
  if (!event) return null;
  const race = [...RACE_EVENTS, ...CAREER_RACE_EVENTS].find((candidate) => candidate.id === event.raceEventId);
  if (!race) return null;
  return goalAt(graph, 'career', event.title, race.marker.laneId, race.marker.s);
}

/** A checkpoint of the race in progress: the lane nearest to it. Null when the lane graph has no lanes. */
export function checkpointGoal(graph: LaneGraph, place: NavigationPlace): NavigationGoal | null {
  const hit = nearestLane(graph, place.x, place.z);
  if (hit === null) return null;
  return goalAt(graph, 'checkpoint', 'Next checkpoint', hit.laneId, hit.s);
}

/** The lane nearest the garage entrance. Null when the world has no entrance. */
export function garageGoal(graph: LaneGraph, entrance: NavigationPlace | null): NavigationGoal | null {
  if (entrance === null) return null;
  const hit = nearestLane(graph, entrance.x, entrance.z);
  if (hit === null) return null;
  return goalAt(graph, 'garage', 'Garage', hit.laneId, hit.s);
}

/**
 * The destination for the moment. A race that is counting down or paused shows nothing. A race that is running shows
 * the next checkpoint. Otherwise the career target comes first, then the garage.
 */
export function chooseGoal(graph: LaneGraph, targets: NavigationTargets): NavigationGoal | null {
  if (targets.phase === 'COUNTDOWN' || targets.phase === 'PAUSED') return null;
  if (targets.phase === 'RACING') return targets.checkpoint === null ? null : checkpointGoal(graph, targets.checkpoint);
  const career = targets.careerEventId === null ? null : careerGoal(graph, targets.careerEventId);
  return career ?? garageGoal(graph, targets.garage);
}
