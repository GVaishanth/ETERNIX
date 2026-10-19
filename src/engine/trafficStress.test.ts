import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { buildRoadBoundary } from '../simulation/roadBoundary';
import { buildCircuitNetwork, CIRCUIT_SPAWN } from '../world/circuitNetwork';
import { buildLaneGraph } from '../traffic/laneGraph';
import { createTrafficRuntime, playerFootprintFromConfig } from '../traffic/trafficRuntime';
import { CIRCUIT_OPPONENT_SPECS, CIRCUIT_TRAFFIC_SCENARIO } from '../traffic/trafficScenarios';
import { OpponentSystem } from '../ai/aiOpponents';
import { GameSimulation } from './gameSimulation';

/*
 * Stress and recycling (Part 4, test F). Three simulated minutes with the full scenario, traffic, and an opponent.
 * The pools must keep their size: no vehicle objects are created during the run, active counts stay within capacity,
 * recycling happens, and no state goes non-finite.
 */

describe('traffic stress and recycling', () => {
  it('keeps the pools bounded and recycles over three simulated minutes', () => {
    const network = buildCircuitNetwork();
    const graph = buildLaneGraph(network);
    const boundary = buildRoadBoundary(network);
    const traffic = createTrafficRuntime(network, graph, boundary, CIRCUIT_TRAFFIC_SCENARIO, playerFootprintFromConfig(VEHICLE_CONFIG));
    const opponents = new OpponentSystem(graph, boundary, CIRCUIT_OPPONENT_SPECS);
    const sim = new GameSimulation(VEHICLE_CONFIG, { spawn: CIRCUIT_SPAWN, boundary, traffic, opponents });
    const trafficPool = traffic.system.vehicles;
    const trafficCapacity = traffic.system.capacity;
    const opponentPool = opponents.opponents;
    const throttle = { steer: 0, throttle: 0.4, brake: 0, handbrake: 0 };
    let maxActive = 0;
    for (let step = 0; step < 60 * 180; step += 1) {
      sim.update(FIXED_STEP_SECONDS, throttle);
      if (step % 60 === 0) {
        maxActive = Math.max(maxActive, traffic.system.activeCount);
        for (const vehicle of traffic.system.vehicles) {
          if (vehicle.active) expect(Number.isFinite(vehicle.x) && Number.isFinite(vehicle.z)).toBe(true);
        }
      }
    }
    expect(traffic.system.vehicles).toBe(trafficPool);
    expect(traffic.system.vehicles.length).toBe(trafficCapacity);
    expect(opponents.opponents).toBe(opponentPool);
    expect(maxActive).toBeLessThanOrEqual(trafficCapacity);
    expect(traffic.system.stats.recycled + traffic.system.stats.stallRecycled).toBeGreaterThan(0);
    expect(traffic.system.stats.invalidTransitions).toBe(0);
    expect(Number.isFinite(sim.state.position.x) && Number.isFinite(sim.state.position.z)).toBe(true);
  });
});
