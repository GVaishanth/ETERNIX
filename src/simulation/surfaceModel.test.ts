/*
 * Dirt roads in the vehicle model. A dirt segment scales the speed and grip of the config the car is stepped with: 5%
 * when dry, 15% in rain, as a total. Asphalt, and a car with no segment, step with the config unchanged. The top speed
 * test runs the real stepVehicle, so the claim is about the car, not the scaling arithmetic.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { VEHICLE_CONFIG, type VehicleConfig } from '../config/vehicleConfig';
import { DIRT_DRY_REDUCTION, DIRT_WET_REDUCTION } from '../config/surfaceConfig';
import type { InputState } from '../core/types';
import { createVehicleState, stepVehicle } from './vehicle';
import { configOnSegment, dirtReduction, setSurfaceWetnessSource, vehicleOnDirt } from './surfaceModel';

const DT = 1 / 60;
const GAS: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };
const DIRT_SEGMENTS = { dirtSegments: new Set(['H-6-2']) };

beforeEach(() => setSurfaceWetnessSource(() => 0));

describe('dirt reduction', () => {
  it('is 5% dry and 15% in rain, and is linear between, never stacked', () => {
    expect(DIRT_DRY_REDUCTION).toBe(0.05);
    expect(DIRT_WET_REDUCTION).toBe(0.15);
    expect(dirtReduction(0)).toBeCloseTo(0.05, 12);
    expect(dirtReduction(1)).toBeCloseTo(0.15, 12);
    expect(dirtReduction(0.5)).toBeCloseTo(0.1, 12);
    // Wetness outside 0..1 is clamped, so the reduction never goes past the wet value.
    expect(dirtReduction(3)).toBeCloseTo(0.15, 12);
    expect(dirtReduction(-1)).toBeCloseTo(0.05, 12);
  });

  it('scales top speed, engine fade (which sets the top speed), and the lateral grip, and nothing else', () => {
    const scaled = vehicleOnDirt(VEHICLE_CONFIG, 0.05);
    expect(scaled.maxForwardSpeedMps).toBeCloseTo(VEHICLE_CONFIG.maxForwardSpeedMps * 0.95, 9);
    expect(scaled.engineFadeSpeedMps).toBeCloseTo(VEHICLE_CONFIG.engineFadeSpeedMps * 0.95, 9);
    expect(scaled.lateralGripPerSecond).toBeCloseTo(VEHICLE_CONFIG.lateralGripPerSecond * 0.95, 9);
    expect(scaled.maxLateralAccelerationMps2).toBeCloseTo(VEHICLE_CONFIG.maxLateralAccelerationMps2 * 0.95, 9);
    expect(scaled.wheelbaseMeters).toBe(VEHICLE_CONFIG.wheelbaseMeters);
    expect(scaled.engineAccelerationMps2).toBe(VEHICLE_CONFIG.engineAccelerationMps2);
  });
});

describe('configOnSegment', () => {
  it('returns asphalt, and a car with no segment, unchanged', () => {
    expect(configOnSegment(VEHICLE_CONFIG, DIRT_SEGMENTS, 'H-7-2')).toBe(VEHICLE_CONFIG);
    expect(configOnSegment(VEHICLE_CONFIG, DIRT_SEGMENTS, null)).toBe(VEHICLE_CONFIG);
    expect(configOnSegment(VEHICLE_CONFIG, null, 'H-6-2')).toBe(VEHICLE_CONFIG);
  });

  it('gives the dry penalty on dirt, and the wet penalty in rain, not both', () => {
    const dry = configOnSegment(VEHICLE_CONFIG, DIRT_SEGMENTS, 'H-6-2');
    expect(dry.maxForwardSpeedMps).toBeCloseTo(VEHICLE_CONFIG.maxForwardSpeedMps * 0.95, 9);
    setSurfaceWetnessSource(() => 1);
    const wet = configOnSegment(VEHICLE_CONFIG, DIRT_SEGMENTS, 'H-6-2');
    expect(wet.maxForwardSpeedMps).toBeCloseTo(VEHICLE_CONFIG.maxForwardSpeedMps * 0.85, 9);
    expect(wet.lateralGripPerSecond).toBeCloseTo(VEHICLE_CONFIG.lateralGripPerSecond * 0.85, 9);
  });

  it('caches the scaled config, so a step on dirt allocates nothing new', () => {
    const a = configOnSegment(VEHICLE_CONFIG, DIRT_SEGMENTS, 'H-6-2');
    const b = configOnSegment(VEHICLE_CONFIG, DIRT_SEGMENTS, 'H-6-2');
    expect(a).toBe(b);
  });
});

describe('top speed on dirt, with the real vehicle model', () => {
  /** Full throttle on the flat for `seconds`, with the config given. Returns the speed at the end. */
  function topSpeedAfter(config: VehicleConfig, seconds: number): number {
    let state = { ...createVehicleState({ x: 0, y: 0, z: 0 }, 0), speed: 0 };
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i += 1) state = stepVehicle(state, GAS, config, DT, 0);
    return state.speed;
  }

  it('the dirt top speed is 5% below asphalt, dry', () => {
    const asphalt = topSpeedAfter(VEHICLE_CONFIG, 150);
    const dirt = topSpeedAfter(configOnSegment(VEHICLE_CONFIG, DIRT_SEGMENTS, 'H-6-2'), 150);
    expect(asphalt).toBeGreaterThan(20);
    expect(dirt / asphalt).toBeGreaterThan(0.94);
    expect(dirt / asphalt).toBeLessThan(0.96);
  }, 60_000);
});
