/**
 * The active vehicle's effective specs, derived from the garage state through the single pipeline
 * (vehicles/effectiveSpecs.ts). The simulation and the live car's visuals both read this, so they agree.
 *
 * Memoized by vehicle and installed tiers. Paint is not part of the key, so a paint change returns the same config
 * object. That means painting a car never resets the simulation, and never rebuilds the car's physics.
 */
import type { PaintId } from '../config/paintConfig';
import { vehicleDefinition, vehicleDesign, STARTER_VEHICLE_ID } from '../vehicles/catalogue';
import type { VehicleDesignProfile } from '../vehicles/designProfile';
import { deriveEffectiveSpecs, type EffectiveSpecs } from '../vehicles/effectiveSpecs';
import { UPGRADE_CATEGORIES } from '../config/upgradeConfig';
import type { GarageState } from './garageModel';

const memo = new Map<string, EffectiveSpecs>();

function keyOf(vehicleId: string, state: GarageState): string {
  const progress = state.vehicles[vehicleId];
  const tiers = progress ? UPGRADE_CATEGORIES.map((category) => progress.upgrades[category]).join(',') : 'none';
  return `${vehicleId}|${tiers}`;
}

/** Effective specs for a vehicle with its installed upgrades. Throws only for an unknown id (a programming error). */
export function specsForVehicle(vehicleId: string, state: GarageState): EffectiveSpecs {
  const vehicle = vehicleDefinition(vehicleId);
  if (!vehicle) throw new Error(`specsForVehicle: unknown vehicle "${vehicleId}"`);
  const progress = state.vehicles[vehicleId];
  const upgrades = progress ? progress.upgrades : { engine: 0, transmission: 0, tires: 0, brakes: 0 };
  const key = keyOf(vehicleId, state);
  const cached = memo.get(key);
  if (cached) return cached;
  const specs = deriveEffectiveSpecs(vehicle, upgrades);
  memo.set(key, specs);
  return specs;
}

/** Effective specs of the selected car. Falls back to the starter if the selection is somehow not owned. */
export function activeSpecs(state: GarageState): EffectiveSpecs {
  const id = state.vehicles[state.selectedVehicleId] ? state.selectedVehicleId : STARTER_VEHICLE_ID;
  return specsForVehicle(id, state);
}

/** Paint of the selected car. */
/** The design of the active car. Resolved from the same id as activeSpecs, so the model and the stats always match. */
export function activeDesign(state: GarageState): VehicleDesignProfile {
  const id = activeSpecs(state).vehicleId;
  const design = vehicleDesign(id);
  if (!design) throw new Error(`activeDesign: no design for "${id}"`);
  return design;
}

export function activePaint(state: GarageState): PaintId {
  const progress = state.vehicles[state.selectedVehicleId];
  if (progress) return progress.paintId;
  const starter = vehicleDefinition(STARTER_VEHICLE_ID);
  return starter ? starter.factoryPaintId : 'cherry';
}

/** Test hook: the number of memoized entries. Used to show the memo does not grow per frame. */
export function memoSizeForTests(): number {
  return memo.size;
}
