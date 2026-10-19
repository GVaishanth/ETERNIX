import { describe, expect, it } from 'vitest';
import { applyPaint, createDefaultGarage, purchaseUpgrade, purchaseVehicle, selectVehicle, type GarageState } from './garageModel';
import { activePaint, activeSpecs, memoSizeForTests, specsForVehicle } from './activeVehicle';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';

function must(result: ReturnType<typeof purchaseVehicle>): GarageState {
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

describe('active vehicle specs', () => {
  it('the starter with no upgrades drives the factory base config', () => {
    expect(activeSpecs(createDefaultGarage()).config).toEqual(VEHICLE_CONFIG);
  });

  it('returns the same config object for the same handling, so a paint change never resets the car', () => {
    let garage = must(purchaseVehicle({ ...createDefaultGarage(), credits: 9000 }, 'ember-gt'));
    garage = must(selectVehicle(garage, 'ember-gt'));
    const before = activeSpecs(garage).config;
    const painted = must(applyPaint(garage, 'ember-gt', 'midnight'));
    expect(activeSpecs(painted).config).toBe(before);
  });

  it('returns a new config when an upgrade changes the handling', () => {
    let garage = must(purchaseVehicle({ ...createDefaultGarage(), credits: 9000 }, 'ember-gt'));
    garage = must(selectVehicle(garage, 'ember-gt'));
    const before = activeSpecs(garage).config;
    const upgraded = must(purchaseUpgrade(garage, 'ember-gt', 'engine'));
    const after = activeSpecs(upgraded).config;
    expect(after).not.toBe(before);
    expect(after.engineAccelerationMps2).toBeGreaterThan(before.engineAccelerationMps2);
  });

  it('follows the selected car, and falls back to the starter if the selection is not owned', () => {
    const garage = createDefaultGarage();
    const broken: GarageState = { ...garage, selectedVehicleId: 'halcyon-gt' };
    expect(activeSpecs(broken).vehicleId).toBe('kestrel-hatch');
  });

  it('reports the paint of the selected car, and the factory paint when none is stored', () => {
    expect(activePaint(createDefaultGarage())).toBe('cherry');
    const bare: GarageState = { ...createDefaultGarage(), vehicles: {} };
    expect(activePaint(bare)).toBe('cherry');
  });

  it('memoizes by vehicle and tiers: repeated reads do not grow the cache', () => {
    const garage = createDefaultGarage();
    specsForVehicle('kestrel-hatch', garage);
    const size = memoSizeForTests();
    for (let i = 0; i < 50; i += 1) specsForVehicle('kestrel-hatch', garage);
    expect(memoSizeForTests()).toBe(size);
  });
});
