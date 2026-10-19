/**
 * Catalogue lookups and validation. Pure: no React, no storage, no simulation.
 *
 * The garage and the save refer to vehicles only by id. Nothing from the catalogue is ever copied into the save.
 */
import { PAINT_PALETTE, paintDefinition } from '../config/paintConfig';
import { SPEC_LIMITS, TUNABLE_SPEC_KEYS } from '../config/specLimits';
import { UPGRADE_CATEGORIES } from '../config/upgradeConfig';
import {
  VEHICLE_CATALOGUE,
  VEHICLE_IDS,
  VEHICLE_TIERS,
  type RequiredRankId,
  type VehicleDefinition,
  type VehicleTier,
} from '../config/vehicleCatalogue';
import { DESIGN_LIMITS, VEHICLE_DESIGNS } from '../config/vehicleDesigns';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { hullWithOverride, validateDesign, type DesignHull, type VehicleDesignProfile } from './designProfile';
import { deriveEffectiveSpecs, STOCK_UPGRADES } from './effectiveSpecs';
import { PERFORMANCE_BANDS, performanceIndex } from './performance';

export const STARTER_VEHICLE_ID = 'kestrel-hatch';

/** Catalogue size the brief asks for. A test and the validator both enforce it. */
export const CATALOGUE_SIZE = 32;

export const CATALOGUE: readonly VehicleDefinition[] = VEHICLE_CATALOGUE;

/** The career rank that unlocks each tier. Starter needs none. */
export const TIER_RANK: Readonly<Record<VehicleTier, RequiredRankId>> = {
  starter: 'rank-newcomer',
  street: 'rank-street-regular',
  advanced: 'rank-road-name',
  elite: 'rank-night-contender',
  ultimate: 'rank-city-legend',
};

/** Roster number to tier. 01..05 starter, 06..10 street, 11..15 advanced, 16..19 elite, 20..32 ultimate. */
export function tierForRoster(roster: number): VehicleTier {
  if (roster <= 5) return 'starter';
  if (roster <= 10) return 'street';
  if (roster <= 15) return 'advanced';
  if (roster <= 19) return 'elite';
  return 'ultimate';
}

export function vehicleDefinition(id: string): VehicleDefinition | null {
  return CATALOGUE.find((vehicle) => vehicle.id === id) ?? null;
}

/** The design profile for a vehicle. Null only for an unknown id (validation refuses a catalogue without one). */
export function vehicleDesign(id: string): VehicleDesignProfile | null {
  return (VEHICLE_IDS as readonly string[]).includes(id) ? VEHICLE_DESIGNS[id as keyof typeof VEHICLE_DESIGNS] : null;
}

/** The shared hull every design must fit by default: the shared collision footprint, plus the vertical limits. */
export function designHull(): DesignHull {
  return {
    rearZ: -VEHICLE_CONFIG.footprintRearMeters,
    frontZ: VEHICLE_CONFIG.footprintFrontMeters,
    halfWidth: VEHICLE_CONFIG.footprintHalfWidthMeters,
    roofMaxY: DESIGN_LIMITS.roofMaxY,
    bodyBottomY: DESIGN_LIMITS.bodyBottomMinY,
  };
}

/** The hull a given design must fit: its own override when it has one, otherwise the shared hull. */
export function designHullFor(id: string): DesignHull {
  const override = vehicleDesign(id)?.hull;
  return override ? hullWithOverride(designHull(), override) : designHull();
}

/** Owned at a new game: every vehicle with startsOwned. Catalogue order. */
export function startingVehicleIds(): string[] {
  return CATALOGUE.filter((vehicle) => vehicle.startsOwned).map((vehicle) => vehicle.id);
}

/**
 * Checks the catalogue against its rules. Returns the problems found, empty when valid. A test runs it on the real
 * data, so a bad edit fails the test step rather than reaching a player.
 */
