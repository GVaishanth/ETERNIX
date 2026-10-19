import { laneSample, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import type { GameSimulation } from '../engine/gameSimulation';
import { usePursuitStore } from '../state/pursuitStore';
import type { PursuitController, PursuitDiagnostics } from './pursuitController';
import type { PursuitSnapshot } from './pursuitTypes';
import { wrappedDistance } from '../world/wrap/worldWrap';

/*
 * Development-only read access and staging for browser tests (Part 7). Installed only in DEV builds, from App. It
 * exposes the pursuit snapshot and the controller diagnostics. Its staging calls only move the player, on the lane
 * graph, so a browser test can set up a scene. They never move a police unit. Reporting an offence goes through the same
 * trigger interface as the built-in detectors, and it counts only when a patrol sees the player.
 */

export interface PursuitDebugApi {
  /** The snapshot the HUD reads. */
  getSnapshot(): PursuitSnapshot;
  /** Controller diagnostics: units, routes, counters. Allocates; for tests only. */
  getDiagnostics(): PursuitDiagnostics;
  /** Reports a witnessed offence through the trigger interface. Returns the result, or 'unwitnessed' when no patrol sees the player. */
  reportOffence(kind: 'speeding' | 'collision'): string;
  /** Staging: places the player `meters` ahead of a unit, on the unit's lane, facing the same way. False when there is no such unit. */
  placeAheadOfUnit(id: number, meters: number): boolean;
  /** Staging: places the player on the forward segment lane farthest from every active unit, stationary. Returns the distance. */
  placeFarAway(): number;
  /** Simulation steps since the page started. Read only. */
  stepCount(): number;
  /** True while a race has the pursuit suspended. Read only. */
  suspended(): boolean;
}

/** The forward segment lane whose midpoint is farthest from every active unit. Null when the graph has no such lane. */
function farthestForwardLane(controller: PursuitController, graph: LaneGraph): { lane: LanePath; x: number; y: number; z: number; heading: number; distance: number } | null {
  const police = controller.police;
  let best: { lane: LanePath; x: number; y: number; z: number; heading: number; distance: number } | null = null;
  for (const lane of graph.lanes) {
    if (lane.kind !== 'segment' || lane.direction !== 'F') continue;
    const pose = laneSample(lane, lane.lengthMeters / 2);
    let nearest = Number.POSITIVE_INFINITY;
    police.opponents.forEach((opponent, id) => {
      if (!police.isActive(id)) return;
      // A looping lane has a period. A unit one period away from the midpoint is the same distance from it.
      const distance = lane.periodMeters === undefined
        ? Math.hypot(opponent.state.position.x - pose.x, opponent.state.position.z - pose.z)
        : wrappedDistance(opponent.state.position, pose, lane.periodMeters);
      nearest = Math.min(nearest, distance);
    });
    if (best === null || nearest > best.distance) best = { lane, x: pose.x, y: pose.y, z: pose.z, heading: pose.heading, distance: nearest };
  }
  return best;
}

export function installPursuitDebug(target: Window, controller: PursuitController, simulation: GameSimulation, graph: LaneGraph): () => void {
  const api: PursuitDebugApi = {
    getSnapshot: () => usePursuitStore.getState().snapshot,
    getDiagnostics: () => controller.diagnostics(),
    reportOffence: (kind) => controller.reportOffence(kind),
    placeAheadOfUnit: (id, meters) => {
      const opponent = controller.police.opponents[id];
      if (!opponent) return false;
      const lane = graph.byId.get(opponent.driver.route.laneId);
      if (!lane) return false;
      const pose = laneSample(lane, Math.min(opponent.driver.route.s + meters, lane.lengthMeters - 0.5));
      simulation.placeVehicle({ x: pose.x, y: pose.y, z: pose.z }, pose.heading);
      return true;
    },
    placeFarAway: () => {
      const far = farthestForwardLane(controller, graph);
      if (!far) return -1;
      simulation.placeVehicle({ x: far.x, y: far.y, z: far.z }, far.heading);
      return far.distance;
    },
    stepCount: () => simulation.stepCount,
    suspended: () => controller.isSuspended(),
  };
  const debug = target.__STREET_RACER_DEBUG__;
  if (!debug) return () => undefined;
  debug.pursuit = api;
  return () => {
    delete debug.pursuit;
  };
}
