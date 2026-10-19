import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { VEHICLE_CATALOGUE, type VehicleDefinition } from '../config/vehicleCatalogue';
import { SPEC_LIMITS, TUNABLE_SPEC_KEYS } from '../config/specLimits';
import { STARTER_VEHICLE_ID, startingVehicleIds, validateCatalogue, vehicleDefinition } from './catalogue';
import { deriveEffectiveSpecs, STOCK_UPGRADES } from './effectiveSpecs';
import { createVehicleState, stepVehicle } from '../simulation/vehicle';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';

describe('vehicle catalogue data', () => {
  it('passes validation on the real data', () => {
    expect(validateCatalogue()).toEqual([]);
  });

  it('has exactly 32 vehicles with stable, unique ids, in roster order 01 to 32', () => {
    expect(VEHICLE_CATALOGUE.length).toBe(32);
    const ids = VEHICLE_CATALOGUE.map((vehicle) => vehicle.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'kestrel-hatch', 'vesper-c2', 'rook-rs', 'ember-gt', 'strata-s',
      'vandal-r', 'halcyon-gt', 'kestrel-mr', 'grit-coupe', 'meridian-xr',
      'phantom-lx', 'apex-t', 'volt-e', 'bastion-sedan', 'tarn-roadster',
      'obsidian-x', 'tempest-r', 'havoc-awd', 'solstice-lm', 'zenith-one',
      'granite-xc', 'ironpeak-pk', 'dustline-rx', 'stonefox-cx',
      'astra-f1', 'vector-gp', 'monolith-ix', 'sparrow-f2',
      'monarch-68', 'copperhead-v8', 'riviera-sprint', 'bracken-rr',
    ]);
    expect(VEHICLE_CATALOGUE.map((vehicle) => vehicle.roster)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
  });

  it('shows the roster display names (legacy ids are kept, names are new)', () => {
    expect(VEHICLE_CATALOGUE.map((vehicle) => vehicle.name)).toEqual([
      'Finch S1', 'Vesper C2', 'Rook RS', 'Ember GT', 'Strata S',
      'Vandal R', 'Nightfall GT', 'Kestrel MR', 'Talon V8', 'Meridian XR',
      'Phantom LX', 'Apex T', 'Voltaris E', 'Sovereign S', 'Zephyr R',
      'Obsidian X', 'Tempest R', 'Havoc AWD', 'Solstice LM', 'Zenith One',
      'Granite XC', 'Ironpeak P1', 'Dustline RX', 'Stonefox CX',
      'Astra F-One', 'Vector GP', 'Monolith IX', 'Sparrow F2',
      'Monarch 68', 'Copperhead V8', 'Riviera Sprint', 'Bracken RR',
    ]);
  });

  it('starts with the factory starter car, which has no handling overrides', () => {
    expect(STARTER_VEHICLE_ID).toBe('kestrel-hatch');
    const starter = vehicleDefinition(STARTER_VEHICLE_ID);
    expect(starter?.startsOwned).toBe(true);
    expect(starter?.priceCredits).toBe(0);
    expect(starter?.handling).toEqual({});
    expect(startingVehicleIds()).toEqual([STARTER_VEHICLE_ID]);
  });

  it('gives the starter car the exact base tuning, so the existing game feel is unchanged', () => {
    const stock = deriveEffectiveSpecs(vehicleDefinition(STARTER_VEHICLE_ID)!, STOCK_UPGRADES).config;
    expect(stock).toEqual(VEHICLE_CONFIG);
  });

  it('keeps every catalogue handling override within the limits, without clamping', () => {
    for (const vehicle of VEHICLE_CATALOGUE) {
      for (const key of Object.keys(vehicle.handling) as (keyof typeof vehicle.handling)[]) {
        const value = vehicle.handling[key];
        if (typeof value !== 'number') continue;
        const limit = SPEC_LIMITS[key as (typeof TUNABLE_SPEC_KEYS)[number]];
        expect(value, `${vehicle.id}.${key}`).toBeGreaterThanOrEqual(limit.min);
        expect(value, `${vehicle.id}.${key}`).toBeLessThanOrEqual(limit.max);
      }
    }
  });

  it('gives every tunable key a limit', () => {
    for (const key of TUNABLE_SPEC_KEYS) {
      expect(SPEC_LIMITS[key].min).toBeLessThan(SPEC_LIMITS[key].max);
    }
  });

  it('never gives a vehicle a dimension or footprint override (collision must stay shared)', () => {
    const dimensionKeys = ['wheelbaseMeters', 'bodyLengthMeters', 'footprintRearMeters', 'footprintFrontMeters', 'footprintHalfWidthMeters'];
    for (const vehicle of VEHICLE_CATALOGUE) {
      for (const key of dimensionKeys) {
        expect(Object.keys(vehicle.handling)).not.toContain(key);
      }
    }
  });

  it('reports a bad catalogue entry instead of accepting it', () => {
    const good = VEHICLE_CATALOGUE[0] as VehicleDefinition;
    const broken: VehicleDefinition[] = [
      good,
      { ...good, name: 'Copy' },
      { ...VEHICLE_CATALOGUE[1]!, id: 'kestrel-hatch' },
      { ...VEHICLE_CATALOGUE[1]!, id: 'bad-price' as VehicleDefinition['id'], priceCredits: -5 },
      { ...VEHICLE_CATALOGUE[1]!, id: 'too-fast' as VehicleDefinition['id'], handling: { maxForwardSpeedMps: 500 } },
      { ...VEHICLE_CATALOGUE[1]!, id: 'bad-key' as VehicleDefinition['id'], handling: { wheelbaseMeters: 3 } as never },
    ];
    const issues = validateCatalogue(broken).join('\n');
    expect(issues).toMatch(/duplicate id/);
    expect(issues).toMatch(/price must be a whole number/);
    expect(issues).toMatch(/outside limits/);
    expect(issues).toMatch(/not a tunable handling key/);
  });
});

