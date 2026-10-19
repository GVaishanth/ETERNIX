import type { GameSimulation } from '../engine/gameSimulation';
import type { RaceSnapshot } from '../state/raceStore';
import { useRaceStore } from '../state/raceStore';
import type { RaceController } from './raceController';

/*
 * Development-only read access for browser tests (Part 6). Installed only in DEV builds, from App. It exposes the race
 * store, the first route's polyline and gates, and the live car pose. It also has one staging call, placeForTest, which
 * the browser test uses to start a run near the marker. That call is not used by gameplay: the player's driving stays
 * keyboard-only, and the test reports the placement as a staging step.
 */

export interface RaceDebugRoute {
  eventId: string;
  polyline: { x: number[]; z: number[] };
  gates: { label: string; x: number; z: number; closesLap: boolean }[];
  marker: { x: number; z: number };
  /** The route's start anchor (row 0 of the grid, the front rival's row). */
  grid: { x: number; z: number; yaw: number };
  /** The player's grid slot, the last row, or null before the attempt is built. Read only. */
  playerGrid: { x: number; z: number; yaw: number } | null;
}

export interface RaceDebugApi {
  getRace(): RaceSnapshot;
  getRoute(index: number): RaceDebugRoute | null;
  getPose(): { x: number; z: number; yaw: number; speed: number };
  /** DEV staging only: places the car stationary at a pose. Not a gameplay action. */
  placeForTest(x: number, z: number, yaw: number): void;
  /** The race rivals' current speeds (m/s), for the speed check. Read only. Empty when no rivals are on the road. */
  rivalSpeeds(): ReadonlyArray<{ id: string; speedMps: number }>;
  /** Number of traffic cars currently active, or -1 when the world has no traffic. Read only. */
  activeTrafficCount(): number;
  /** True while the traffic spawner is held for a race. Read only. */
  trafficSuspended(): boolean;
}

export function installRaceDebug(target: Window, controller: RaceController, simulation: GameSimulation): () => void {
  const api: RaceDebugApi = {
    getRace: () => useRaceStore.getState().snapshot,
    getRoute: (index) => {
      const entry = controller.entries[index];
      if (!entry) return null;
      const route = entry.route;
      const xs = Array.from(route.polyline.xs);
      const zs = Array.from(route.polyline.zs);
      return {
        eventId: route.eventId,
        polyline: { x: xs, z: zs },
        gates: route.gates.map((gate) => ({ label: gate.label, x: gate.x, z: gate.z, closesLap: gate.closesLap })),
        marker: { x: route.marker.x, z: route.marker.z },
        grid: { x: route.grid.x, z: route.grid.z, yaw: route.grid.yawRadians },
        playerGrid: entry.director.playerSlot ? { x: entry.director.playerSlot.x, z: entry.director.playerSlot.z, yaw: entry.director.playerSlot.yawRadians } : null,
      };
    },
    getPose: () => {
      const state = simulation.state;
      return { x: state.position.x, z: state.position.z, yaw: state.yaw, speed: state.speed };
    },
    placeForTest: (x, z, yaw) => simulation.placeVehicle({ x, y: 0, z }, yaw),
    activeTrafficCount: () => {
      const traffic = simulation.traffic;
      return traffic ? traffic.system.vehicles.filter((vehicle) => vehicle.active).length : -1;
    },
    trafficSuspended: () => simulation.traffic?.spawner.isSuspended ?? false,
    rivalSpeeds: () => (simulation.opponents?.opponents ?? []).map((opponent) => ({ id: String(opponent.id), speedMps: opponent.state.speed })),
  };
  const debug = target.__STREET_RACER_DEBUG__;
  if (!debug) return () => undefined;
  debug.race = api;
  return () => {
    delete debug.race;
  };
}
