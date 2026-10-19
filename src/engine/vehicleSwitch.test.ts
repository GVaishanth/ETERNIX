import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG, type VehicleConfig } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { vehicleDefinition } from '../vehicles/catalogue';
import { deriveEffectiveSpecs, STOCK_UPGRADES } from '../vehicles/effectiveSpecs';
import { GameSimulation } from './gameSimulation';

const THROTTLE = { steer: 0, throttle: 1, brake: 0, handbrake: 0 } as const;

function runThrottle(sim: GameSimulation, seconds: number): void {
  const steps = Math.round(seconds / FIXED_STEP_SECONDS);
  for (let i = 0; i < steps; i += 1) sim.update(FIXED_STEP_SECONDS, THROTTLE);
}

function configOf(id: string): VehicleConfig {
  return deriveEffectiveSpecs(vehicleDefinition(id)!, STOCK_UPGRADES).config;
}

describe('switching the active vehicle in the simulation', () => {
  it('exposes the active config, and reports the base config at start', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    expect(sim.vehicleConfig).toBe(VEHICLE_CONFIG);
  });

  it('a switched car drives like a car built with that config from the start (no leftover state)', () => {
    const switched = new GameSimulation(VEHICLE_CONFIG);
    switched.setVehicleConfig(configOf('ember-gt'));
    const fresh = new GameSimulation(configOf('ember-gt'));
    runThrottle(switched, 4);
    runThrottle(fresh, 4);
    expect(switched.state.speed).toBeCloseTo(fresh.state.speed, 6);
    expect(switched.state.position.z).toBeCloseTo(fresh.state.position.z, 6);
  });

  it('a different car really goes a different distance under the same input', () => {
    const volt = new GameSimulation(configOf('volt-e'));
    const halcyon = new GameSimulation(configOf('halcyon-gt'));
    runThrottle(volt, 3);
    runThrottle(halcyon, 3);
    expect(volt.state.position.z).toBeGreaterThan(halcyon.state.position.z);
  });

  it('is a no-op when given the same config object', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    runThrottle(sim, 1);
    const before = { ...sim.state };
    sim.setVehicleConfig(VEHICLE_CONFIG);
    expect(sim.state).toEqual(before);
  });

  it('refuses a config with a different collision footprint, since traffic and pursuit read the base footprint', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    const bigger: VehicleConfig = { ...VEHICLE_CONFIG, footprintHalfWidthMeters: VEHICLE_CONFIG.footprintHalfWidthMeters + 0.1 };
    expect(() => sim.setVehicleConfig(bigger)).toThrow(/collision footprint/);
    expect(sim.vehicleConfig).toBe(VEHICLE_CONFIG);
  });

  it('clamps the speed to a lower top speed, so a switch cannot leave the car over the new cap', () => {
    const sim = new GameSimulation(configOf('zenith-one'));
    runThrottle(sim, 20);
    expect(sim.state.speed).toBeGreaterThan(configOf('kestrel-hatch').maxForwardSpeedMps);
    sim.setVehicleConfig(configOf('kestrel-hatch'));
    expect(sim.state.speed).toBeLessThanOrEqual(configOf('kestrel-hatch').maxForwardSpeedMps);
  });

  it('keeps the car where it is: the switch changes handling, not the pose', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    runThrottle(sim, 2);
    const pose = { ...sim.state.position };
    sim.setVehicleConfig(configOf('grit-coupe'));
    expect(sim.state.position).toEqual(pose);
  });
});
