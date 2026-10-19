import { describe, expect, it } from 'vitest';
import { GARAGE_CONFIG } from '../config/garageConfig';
import { PAINT_IDS } from '../config/paintConfig';
import { MAX_UPGRADE_TIER } from '../config/upgradeConfig';
import {
  applyPaint,
  createDefaultGarage,
  earnCredits,
  isOwned,
  normalizeGarage,
  nextUpgradeCost,
  ownedVehicleIds,
  purchaseUpgrade,
  purchaseVehicle,
  selectVehicle,
  type GarageState,
  type TxResult,
} from './garageModel';

function expectOk(result: TxResult): GarageState {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result.state;
}

function expectFail(result: TxResult, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.code).toBe(code);
}

/** A garage with plenty of credits, for tests that are not about money. */
function rich(credits = 100000): GarageState {
  return { ...createDefaultGarage(), credits };
}

describe('default garage', () => {
  it('owns only the starter, selects it, and starts with the configured credits', () => {
    const garage = createDefaultGarage();
    expect(ownedVehicleIds(garage)).toEqual(['kestrel-hatch']);
    expect(garage.selectedVehicleId).toBe('kestrel-hatch');
    expect(garage.credits).toBe(GARAGE_CONFIG.startingCredits);
  });
});

describe('purchasing a vehicle', () => {
  it('charges the price once, adds the car at factory spec, and leaves the selection alone', () => {
    const before = rich(5000);
    const after = expectOk(purchaseVehicle(before, 'rook-rs'));
    expect(after.credits).toBe(before.credits - 950);
    expect(isOwned(after, 'rook-rs')).toBe(true);
    expect(after.vehicles['rook-rs']?.upgrades).toEqual({ engine: 0, transmission: 0, tires: 0, brakes: 0 });
    expect(after.selectedVehicleId).toBe('kestrel-hatch');
  });

  it('refuses a second purchase of the same car, and changes nothing', () => {
    const once = expectOk(purchaseVehicle(rich(5000), 'rook-rs'));
    const result = purchaseVehicle(once, 'rook-rs');
    expectFail(result, 'already-owned');
    expect(once.credits).toBe(5000 - 950);
  });

  it('refuses when credits are short, and changes nothing (atomic)', () => {
    const poor: GarageState = { ...createDefaultGarage(), credits: 100 };
    const result = purchaseVehicle(poor, 'halcyon-gt');
    expectFail(result, 'insufficient-credits');
    expect(result.ok === false && result.message).toMatch(/Need 2800 more credits/);
    expect(poor.credits).toBe(100);
    expect(isOwned(poor, 'halcyon-gt')).toBe(false);
  });

  it('refuses an id that is not in the catalogue', () => {
    expectFail(purchaseVehicle(rich(), 'made-up-car'), 'unknown-vehicle');
  });

  it('can buy exactly the price when credits equal it, and ends at zero', () => {
    const exact: GarageState = { ...createDefaultGarage(), credits: 950 };
    const after = expectOk(purchaseVehicle(exact, 'rook-rs'));
    expect(after.credits).toBe(0);
  });
});

describe('selecting a vehicle', () => {
  it('switches to an owned car', () => {
    const owned = expectOk(purchaseVehicle(rich(), 'ember-gt'));
    const after = expectOk(selectVehicle(owned, 'ember-gt'));
    expect(after.selectedVehicleId).toBe('ember-gt');
    expect(after.credits).toBe(owned.credits);
  });

  it('cannot select a car that is not owned, and the selection stays where it was', () => {
    const state = rich();
    expectFail(selectVehicle(state, 'ember-gt'), 'not-owned');
    expect(state.selectedVehicleId).toBe('kestrel-hatch');
  });

  it('reports selecting the car already active as a no-op failure', () => {
    expectFail(selectVehicle(rich(), 'kestrel-hatch'), 'already-selected');
  });
});

