import { RACE_OPPONENT_CAPACITY } from '../config/raceConfig';
import type { RaceEventDefinition } from './raceTypes';

/*
 * Race event definitions (Part 6). Data only: no geometry and no simulation objects. Lanes and distances refer to the
 * road graph by id. buildRaceRoute validates every event against the graph; an invalid event is reported with ids and
 * is not started. To add an event, add an entry here and run the route tests.
 *
 * Marker sideOffsetMeters: distance from the road centre, positive to the right of travel, negative to the left.
 * Markers stand outside the drivable boundary (see RACE_CONFIG.markerMinSideOffsetMeters).
 */

/**
 * Eastside Sprint: one run from the south-west street to the south-east junction, through the centre column. Runs on
 * the city's street lanes only (no highway).
 */
export const SPRINT_EASTSIDE: RaceEventDefinition = {
  id: 'sprint-eastside',
  name: 'Eastside Sprint',
  type: 'sprint',
  summary: 'One run across the city centre, from the south-west street to the south-east corner. Two checkpoints, then the finish.',
  difficulty: 2,
  start: { id: 'start', label: 'Start', laneId: 'H-0-0:F:0', s: 65 },
  checkpoints: [
    { id: 'cp-1', label: 'Checkpoint 1', laneId: 'H-2-0:F:0', s: 90 },
    { id: 'cp-2', label: 'Checkpoint 2', laneId: 'V-3-1:F:0', s: 90 },
  ],
  finish: { id: 'finish', label: 'Finish', laneId: 'H-3-2:F:0', s: 90 },
  laps: 1,
  // Nine AI rivals: ten racers with the player, the full field (RACE_MIN_RACERS).
  opponentCount: RACE_OPPONENT_CAPACITY,
  opponentTopSpeedMps: 28,
  timeLimitSeconds: 240,
  rewardCredits: 300,
  marker: { laneId: 'H-0-0:F:0', s: 65, sideOffsetMeters: -11.5 },
};

/**
 * Block Circuit: two laps around one city block (the 12-lane loop from H-1-0 east, north on V-2-0, west along H-1-1 and
 * H-0-1, south on V-0-0, and east along H-0-0 back to the start line). Each lap passes checkpoint A, then checkpoint B,
 * then the start/finish line, which closes the lap. The start line is also the finish: the race ends after the last lap.
 */
export const CIRCUIT_BLOCK: RaceEventDefinition = {
  id: 'circuit-block',
  name: 'Block Circuit',
  type: 'circuit',
  summary: 'Two laps of one city block. Pass both checkpoints every lap; a lap counts only after the start-finish line.',
  difficulty: 1,
  start: { id: 'start-finish', label: 'Start / Finish', laneId: 'H-1-0:F:0', s: 65 },
  checkpoints: [
    { id: 'cp-a', label: 'Checkpoint A', laneId: 'H-0-1:R:0', s: 100 },
    { id: 'cp-b', label: 'Checkpoint B', laneId: 'V-0-0:R:0', s: 100 },
  ],
  finish: { id: 'start-finish', label: 'Start / Finish', laneId: 'H-1-0:F:0', s: 65 },
  laps: 2,
  opponentCount: RACE_OPPONENT_CAPACITY,
  opponentTopSpeedMps: 28,
  timeLimitSeconds: null,
  rewardCredits: 400,
  marker: { laneId: 'H-1-0:F:0', s: 80, sideOffsetMeters: -11.5 },
};

/**
 * Seam Sprint: one run east across the loop's east seam (x = +1200 m, the same point as x = -1200 m). Start on the east
 * side, checkpoint and finish on the west side. It exists only on the looping world (`?world=loop`), and only in the
 * loop's race list (App). It is not a career event: its credits are free-roam credits, like the other free-roam races.
 */
export const SEAM_SPRINT: RaceEventDefinition = {
  id: 'seam-sprint',
  name: 'Seam Sprint',
  type: 'sprint',
  summary: 'One run east across the loop seam, from the east side to the west side. Loop world only. One checkpoint, then the finish.',
  difficulty: 2,
  start: { id: 'start', label: 'Start', laneId: 'H-7-1:F:0', s: 65 },
  checkpoints: [{ id: 'cp-1', label: 'Checkpoint 1', laneId: 'H--4-1:F:0', s: 90 }],
  finish: { id: 'finish', label: 'Finish', laneId: 'H--3-1:F:0', s: 90 },
  laps: 1,
  opponentCount: RACE_OPPONENT_CAPACITY,
  opponentTopSpeedMps: 28,
  timeLimitSeconds: 240,
  rewardCredits: 300,
  marker: { laneId: 'H-7-1:F:0', s: 65, sideOffsetMeters: -11.5 },
};

/** Races that exist only on the looping world. Appended to the race list by App when the world has a period. */
export const LOOP_RACE_EVENTS: readonly RaceEventDefinition[] = [SEAM_SPRINT];

export const RACE_EVENTS: readonly RaceEventDefinition[] = [SPRINT_EASTSIDE, CIRCUIT_BLOCK];

export function findRaceEvent(id: string): RaceEventDefinition | undefined {
  return RACE_EVENTS.find((event) => event.id === id);
}
