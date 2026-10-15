import { VEHICLE_SPAWN, VEHICLE_SPAWN_YAW_RADIANS } from '../config/simulationConfig';
import type { Vec3 } from '../core/types';
import { buildRoadBoundary, type RoadBoundary } from '../simulation/roadBoundary';
import { buildCircuitNetwork } from './circuitNetwork';
import type { RoadNetwork } from './roadTypes';

/*
 * World registry. Chooses which road the game loads. The default is the test circuit (Part 3). The legacy single
 * straight road (Parts 1 and 2) is kept as a reference and is reachable with ?world=legacy.
 */

export type WorldId = 'circuit' | 'legacy';

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldDefinition {
  id: WorldId;
  label: string;
  /** Road network. Null for the legacy straight road, which keeps its own layout module. */
  network: RoadNetwork | null;
  /** Drivable boundary. Null means the car has no road constraint (legacy). */
  boundary: RoadBoundary | null;
  spawn: { position: Vec3; yawRadians: number };
  /** Bounds of the road in simulation space. Null for legacy, which uses its own stretch-based check. */
  bounds: WorldBounds | null;
}

export function parseWorldId(search: string): WorldId {
  const value = new URLSearchParams(search).get('world');
  return value === 'legacy' ? 'legacy' : 'circuit';
}

const cache = new Map<WorldId, WorldDefinition>();

function boundsOf(boundary: RoadBoundary): WorldBounds {
  return { minX: boundary.minX, maxX: boundary.maxX, minZ: boundary.minZ, maxZ: boundary.maxZ };
}

/** Builds (once per id) the world definition. Deterministic. */
export function getWorldDefinition(id: WorldId): WorldDefinition {
  const cached = cache.get(id);
  if (cached) return cached;

  let definition: WorldDefinition;
  if (id === 'legacy') {
    definition = {
      id,
      label: 'Legacy straight road (reference)',
      network: null,
      boundary: null,
      spawn: { position: { ...VEHICLE_SPAWN }, yawRadians: VEHICLE_SPAWN_YAW_RADIANS },
      bounds: null,
    };
  } else {
    const network = buildCircuitNetwork();
    const boundary = buildRoadBoundary(network);
    definition = {
      id,
      label: network.name,
      network,
      boundary,
      spawn: { position: { ...network.spawn.position }, yawRadians: network.spawn.yawRadians },
      bounds: boundsOf(boundary),
    };
  }
  cache.set(id, definition);
  return definition;
}