export function validateCatalogue(vehicles: readonly VehicleDefinition[] = CATALOGUE): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  const names = new Set<string>();
  let owned = 0;

  if (vehicles.length !== CATALOGUE_SIZE) issues.push(`catalogue must have ${CATALOGUE_SIZE} vehicles (has ${vehicles.length})`);

  vehicles.forEach((vehicle, index) => {
    const tag = `vehicle "${vehicle.id}"`;
    if (!/^[a-z0-9-]+$/.test(vehicle.id)) issues.push(`${tag}: id must be lowercase letters, digits, and hyphens`);
    if (seen.has(vehicle.id)) issues.push(`${tag}: duplicate id`);
    seen.add(vehicle.id);
    if (!(VEHICLE_IDS as readonly string[]).includes(vehicle.id)) issues.push(`${tag}: id is not in VEHICLE_IDS`);
    if (vehicle.roster !== index + 1) issues.push(`${tag}: roster ${vehicle.roster} must be ${index + 1}`);
    if (vehicle.name.trim().length === 0) issues.push(`${tag}: empty name`);
    if (names.has(vehicle.name)) issues.push(`${tag}: duplicate name "${vehicle.name}"`);
    names.add(vehicle.name);
    if (vehicle.vehicleClass.trim().length === 0) issues.push(`${tag}: empty class`);
    if (vehicle.summary.trim().length === 0) issues.push(`${tag}: empty summary`);
    if (!(VEHICLE_TIERS as readonly string[]).includes(vehicle.tier)) issues.push(`${tag}: unknown tier`);
    if (vehicle.tier !== tierForRoster(vehicle.roster)) issues.push(`${tag}: tier ${vehicle.tier} does not match roster ${vehicle.roster}`);
    if (vehicle.requiredRankId !== TIER_RANK[vehicle.tier]) issues.push(`${tag}: unlock rank must be ${TIER_RANK[vehicle.tier]}`);

    if (!Number.isInteger(vehicle.priceCredits) || vehicle.priceCredits < 0) issues.push(`${tag}: price must be a whole number >= 0`);
    if (vehicle.startsOwned) {
      owned += 1;
      if (vehicle.priceCredits !== 0) issues.push(`${tag}: a starting vehicle must cost 0`);
      if (vehicle.id !== STARTER_VEHICLE_ID) issues.push(`${tag}: only the starter may start owned`);
    } else if (vehicle.priceCredits <= 0) {
      issues.push(`${tag}: a purchasable vehicle must cost more than 0`);
    }

    if (!paintDefinition(vehicle.factoryPaintId)) issues.push(`${tag}: unknown factory paint "${vehicle.factoryPaintId}"`);
    if (vehicle.upgradeSupport.length < 2) issues.push(`${tag}: needs at least two upgrade categories`);
    for (const category of vehicle.upgradeSupport) {
      if (!UPGRADE_CATEGORIES.includes(category)) issues.push(`${tag}: unknown upgrade category "${category}"`);
    }
    for (const key of Object.keys(vehicle.handling)) {
      if (!(TUNABLE_SPEC_KEYS as readonly string[]).includes(key)) issues.push(`${tag}: "${key}" is not a tunable handling key`);
    }

    // The base handling must already be inside the limits. Clamping is for upgrades, not for catalogue data.
    const stock = deriveEffectiveSpecs(vehicle, STOCK_UPGRADES, VEHICLE_CONFIG);
    if (stock.clamped.length > 0) issues.push(`${tag}: handling outside limits: ${stock.clamped.join(', ')}`);
    if (stock.adjustments.length > 0) issues.push(`${tag}: handling breaks an invariant: ${stock.adjustments.join('; ')}`);

    const perf = performanceIndex(stock.config);
    const band = PERFORMANCE_BANDS[vehicle.tier];
    if (perf < band.min || perf > band.max) {
      issues.push(`${tag}: performance index ${perf.toFixed(3)} is outside the ${vehicle.tier} band ${band.min}..${band.max}`);
    }

    const design = vehicleDesign(vehicle.id);
    if (!design) issues.push(`${tag}: no design profile`);
    else for (const problem of validateDesign(design, designHull(), tag)) issues.push(problem);
  });

  // Prices rise with the roster, and no two neighbours share a price or a performance index.
  for (let i = 1; i < vehicles.length; i += 1) {
    const previous = vehicles[i - 1];
    const current = vehicles[i];
    if (!previous || !current) continue;
    if (!(current.priceCredits > previous.priceCredits)) {
      issues.push(`vehicle "${current.id}": price ${current.priceCredits} must be above "${previous.id}" (${previous.priceCredits})`);
    }
    const a = performanceIndex(deriveEffectiveSpecs(previous, STOCK_UPGRADES, VEHICLE_CONFIG).config);
    const b = performanceIndex(deriveEffectiveSpecs(current, STOCK_UPGRADES, VEHICLE_CONFIG).config);
    if (Math.abs(a - b) < 0.001) issues.push(`vehicle "${current.id}": performance index equals its neighbour "${previous.id}"`);
  }

  if (owned === 0) issues.push('catalogue has no starting vehicle');
  if (!vehicles.some((vehicle) => vehicle.id === STARTER_VEHICLE_ID && vehicle.startsOwned)) {
    issues.push(`starter vehicle "${STARTER_VEHICLE_ID}" must exist and start owned`);
  }
  for (const key of TUNABLE_SPEC_KEYS) {
    const limit = SPEC_LIMITS[key];
    if (!(limit.min < limit.max)) issues.push(`limit for ${key} is empty`);
  }
  if (PAINT_PALETTE.length === 0) issues.push('paint palette is empty');
  return issues;
}