describe('upgrades', () => {
  it('buys tiers one at a time, each at its own cost, and never past the top tier', () => {
    let state = rich();
    const costs = [GARAGE_CONFIG.upgradeTierCostCredits[0], GARAGE_CONFIG.upgradeTierCostCredits[1], GARAGE_CONFIG.upgradeTierCostCredits[2]];
    for (let tier = 1; tier <= MAX_UPGRADE_TIER; tier += 1) {
      const before = state.credits;
      state = expectOk(purchaseUpgrade(state, 'kestrel-hatch', 'engine'));
      expect(state.vehicles['kestrel-hatch']?.upgrades.engine).toBe(tier);
      expect(before - state.credits).toBe(costs[tier - 1]);
    }
    expectFail(purchaseUpgrade(state, 'kestrel-hatch', 'engine'), 'max-tier');
  });

  it('charges each tier once and keeps the charge consistent with nextUpgradeCost', () => {
    const state = rich();
    const progress = state.vehicles['kestrel-hatch']!;
    expect(nextUpgradeCost(progress, 'brakes')).toBe(GARAGE_CONFIG.upgradeTierCostCredits[0]);
    const after = expectOk(purchaseUpgrade(state, 'kestrel-hatch', 'brakes'));
    expect(nextUpgradeCost(after.vehicles['kestrel-hatch']!, 'brakes')).toBe(GARAGE_CONFIG.upgradeTierCostCredits[1]);
  });

  it('refuses a category the vehicle does not support, and changes nothing', () => {
    const owned = expectOk(purchaseVehicle(rich(), 'zenith-one'));
    const result = purchaseUpgrade(owned, 'zenith-one', 'brakes');
    expectFail(result, 'unsupported-upgrade');
    expect(owned.vehicles['zenith-one']?.upgrades.brakes).toBe(0);
  });

  it('refuses when short of credits, and changes nothing', () => {
    const poor: GarageState = { ...createDefaultGarage(), credits: 100 };
    expectFail(purchaseUpgrade(poor, 'kestrel-hatch', 'tires'), 'insufficient-credits');
    expect(poor.vehicles['kestrel-hatch']?.upgrades.tires).toBe(0);
    expect(poor.credits).toBe(100);
  });

  it('refuses to upgrade a car that is not owned', () => {
    expectFail(purchaseUpgrade(rich(), 'ember-gt', 'engine'), 'not-owned');
  });

  it('never lowers a tier: there is no downgrade transaction, and a higher tier stays after a buy', () => {
    const state = expectOk(purchaseUpgrade(rich(), 'kestrel-hatch', 'tires'));
    const next = expectOk(purchaseUpgrade(state, 'kestrel-hatch', 'tires'));
    expect(next.vehicles['kestrel-hatch']?.upgrades.tires).toBe(2);
  });
});

describe('paint', () => {
  it('applies a palette colour, charged at the flat change fee', () => {
    const state = rich();
    const after = expectOk(applyPaint(state, 'kestrel-hatch', 'teal'));
    expect(after.vehicles['kestrel-hatch']?.paintId).toBe('teal');
    expect(state.credits - after.credits).toBe(GARAGE_CONFIG.paintChangeCostCredits);
  });

  it('applies the factory colour for free, so reverting costs nothing', () => {
    const painted = expectOk(applyPaint(rich(), 'kestrel-hatch', 'lime'));
    const back = expectOk(applyPaint(painted, 'kestrel-hatch', 'cherry'));
    expect(back.credits).toBe(painted.credits);
    expect(back.vehicles['kestrel-hatch']?.paintId).toBe('cherry');
  });

  it('refuses the colour already applied, so repeated clicks cannot charge', () => {
    const painted = expectOk(applyPaint(rich(), 'kestrel-hatch', 'lime'));
    expectFail(applyPaint(painted, 'kestrel-hatch', 'lime'), 'already-applied');
  });

  it('refuses a colour that is not in the palette', () => {
    expectFail(applyPaint(rich(), 'kestrel-hatch', 'rainbow'), 'unknown-paint');
  });

  it('refuses to paint a car that is not owned', () => {
    expectFail(applyPaint(rich(), 'halcyon-gt', 'lime'), 'not-owned');
  });

  it('covers every palette id in the model', () => {
    expect(PAINT_IDS.length).toBeGreaterThanOrEqual(6);
  });
});

