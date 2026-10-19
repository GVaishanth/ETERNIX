import { describe, expect, it } from 'vitest';
import { CAREER_RANKS } from '../career/careerCatalogue';
import { VEHICLE_CATALOGUE } from '../config/vehicleCatalogue';
import { vehicleUnlock } from './vehicleUnlock';

const byId = (id: string) => {
  const vehicle = VEHICLE_CATALOGUE.find((entry) => entry.id === id);
  if (!vehicle) throw new Error(`no ${id}`);
  return vehicle;
};

describe('vehicle unlock rule', () => {
  it('leaves the starter tier open from the first reputation point', () => {
    expect(vehicleUnlock(byId('kestrel-hatch'), 0).unlocked).toBe(true);
    expect(vehicleUnlock(byId('rook-rs'), 0).unlocked).toBe(true);
  });

  it('locks the street tier until the Street Regular rank is reached', () => {
    const rank = CAREER_RANKS.find((entry) => entry.id === 'rank-street-regular')!;
    const below = vehicleUnlock(byId('vandal-r'), rank.minReputation - 1);
    expect(below.unlocked).toBe(false);
    expect(below.requiredName).toBe('Street Regular');
    expect(below.reputationToGo).toBe(1);
    expect(vehicleUnlock(byId('vandal-r'), rank.minReputation).unlocked).toBe(true);
  });

  it('keeps each ultimate-tier car locked until City Legend', () => {
    const legend = CAREER_RANKS.find((entry) => entry.id === 'rank-city-legend')!;
    expect(vehicleUnlock(byId('zenith-one'), legend.minReputation - 1).unlocked).toBe(false);
    expect(vehicleUnlock(byId('zenith-one'), legend.minReputation).unlocked).toBe(true);
  });

  it('uses the career rank table (no second copy of the thresholds)', () => {
    for (const vehicle of VEHICLE_CATALOGUE) {
      const rank = CAREER_RANKS.find((entry) => entry.id === vehicle.requiredRankId);
      expect(rank, vehicle.id).toBeDefined();
      expect(vehicleUnlock(vehicle, rank!.minReputation).unlocked).toBe(true);
    }
  });
});
