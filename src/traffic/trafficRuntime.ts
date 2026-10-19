import type { LaneGraph } from './laneGraph';
import { AmbientTrafficGenerator, type AmbientOptions } from './trafficAmbient';
import { TrafficSpawner } from './trafficSpawner';
import { TrafficSystem, type PlayerFootprint, type SpawnRequest } from './trafficSystem';
import type { VehicleConfig } from '../config/vehicleConfig';
import type { RoadBoundary } from '../simulation/roadBoundary';
import type { RoadNetwork } from '../world/roadTypes';

/** The traffic population and its spawn scheduler, owned by GameSimulation. */
export interface TrafficRuntime {
  readonly system: TrafficSystem;
  readonly spawner: TrafficSpawner;
}

/** `?traffic=off` disables traffic in any world. Any other value, or no value, leaves traffic on. */
export function isTrafficEnabled(search: string): boolean {
  return new URLSearchParams(search).get('traffic') !== 'off';
}

/** The player's footprint as traffic sees it: the nose is the front of the vehicle. */
export function playerFootprintFromConfig(config: VehicleConfig): PlayerFootprint {
  return {
    rearMeters: config.footprintRearMeters,
    noseMeters: config.footprintFrontMeters,
    halfWidthMeters: config.footprintHalfWidthMeters,
  };
}

export function createTrafficRuntime(
  network: RoadNetwork,
  graph: LaneGraph,
  boundary: RoadBoundary | null,
  requests: readonly SpawnRequest[],
  playerFootprint: PlayerFootprint,
  ambient: AmbientOptions | null = null,
): TrafficRuntime {
  return {
    system: new TrafficSystem(network, graph, boundary, { playerFootprint }),
    spawner: new TrafficSpawner(requests, ambient ? new AmbientTrafficGenerator(graph, ambient) : null),
  };
}
