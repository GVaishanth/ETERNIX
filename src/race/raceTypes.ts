/*
 * Race data types (Part 6). Pure: no Three.js, no React, no simulation objects.
 */
import type { TrafficTypeId } from '../traffic/trafficTypes';

export type RaceEventType = 'sprint' | 'circuit';

/** The race lifecycle. Allowed transitions are in raceStateMachine.ts. */
export type RaceState = 'FREE_ROAM' | 'EVENT_APPROACH' | 'COUNTDOWN' | 'RACING' | 'FINISHED' | 'FAILED' | 'PAUSED';

/** Why a race ended. Only the three kinds below exist, and each is recorded once per attempt. */
export type RaceEndReason = 'finished' | 'aborted' | 'timeout';

/** A point on a driving lane, identified by a stable id. Anchors are data; the lane and distance come from the road graph. */
export interface RouteAnchor {
  /** Stable checkpoint id, unique within the event. */
  id: string;
  /** Short label for the HUD and the notifications. */
  label: string;
  /** Lane id from the road graph (segment lanes only). */
  laneId: string;
  /** Distance along that lane, meters. */
  s: number;
}

export interface RaceEventDefinition {
  /** Unique event id. Stable across saves and tests. */
  id: string;
  name: string;
  type: RaceEventType;
  summary: string;
  /** 1 (easy) to 3 (hard). Sets the opponent speed factor. */
  difficulty: 1 | 2 | 3;
  /** Grid anchor: the start line. Slots are placed behind it on the route's first lane. */
  start: RouteAnchor;
  /** Ordered checkpoints, excluding the finish. */
  checkpoints: readonly RouteAnchor[];
  /**
   * Finish line. Sprint: the finish. Circuit: the start/finish line, which closes each lap. It is the last gate of each lap.
   */
  finish: RouteAnchor;
  /** Number of laps. Sprint is 1. Circuit is 2 or more. */
  laps: number;
  opponentCount: number;
  /** Top speed the opponents aim for, before the difficulty factor, m/s. */
  opponentTopSpeedMps: number;
  /** Time limit, seconds, or null for no limit. A timeout ends the race as a failure. */
  timeLimitSeconds: number | null;
  /** Base credits for a win. Placing lower multiplies it. Provisional: not persisted. */
  rewardCredits: number;
  /** Roadside marker: a point on a driving lane plus a sideways offset to the verge, meters. */
  marker: { laneId: string; s: number; sideOffsetMeters: number };
  /**
   * Optional named opponents, in grid order (Part 9). A career rival race names its rival here. Free-roam races leave
   * it out, and their opponents take the default names and body shapes. The count still comes from opponentCount.
   */
  opponents?: readonly RaceOpponentDef[];
  /**
   * Optional path shaping. legVia[k] lists anchors the route passes, in order, between waypoint k and waypoint k+1, where
   * the waypoints are [start, ...checkpoints, finish] (a circuit: [finish, ...checkpoints, finish]). They are not gates:
   * they never count and never open a checkpoint. Without them, a leg is the shortest path, which on a grid can pick a
   * different set of streets than the one designed. A missing entry means no via points for that leg.
   */
  readonly legVia?: readonly (readonly RouteAnchor[])[];
  /**
   * True when ordinary traffic keeps running on the route during the race (Division 2). Traffic is still cleared at the
   * start, so the grid is clean. Default false: every other race holds the traffic spawner, as before.
   */
  trafficOnRoute?: boolean;
}

/** A named opponent for a race: the display name and the traffic body shape the AI car uses. */
export interface RaceOpponentDef {
  readonly name: string;
  readonly typeId: TrafficTypeId;
}

export interface RaceGateDef {
  /** The anchor id. The circuit's start/finish line repeats once per lap, with this same id. */
  id: string;
  label: string;
  /** Road-centre point on the driving lane, simulation space. */
  x: number;
  z: number;
  /** Travel heading of the lane at the gate, radians. Crossings count only in this direction. */
  headingRadians: number;
  /** Distance along the route polyline at the gate, meters. */
  routeDistanceMeters: number;
  /** True for the gate that closes a lap (the finish, or the start/finish line on a circuit). */
  closesLap: boolean;
}

/** Racer kinds, for standings and the HUD. */
export type RacerKind = 'player' | 'opponent';

export interface RacerSummary {
  id: string;
  kind: RacerKind;
  name: string;
  /** 1-based rank, from standings. */
  position: number;
  /** Gates passed in the sequence, all laps. */
  gatesPassed: number;
  finished: boolean;
  /** Completion time from GO, seconds, or null while the racer is still on track. */
  finishSeconds: number | null;
}