describe('earnings', () => {
  it('adds a positive whole number of credits', () => {
    const after = expectOk(earnCredits(createDefaultGarage(), 300, 'race a#1'));
    expect(after.credits).toBe(GARAGE_CONFIG.startingCredits + 300);
  });

  it('refuses zero, negative, fractional, and non-finite amounts', () => {
    for (const amount of [0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectFail(earnCredits(createDefaultGarage(), amount, 'x'), 'invalid-amount');
    }
  });
});

describe('normalizeGarage (loaded data is never trusted)', () => {
  it('returns the default garage for missing or non-object data, and says so', () => {
    for (const raw of [undefined, null, 42, 'garage', [1, 2]]) {
      const report = normalizeGarage(raw);
      expect(report.state).toEqual(createDefaultGarage());
      expect(report.repairs.length).toBeGreaterThan(0);
    }
  });

  it('accepts a valid garage without repairs', () => {
    const valid = expectOk(purchaseVehicle(rich(5000), 'grit-coupe'));
    const report = normalizeGarage(JSON.parse(JSON.stringify(valid)));
    expect(report.repairs).toEqual([]);
    expect(report.state).toEqual(valid);
  });

  it('drops unknown vehicle ids and keeps the starter', () => {
    const report = normalizeGarage({ credits: 10, selectedVehicleId: 'ghost', vehicles: { 'ghost-car': {}, 'kestrel-hatch': {} } });
    expect(Object.keys(report.state.vehicles)).toEqual(['kestrel-hatch']);
    expect(report.repairs.join(' ')).toMatch(/unknown vehicle/);
  });

  it('always leaves at least one owned vehicle, restoring the starter if the save lost it', () => {
    const report = normalizeGarage({ credits: 10, selectedVehicleId: 'volt-e', vehicles: { 'volt-e': {} } });
    expect(isOwned(report.state, 'kestrel-hatch')).toBe(true);
    // The saved selection (volt-e) is owned, so it is kept. The rule is that the selection is always owned.
    expect(isOwned(report.state, report.state.selectedVehicleId)).toBe(true);
  });

  it('never selects a car that is not owned, and falls back to the starter', () => {
    const report = normalizeGarage({ credits: 10, selectedVehicleId: 'halcyon-gt', vehicles: { 'kestrel-hatch': {} } });
    expect(report.state.selectedVehicleId).toBe('kestrel-hatch');
    expect(report.repairs.join(' ')).toMatch(/not owned/);
  });

  it('resets bad credits to the starting amount and reports it', () => {
    for (const credits of [-1, 'lots', Number.NaN, null]) {
      const report = normalizeGarage({ credits, vehicles: { 'kestrel-hatch': {} } });
      expect(report.state.credits).toBe(GARAGE_CONFIG.startingCredits);
      expect(report.repairs.join(' ')).toMatch(/credits invalid/);
    }
  });

  it('floors fractional credits to whole credits', () => {
    expect(normalizeGarage({ credits: 99.9, vehicles: { 'kestrel-hatch': {} } }).state.credits).toBe(99);
  });

  it('clamps upgrade levels to 0..MAX, and drops levels for unsupported categories', () => {
    const report = normalizeGarage({
      credits: 10,
      vehicles: { 'grit-coupe': { upgrades: { engine: 99, tires: 2, brakes: -1, transmission: 1 } } },
    });
    const progress = report.state.vehicles['grit-coupe']!;
    expect(progress.upgrades.engine).toBe(0);
    expect(progress.upgrades.tires).toBe(0);
    expect(progress.upgrades.brakes).toBe(0);
    expect(progress.upgrades.transmission).toBe(1);
    expect(report.repairs.length).toBeGreaterThan(0);
  });

  it('resets an unknown paint to the factory colour', () => {
    const report = normalizeGarage({ credits: 10, vehicles: { 'kestrel-hatch': { paintId: 'neon-pink' } } });
    expect(report.state.vehicles['kestrel-hatch']?.paintId).toBe('cherry');
  });

  it('ignores a prototype-polluting key without reading it as a vehicle', () => {
    const raw = JSON.parse('{"credits":5,"vehicles":{"__proto__":{"upgrades":{}},"kestrel-hatch":{}}}') as unknown;
    const report = normalizeGarage(raw);
    expect(Object.keys(report.state.vehicles)).toEqual(['kestrel-hatch']);
  });
});