describe('catalogue handling changes real driving', () => {
  /** Full throttle for `seconds` from rest, using the real controller. */
  function speedAfterThrottle(config: typeof VEHICLE_CONFIG, seconds: number): number {
    let state = createVehicleState({ x: 0, y: 0, z: 0 }, 0);
    const steps = Math.round(seconds / FIXED_STEP_SECONDS);
    for (let i = 0; i < steps; i += 1) {
      state = stepVehicle(state, { steer: 0, throttle: 1, brake: 0, handbrake: 0 }, config, FIXED_STEP_SECONDS);
    }
    return state.speed;
  }

  it('gives each non-starter vehicle a different 0 to 4 s speed from the same controller', () => {
    const speeds = VEHICLE_CATALOGUE.map((vehicle) => speedAfterThrottle(deriveEffectiveSpecs(vehicle, STOCK_UPGRADES).config, 4));
    expect(new Set(speeds.map((value) => value.toFixed(3))).size).toBe(VEHICLE_CATALOGUE.length);
  });

  it('shows a real crossover: the Voltaris E leads off the line, and the Zenith One leads once its higher top speed matters', () => {
    const volt = deriveEffectiveSpecs(vehicleDefinition('volt-e')!, STOCK_UPGRADES).config;
    const zenith = deriveEffectiveSpecs(vehicleDefinition('zenith-one')!, STOCK_UPGRADES).config;
    expect(speedAfterThrottle(volt, 3)).toBeGreaterThan(speedAfterThrottle(zenith, 3));
    expect(speedAfterThrottle(zenith, 15)).toBeGreaterThan(speedAfterThrottle(volt, 15));
    expect(speedAfterThrottle(zenith, 25)).toBeGreaterThan(speedAfterThrottle(volt, 25));
  });
});
