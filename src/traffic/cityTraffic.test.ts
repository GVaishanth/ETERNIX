import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { laneSample, type LanePath } from './laneGraph';
import { findRouteThrough } from './lanePlanner';
import { createTrafficRuntime, playerFootprintFromConfig, type TrafficRuntime } from './trafficRuntime';
import { getWorldDefinition } from '../world/worlds';
import { CITY_CELL_DISTRICTS, type DistrictId } from '../world/city/cityLayout';

/*
 * Traffic on the city (Part 5, test C traffic and test F). The player drives a planned route through all four districts
 * and the highway, at 12 m/s, and the traffic system runs with the city's scenario and ambient generator. Every step is
 * checked: no non-finite state, no teleports, no lane changes, a bounded population, and no permanent stall.
 */

const PLAYER_SPEED_MPS = 12;
const RUN_SECONDS = 240;
const ROUTE_WAYPOINTS = ['H-0-2:F:0', 'H-2-0:F:0', 'V-4-1:F:0', 'H-1-4:R:0', 'V-0-0:F:0'] as const;

function districtAt(x: number, z: number): DistrictId | null {
  const i = Math.floor((x + 400) / 200);
  const j = Math.floor((z + 400) / 200);
  if (i < 0 || j < 0 || i > 3 || j > 3) return null;
  return CITY_CELL_DISTRICTS[j]?.[i] ?? null;
}

interface RunResult {
  traffic: TrafficRuntime;
  districts: Set<DistrictId>;
  highwayLanesSeen: number;
  lanesSeen: Set<string>;
  teleports: number;
  laneChanges: number;
  maxStopped: number;
  maxActive: number;
  activeSum: number;
  steps: number;
  finite: boolean;
  routeDistricts: Set<DistrictId>;
}

/** Runs the same stepping order as GameSimulation: spawner tick, then traffic step, with a driven player pose. */
function runCity(): RunResult {
  const world = getWorldDefinition('city');
  const graph = world.lanes;
  const network = world.network;
  const boundary = world.boundary;
  if (!graph || !network || !boundary) throw new Error('city world incomplete');
  const routeIds = findRouteThrough(graph, [...ROUTE_WAYPOINTS]);
  if (!routeIds) throw new Error('no planned route through the city');
  const route = routeIds.map((id) => graph.byId.get(id) as LanePath);
  const routeDistricts = new Set<DistrictId>();
  for (const lane of route) {
    const mid = laneSample(lane, lane.lengthMeters / 2);
    const district = districtAt(mid.x, mid.z);
    if (district) routeDistricts.add(district);
  }

  const traffic = createTrafficRuntime(network, graph, boundary, world.trafficScenario, playerFootprintFromConfig(VEHICLE_CONFIG), world.ambient);
  const districts = new Set<DistrictId>();
  const lanesSeen = new Set<string>();
  let highwayLanesSeen = 0;
  let teleports = 0;
  let laneChanges = 0;
  let maxStopped = 0;
  let maxActive = 0;
  let activeSum = 0;
  let finite = true;
  const previous = new Map<number, { x: number; z: number; generation: number; laneIndex: string | null; speed: number }>();

  let routeIndex = 0;
  let along = 0;
  const steps = Math.round(RUN_SECONDS / FIXED_STEP_SECONDS);
  for (let step = 0; step < steps; step += 1) {
    along += PLAYER_SPEED_MPS * FIXED_STEP_SECONDS;
    while (routeIndex < route.length - 1 && along >= (route[routeIndex]?.lengthMeters ?? 0)) {
      along -= route[routeIndex]?.lengthMeters ?? 0;
      routeIndex += 1;
    }
    const lane = route[routeIndex] ?? route[route.length - 1];
    if (!lane) throw new Error('empty route');
    const p = laneSample(lane, Math.min(along, lane.lengthMeters));
    const pose = { x: p.x, z: p.z, yaw: p.heading, speed: PLAYER_SPEED_MPS };

    traffic.spawner.tick(traffic.system, pose, FIXED_STEP_SECONDS);
    traffic.system.step(FIXED_STEP_SECONDS, pose);

    let active = 0;
    for (const vehicle of traffic.system.vehicles) {
      if (!vehicle.active) continue;
      active += 1;
      if (!Number.isFinite(vehicle.x) || !Number.isFinite(vehicle.z) || !Number.isFinite(vehicle.speed)) finite = false;
      const laneIndex = vehicle.laneId ? (vehicle.laneId.split(':').pop() ?? null) : null;
      const last = previous.get(vehicle.id);
      if (last && last.generation === vehicle.generation) {
        // Farthest a vehicle can move in one fixed step at the faster of its two speeds, with a generous margin.
        const reach = Math.max(last.speed, vehicle.speed, 0) * FIXED_STEP_SECONDS * 2 + 0.5;
        if (Math.hypot(vehicle.x - last.x, vehicle.z - last.z) > reach) teleports += 1;
        if (laneIndex !== null && last.laneIndex !== null && laneIndex !== last.laneIndex) laneChanges += 1;
      }
      previous.set(vehicle.id, { x: vehicle.x, z: vehicle.z, generation: vehicle.generation, laneIndex, speed: vehicle.speed });
      if (vehicle.laneId) lanesSeen.add(vehicle.laneId);
      if (vehicle.laneId?.startsWith('V-4-')) highwayLanesSeen += 1;
      const district = districtAt(vehicle.x, vehicle.z);
      if (district) districts.add(district);
      maxStopped = Math.max(maxStopped, vehicle.stoppedSeconds);
    }
    maxActive = Math.max(maxActive, active);
    activeSum += active;
  }

  return {
    traffic,
    districts,
    highwayLanesSeen,
    lanesSeen,
    teleports,
    laneChanges,
    maxStopped,
    maxActive,
    activeSum,
    steps,
    finite,
    routeDistricts,
  };
}

describe('traffic across the city (test C traffic, test F)', () => {
  const result = runCity();

  it('plans a route that passes through all four districts and the highway', () => {
    expect(result.routeDistricts.size).toBe(4);
  });

  it('spreads vehicles across all four districts and the highway', () => {
    expect(result.districts.size).toBe(4);
    expect(result.highwayLanesSeen).toBeGreaterThan(0);
    expect(result.lanesSeen.size).toBeGreaterThan(40);
  });

  it('never produces non-finite state', () => {
    expect(result.finite).toBe(true);
  });

  it('never teleports a vehicle and never changes its lane index', () => {
    expect(result.teleports).toBe(0);
    expect(result.laneChanges).toBe(0);
    expect(result.traffic.system.stats.invalidTransitions).toBe(0);
  });

  it('keeps the population bounded by the pool and keeps it populated', () => {
    expect(result.traffic.system.vehicles).toHaveLength(result.traffic.system.capacity);
    expect(result.maxActive).toBeLessThanOrEqual(result.traffic.system.capacity);
    expect(result.activeSum / result.steps).toBeGreaterThan(3);
    expect(result.traffic.system.stats.spawned).toBeGreaterThan(20);
  });

  it('has no permanent stall: no vehicle stays stopped for the full recycle time', () => {
    expect(result.maxStopped).toBeLessThan(TRAFFIC_CONFIG.obstacle.stallRecycleSeconds);
  });

  it('is deterministic: the same route and seed give the same spawn statistics', () => {
    const again = runCity();
    expect(again.traffic.system.stats.spawned).toBe(result.traffic.system.stats.spawned);
    expect(again.traffic.system.stats.recycled).toBe(result.traffic.system.stats.recycled);
    expect(again.traffic.spawner.ambientDropped).toBe(result.traffic.spawner.ambientDropped);
  });
});
