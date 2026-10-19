/*
 * Per-car driving checks on the real vehicle integrator (stepVehicle), using each car's effective config.
 * Each car is driven from rest for 0-100 km/h, held to its top speed, and braked from 25 m/s to a stop.
 * These are simulation checks. The in-browser checks are in tools/browser-cars.py.
 */
import { describe, expect, it } from 'vitest';
import { VEHICLE_CATALOGUE, type VehicleDefinition } from '../config/vehicleCatalogue';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { createVehicleState, stepVehicle } from '../simulation/vehicle';
import { deriveEffectiveSpecs, STOCK_UPGRADES } from './effectiveSpecs';
import type { VehicleConfig } from '../config/vehicleConfig';

const HUNDRED_KPH = 100 / 3.6;
type VehicleState = ReturnType<typeof createVehicleState>;

export interface DrivingMetrics {
  readonly name: string;
  readonly tier: string;
  readonly zeroToHundredKphSeconds: number | null;
  readonly topSpeedMps: number;
  readonly brakeDistanceMeters: number | null;
}

function configFor(vehicle: VehicleDefinition): VehicleConfig {
  return deriveEffectiveSpecs(vehicle, STOCK_UPGRADES).config;
}

/** Full throttle from rest until 100 km/h, or until the time limit. */
function zeroToHundred(config: VehicleConfig): number | null {
  let state: VehicleState = createVehicleState({ x: 0, y: 0, z: 0 }, 0);
  for (let i = 0; i < Math.round(60 / FIXED_STEP_SECONDS); i += 1) {
    state = stepVehicle(state, { steer: 0, throttle: 1, brake: 0, handbrake: 0 }, config, FIXED_STEP_SECONDS);
    if (state.speed >= HUNDRED_KPH) return (i + 1) * FIXED_STEP_SECONDS;
  }
  return null;
}

/** Full throttle for 60 s, then the speed reached. */
function topSpeed(config: VehicleConfig): number {
  let state: VehicleState = createVehicleState({ x: 0, y: 0, z: 0 }, 0);
  for (let i = 0; i < Math.round(60 / FIXED_STEP_SECONDS); i += 1) {
    state = stepVehicle(state, { steer: 0, throttle: 1, brake: 0, handbrake: 0 }, config, FIXED_STEP_SECONDS);
  }
  return state.speed;
}

/** Hard brake from 25 m/s until the car is stopped. Returns the distance, or null if it never stops in 30 s. */
function brakeFrom25(config: VehicleConfig): number | null {
  let state: VehicleState = createVehicleState({ x: 0, y: 0, z: 0 }, 0);
  // Reach 25 m/s first, then brake with no throttle.
  while (state.speed < 25 && state.position.z < 5000) {
    state = stepVehicle(state, { steer: 0, throttle: 1, brake: 0, handbrake: 0 }, config, FIXED_STEP_SECONDS);
  }
  const startZ = state.position.z;
  for (let i = 0; i < Math.round(30 / FIXED_STEP_SECONDS); i += 1) {
    state = stepVehicle(state, { steer: 0, throttle: 0, brake: 1, handbrake: 0 }, config, FIXED_STEP_SECONDS);
    if (Math.abs(state.speed) < 0.05) return Math.abs(state.position.z - startZ);
  }
  return null;
}

export function drivingMetrics(vehicle: VehicleDefinition): DrivingMetrics {
  const config = configFor(vehicle);
  return {
    name: vehicle.name,
    tier: vehicle.tier,
    zeroToHundredKphSeconds: zeroToHundred(config),
    topSpeedMps: topSpeed(config),
    brakeDistanceMeters: brakeFrom25(config),
  };
}

const ALL = VEHICLE_CATALOGUE.map((vehicle) => drivingMetrics(vehicle));
const TIERS = ['starter', 'street', 'advanced', 'elite', 'ultimate'] as const;

describe('per-car driving (simulation)', () => {
  it('every car reaches 100 km/h, and every car stops from 25 m/s', () => {
    for (const m of ALL) {
      expect(m.zeroToHundredKphSeconds, m.name).not.toBeNull();
      expect(m.brakeDistanceMeters, m.name).not.toBeNull();
      expect(Number.isFinite(m.topSpeedMps), m.name).toBe(true);
    }
  });

  it('the starter is the slowest 0-100; the ultimate car is within 0.5 s of the quickest (the Voltaris E trades top speed for launch)', () => {
    const times = ALL.map((m) => m.zeroToHundredKphSeconds ?? Infinity);
    expect(times[0]).toBe(Math.max(...times));
    expect(times[19]! - Math.min(...times)).toBeLessThanOrEqual(0.5);
  });

  it('the average 0-100 time improves tier by tier (starter to ultimate)', () => {
    const avg = (tier: string) => {
      const list = ALL.filter((m) => m.tier === tier).map((m) => m.zeroToHundredKphSeconds ?? 0);
      return list.reduce((a, b) => a + b, 0) / list.length;
    };
    const means = TIERS.map(avg);
    for (let i = 1; i < means.length; i += 1) expect(means[i]).toBeLessThan(means[i - 1]!);
  });

  it('the Zenith One (original roster, 01 to 20) is strongest overall: highest top speed and shortest braking distance', () => {
    // Scoped to the original 20: the 12 added ground cars are also ultimate tier and tie Zenith on some metric.
    const original = ALL.slice(0, 20);
    const top = original.map((m) => m.topSpeedMps);
    expect(top[19]).toBe(Math.max(...top));
    const brake = original.map((m) => m.brakeDistanceMeters ?? Infinity);
    expect(brake[19]).toBe(Math.min(...brake));
  });

  it('stats are not all scaled alike: acceleration rank and braking rank differ for at least one pair', () => {
    const accelOrder = [...ALL].sort((a, b) => (a.zeroToHundredKphSeconds ?? 0) - (b.zeroToHundredKphSeconds ?? 0)).map((m) => m.name);
    const brakeOrder = [...ALL].sort((a, b) => (a.brakeDistanceMeters ?? 0) - (b.brakeDistanceMeters ?? 0)).map((m) => m.name);
    expect(accelOrder).not.toEqual(brakeOrder);
  });
});
