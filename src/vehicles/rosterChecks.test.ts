import { describe, expect, it } from 'vitest';
import { VEHICLE_CATALOGUE } from '../config/vehicleCatalogue';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { createDefaultGarage } from '../garage/garageModel';
import { specsForVehicle } from '../garage/activeVehicle';
import { deriveEffectiveSpecs, STOCK_UPGRADES } from './effectiveSpecs';
import { PERFORMANCE_BANDS, garageRatings, performanceIndex } from './performance';

const TIER_BY_ROSTER = (roster: number) => {
  if (roster <= 5) return 'starter';
  if (roster <= 10) return 'street';
  if (roster <= 15) return 'advanced';
  if (roster <= 19) return 'elite';
  return 'ultimate';
};

const RANK_BY_TIER: Record<string, string> = {
  starter: 'rank-newcomer',
  street: 'rank-street-regular',
  advanced: 'rank-road-name',
  elite: 'rank-night-contender',
  ultimate: 'rank-city-legend',
};

const stock = (index: number) => deriveEffectiveSpecs(VEHICLE_CATALOGUE[index]!, STOCK_UPGRADES).config;

describe('roster: prices, tiers, and unlocks', () => {
  it('has strictly increasing whole-number prices in roster order, and a free starter', () => {
    const prices = VEHICLE_CATALOGUE.map((vehicle) => vehicle.priceCredits);
    expect(prices[0]).toBe(0);
    for (let i = 0; i < prices.length; i += 1) {
      expect(Number.isInteger(prices[i])).toBe(true);
      if (i > 0) expect(prices[i]).toBeGreaterThan(prices[i - 1]!);
    }
  });

  it('places each car in the tier its roster number names (01-05 starter ... 20 ultimate)', () => {
    for (const vehicle of VEHICLE_CATALOGUE) {
      expect(vehicle.tier, vehicle.name).toBe(TIER_BY_ROSTER(vehicle.roster));
    }
  });

  it('gates each tier by its career rank', () => {
    for (const vehicle of VEHICLE_CATALOGUE) {
      expect(vehicle.requiredRankId, vehicle.name).toBe(RANK_BY_TIER[vehicle.tier]);
    }
  });
});

describe('roster: performance', () => {
  it('keeps every car inside its tier performance band (compressed index, see CAR_OVERHAUL_PLAN.md)', () => {
    VEHICLE_CATALOGUE.forEach((vehicle, index) => {
      const band = PERFORMANCE_BANDS[vehicle.tier];
      const value = performanceIndex(stock(index));
      expect(value, vehicle.name).toBeGreaterThanOrEqual(band.min);
      expect(value, vehicle.name).toBeLessThanOrEqual(band.max);
    });
  });

  it('makes the ultimate car the strongest overall, and the starter the weakest', () => {
    // Scoped to the original 20 (roster 01 to 20): the 12 added ground cars are also ultimate tier.
    const values = VEHICLE_CATALOGUE.map((_, index) => performanceIndex(stock(index))).slice(0, 20);
    expect(values[19]).toBe(Math.max(...values));
    expect(values[0]).toBe(Math.min(...values));
  });

  it('keeps neighbouring cars distinct: a different price, and an index or rating gap', () => {
    for (let i = 1; i < VEHICLE_CATALOGUE.length; i += 1) {
      const a = garageRatings(stock(i - 1));
      const b = garageRatings(stock(i));
      const indexGap = Math.abs(performanceIndex(stock(i)) - performanceIndex(stock(i - 1)));
      const ratingGap = Math.max(
        Math.abs(a.acceleration - b.acceleration),
        Math.abs(a.topSpeed - b.topSpeed),
        Math.abs(a.handling - b.handling),
        Math.abs(a.braking - b.braking),
      );
      expect(indexGap >= 0.002 || ratingGap >= 0.5, `${VEHICLE_CATALOGUE[i - 1]!.name} vs ${VEHICLE_CATALOGUE[i]!.name}`).toBe(true);
    }
  });

  it('gives no two cars the same four-rating set', () => {
    const keys = VEHICLE_CATALOGUE.map((_, index) => {
      const r = garageRatings(stock(index));
      return [r.acceleration, r.topSpeed, r.handling, r.braking].join('|');
    });
    expect(new Set(keys).size).toBe(VEHICLE_CATALOGUE.length);
  });

  it('keeps every rating on the 1 to 10 scale', () => {
    VEHICLE_CATALOGUE.forEach((_, index) => {
      const r = garageRatings(stock(index));
      for (const value of [r.acceleration, r.topSpeed, r.handling, r.braking]) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(10);
      }
    });
  });

  it('shows the same stats in the garage as the car drives (one pipeline)', () => {
    const garage = createDefaultGarage();
    for (const vehicle of VEHICLE_CATALOGUE) {
      const shown = specsForVehicle(vehicle.id, garage).config;
      expect(shown, vehicle.name).toEqual(stock(VEHICLE_CATALOGUE.indexOf(vehicle)));
    }
    expect(stock(0)).toEqual(VEHICLE_CONFIG);
  });
});
