import { VEHICLE_SPAWN, VEHICLE_SPAWN_YAW_RADIANS } from '../config/simulationConfig';
import type { Vec3 } from '../core/types';
import { buildRoadBoundary, type RoadBoundary } from '../simulation/roadBoundary';
import { buildLaneGraph, type LaneGraph } from '../traffic/laneGraph';
import { CIRCUIT_OPPONENT_SPECS, CIRCUIT_TRAFFIC_SCENARIO, CITY_TRAFFIC_SCENARIO } from '../traffic/trafficScenarios';
import type { SpawnRequest } from '../traffic/trafficSystem';
import type { OpponentSpec } from '../ai/aiOpponents';
import { buildCircuitNetwork } from './circuitNetwork';
import { buildCityNetwork, buildLoopCityNetwork } from './city/cityNetwork';
import { buildLoopScenery } from './city/loopScenery';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { CITY_DEV_RESET } from './city/cityLayout';
import { buildCityScenery, type CityScenery } from './city/cityScenery';
import { hillsideGroundFor } from './hillsideGround';
import type { AmbientOptions } from '../traffic/trafficAmbient';
import type { RoadNetwork } from './roadTypes';

/*
 * World registry. Chooses which road the game loads. The default is the looping world (Stage D close-out). The finite city
 * (Part 5) stays reachable with ?world=city. The test circuit (Part 3) stays reachable with ?world=circuit as a
 * regression. The legacy single straight road (Parts 1 and 2) is reachable with ?world=legacy.
 */

export type WorldId = 'city' | 'circuit' | 'legacy' | 'loop';

/** City-only extras: decorative scenery and the minimap, which reads the network from the parent definition. */
export interface CityWorldExtras {
  scenery: CityScenery;
}

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
  /** Directed lane graph for traffic. Null for legacy, which has no traffic. */
  lanes: LaneGraph | null;
  /** Fixed traffic spawn requests. Empty for legacy. */
  trafficScenario: readonly SpawnRequest[];
  /** Opponent AI cars. Empty for legacy. */
  opponents: readonly OpponentSpec[];
  /** Present only for the city world. */
  city: CityWorldExtras | null;
  /** Ambient traffic seed. Null where traffic is scenario-only (circuit, legacy). */
  ambient: AmbientOptions | null;
  /** Explicit development reset pose (DEV only). Null when the world defines none. */
  devReset: { position: Vec3; yawRadians: number } | null;
  /** Garage entrance (Part 8). Only the city has one. The car must stop inside its zone to open the garage. */
  garage: { position: Vec3 } | null;
  /**
   * Period of a looping world in metres, or null for a finite world. Traffic, police, and races run on the loop (Stage D)
   * and use the period for distances. The rendering origin follows the car, so the world is drawn relative to the car.
   */
  periodMeters: number | null;
}

/** Seed for the city's ambient traffic. Fixed, so the same drive gives the same traffic. */
export const CITY_AMBIENT_SEED = 0x7a11c0de;

export function parseWorldId(search: string): WorldId {
  const value = new URLSearchParams(search).get('world');
  if (value === 'legacy') return 'legacy';
  if (value === 'circuit') return 'circuit';
  if (value === 'city') return 'city';
  // The looping world is the default (Stage D close-out, user decision). Any other value also loads the loop.
  return 'loop';
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
      lanes: null,
      trafficScenario: [],
      opponents: [],
      city: null,
      ambient: null,
      devReset: null,
      garage: null,
      periodMeters: null,
    };
  } else if (id === 'loop') {
    // The default world: the same populated lattice as the city, joined into a torus. Traffic, police and races run on
    // it (Stage D). The garage entrance is at the spawn, as in the city; its distance is measured the short way round.
    const network = buildLoopCityNetwork();
    const boundary = buildRoadBoundary(network);
    const periodMeters = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
    definition = {
      id,
      label: 'Veldmoor Loop (prototype)',
      network,
      boundary,
      spawn: { position: { ...network.spawn.position }, yawRadians: network.spawn.yawRadians },
      bounds: boundsOf(boundary),
      lanes: buildLaneGraph(network),
      trafficScenario: [],
      opponents: [],
      city: { scenery: buildLoopScenery(periodMeters, hillsideGroundFor(network)) },
      // Ambient traffic on the loop uses the same seed as the city. The loop has no scripted traffic yet.
      ambient: { seed: CITY_AMBIENT_SEED },
      devReset: null,
      garage: { position: { ...network.spawn.position } },
      periodMeters,
    };
  } else if (id === 'city') {
    const network = buildCityNetwork();
    const boundary = buildRoadBoundary(network);
    definition = {
      id,
      label: network.name,
      network,
      boundary,
      spawn: { position: { ...network.spawn.position }, yawRadians: network.spawn.yawRadians },
      bounds: boundsOf(boundary),
      lanes: buildLaneGraph(network),
      trafficScenario: CITY_TRAFFIC_SCENARIO,
      opponents: [],
      city: { scenery: buildCityScenery(undefined, hillsideGroundFor(network)) },
      ambient: { seed: CITY_AMBIENT_SEED },
      devReset: { position: { ...CITY_DEV_RESET.position }, yawRadians: CITY_DEV_RESET.yawRadians },
      garage: { position: { ...network.spawn.position } },
      periodMeters: null,
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
      lanes: buildLaneGraph(network),
      trafficScenario: CIRCUIT_TRAFFIC_SCENARIO,
      opponents: CIRCUIT_OPPONENT_SPECS,
      city: null,
      ambient: null,
      devReset: { position: { ...network.spawn.position }, yawRadians: network.spawn.yawRadians },
      garage: null,
      periodMeters: null,
    };
  }
  cache.set(id, definition);
  return definition;
}
