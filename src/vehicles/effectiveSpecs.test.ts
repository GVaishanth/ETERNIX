import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { SPEC_LIMITS, TUNABLE_SPEC_KEYS } from '../config/specLimits';
import { MAX_UPGRADE_TIER, UPGRADE_CATEGORIES, type UpgradeCategory } from '../config/upgradeConfig';
import type { VehicleDefinition } from '../config/vehicleCatalogue';
import { vehicleDefinition } from './catalogue';
import { baseConfigFor, deriveEffectiveSpecs, formatSpecValue, specRows, STOCK_UPGRADES, type InstalledUpgrades } from './effectiveSpecs';

const ember = vehicleDefinition('ember-gt')!;
const starter = vehicleDefinition('kestrel-hatch')!;

function tiers(partial: Partial<Record<UpgradeCategory, number>>): InstalledUpgrades {
  return { ...STOCK_UPGRADES, ...partial };
}

describe('effective-spec pipeline', () => {
  it('is deterministic: the same input gives the same numbers', () => {
    const a = deriveEffectiveSpecs(ember, tiers({ engine: 2, brakes: 3 })).config;
    const b = deriveEffectiveSpecs(ember, tiers({ engine: 2, brakes: 3 })).config;
    expect(a).toEqual(b);
  });

  it('never writes to the base config or the catalogue data', () => {
    const before = JSON.stringify(VEHICLE_CONFIG);
    const handlingBefore = JSON.stringify(ember.handling);
    deriveEffectiveSpecs(ember, tiers({ engine: 3, transmission: 3, tires: 3, brakes: 3 }));
    expect(JSON.stringify(VEHICLE_CONFIG)).toBe(before);
    expect(JSON.stringify(ember.handling)).toBe(handlingBefore);
  });

  it('returns a frozen config, so a caller cannot change the active car by accident', () => {
    const config = deriveEffectiveSpecs(starter, STOCK_UPGRADES).config;
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('keeps dimensions and the collision footprint identical to the base for every tier combination', () => {
    const dims = ['wheelbaseMeters', 'bodyLengthMeters', 'footprintRearMeters', 'footprintFrontMeters', 'footprintHalfWidthMeters', 'wallTangentialRetentionPerStep'] as const;
    for (const level of [0, 1, 3]) {
      const config = deriveEffectiveSpecs(ember, tiers({ engine: level, transmission: level, tires: level, brakes: level })).config;
      for (const key of dims) expect(config[key]).toBe(VEHICLE_CONFIG[key]);
    }
  });

  it('applies an upgrade as a multiplier on the vehicle value (engine tier 1 = 6 percent more pull)', () => {
    const stock = deriveEffectiveSpecs(ember, STOCK_UPGRADES).config;
    const tier1 = deriveEffectiveSpecs(ember, tiers({ engine: 1 })).config;
    expect(tier1.engineAccelerationMps2).toBeCloseTo(stock.engineAccelerationMps2 * 1.06, 10);
  });

  it('gives each category real effect on the keys it claims to change', () => {
    const stock = deriveEffectiveSpecs(ember, STOCK_UPGRADES).config;
    const grip = deriveEffectiveSpecs(ember, tiers({ tires: 3 })).config;
    const brakes = deriveEffectiveSpecs(ember, tiers({ brakes: 3 })).config;
    expect(grip.lateralGripPerSecond).toBeGreaterThan(stock.lateralGripPerSecond);
    expect(grip.maxLateralAccelerationMps2).toBeGreaterThan(stock.maxLateralAccelerationMps2);
    expect(brakes.brakeDecelerationMps2).toBeGreaterThan(stock.brakeDecelerationMps2);
    expect(brakes.handbrakeDecelerationMps2).toBeGreaterThan(stock.handbrakeDecelerationMps2);
  });

  it('trades transmission: higher top speed for slightly less initial pull', () => {
    const stock = deriveEffectiveSpecs(ember, STOCK_UPGRADES).config;
    const geared = deriveEffectiveSpecs(ember, tiers({ transmission: 3 })).config;
    expect(geared.maxForwardSpeedMps).toBeGreaterThan(stock.maxForwardSpeedMps);
    expect(geared.engineAccelerationMps2).toBeLessThan(stock.engineAccelerationMps2);
  });

  it('clamps every value to its limit, and reports which keys it clamped', () => {
    const extreme: VehicleDefinition = {
      ...ember,
      id: 'ember-gt',
      handling: { ...ember.handling, maxForwardSpeedMps: 200, lateralGripPerSecond: 99 },
    };
    const result = deriveEffectiveSpecs(extreme, tiers({ transmission: 3, tires: 3 }));
    expect(result.config.maxForwardSpeedMps).toBe(SPEC_LIMITS.maxForwardSpeedMps.max);
    expect(result.config.lateralGripPerSecond).toBe(SPEC_LIMITS.lateralGripPerSecond.max);
    expect(result.clamped).toEqual(expect.arrayContaining(['maxForwardSpeedMps', 'lateralGripPerSecond']));
    for (const key of TUNABLE_SPEC_KEYS) {
      expect(result.config[key]).toBeGreaterThanOrEqual(SPEC_LIMITS[key].min);
      expect(result.config[key]).toBeLessThanOrEqual(SPEC_LIMITS[key].max);
    }
  });

  it('keeps the engine fade above the top speed (an invariant, reported when corrected)', () => {
    const odd: VehicleDefinition = { ...starter, handling: { maxForwardSpeedMps: 76, engineFadeSpeedMps: 60 } };
    const result = deriveEffectiveSpecs(odd, STOCK_UPGRADES);
    expect(result.config.engineFadeSpeedMps).toBeGreaterThanOrEqual(result.config.maxForwardSpeedMps + 5);
    expect(result.adjustments.join(' ')).toMatch(/fade raised/);
  });

  it('ignores an upgrade the vehicle does not support, and reports it', () => {
    const grit = vehicleDefinition('grit-coupe')!;
    const result = deriveEffectiveSpecs(grit, tiers({ tires: 3 }));
    expect(result.ignoredUpgrades).toEqual(['tires']);
    expect(result.config.lateralGripPerSecond).toBe(grit.handling.lateralGripPerSecond);
  });

  it('ignores an out-of-range tier instead of applying it', () => {
    const bad = deriveEffectiveSpecs(ember, { ...STOCK_UPGRADES, engine: MAX_UPGRADE_TIER + 1 });
    expect(bad.ignoredUpgrades).toEqual(['engine']);
    expect(bad.config.engineAccelerationMps2).toBe(baseConfigFor(ember).engineAccelerationMps2);
    const fractional = deriveEffectiveSpecs(ember, { ...STOCK_UPGRADES, brakes: 1.5 });
    expect(fractional.ignoredUpgrades).toEqual(['brakes']);
  });

  it('stock tiers reproduce the vehicle handling exactly', () => {
    const stock = deriveEffectiveSpecs(ember, STOCK_UPGRADES).config;
    expect(stock.engineAccelerationMps2).toBe(ember.handling.engineAccelerationMps2);
    expect(stock.maxForwardSpeedMps).toBe(ember.handling.maxForwardSpeedMps);
  });

  it('the upgrade categories are the four in the brief', () => {
    expect([...UPGRADE_CATEGORIES]).toEqual(['engine', 'transmission', 'tires', 'brakes']);
  });
});

describe('spec display rows', () => {
  it('derive from the config, so the garage shows what the controller runs', () => {
    const config = deriveEffectiveSpecs(ember, tiers({ engine: 3 })).config;
    const rows = specRows(config);
    const acceleration = rows.find((row) => row.key === 'engine');
    expect(acceleration?.value).toBe(config.engineAccelerationMps2);
    const top = rows.find((row) => row.key === 'topSpeed');
    expect(top?.value).toBeCloseTo(config.maxForwardSpeedMps * 3.6, 10);
    expect(formatSpecValue(top!)).toMatch(/km\/h$/);
  });
});
