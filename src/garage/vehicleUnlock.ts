/**
 * Unlock rule for catalogue vehicles. Pure. A vehicle is unlocked when the career reputation reaches the rank that the
 * catalogue names for it. The rank table is career/careerCatalogue.ts, so the thresholds are not repeated here.
 */
import { CAREER_RANKS } from '../career/careerCatalogue';
import type { VehicleDefinition } from '../config/vehicleCatalogue';

export interface VehicleUnlock {
  readonly unlocked: boolean;
  /** Display name of the rank that unlocks the vehicle. */
  readonly requiredName: string;
  /** Reputation the rank needs. */
  readonly requiredReputation: number;
  /** Reputation still missing. Zero when unlocked. */
  readonly reputationToGo: number;
}

export function vehicleUnlock(vehicle: VehicleDefinition, reputation: number): VehicleUnlock {
  const required = CAREER_RANKS.find((rank) => rank.id === vehicle.requiredRankId);
  if (!required) throw new Error(`vehicleUnlock: ${vehicle.id} names unknown rank "${vehicle.requiredRankId}"`);
  const reputationToGo = Math.max(0, required.minReputation - reputation);
  return {
    unlocked: reputationToGo === 0,
    requiredName: required.name,
    requiredReputation: required.minReputation,
    reputationToGo,
  };
}
