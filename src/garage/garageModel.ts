/**
 * Part 8 garage model. Pure data and pure transactions. No React, no storage, no simulation.
 *
 * - The state holds only ids and numbers. Catalogue data is never stored here.
 * - Ownership is the key set of `vehicles`, so a duplicate owned entry cannot exist.
 * - Every transaction returns either a new state (charged once) or a failure, and it never changes state on failure.
 * - The garage service (garageService.ts) is the only caller that commits these results.
 */
import { GARAGE_CONFIG } from '../config/garageConfig';
import { PAINT_IDS, paintDefinition, type PaintId } from '../config/paintConfig';
import { MAX_UPGRADE_TIER, UPGRADE_CATEGORIES, type UpgradeCategory } from '../config/upgradeConfig';
import { CATALOGUE, STARTER_VEHICLE_ID, startingVehicleIds, vehicleDefinition } from '../vehicles/catalogue';
import type { VehicleDefinition } from '../config/vehicleCatalogue';

export interface VehicleProgress {
  /** Installed tier per category. 0 = stock. Never negative, never above MAX_UPGRADE_TIER. */
  readonly upgrades: Readonly<Record<UpgradeCategory, number>>;
  readonly paintId: PaintId;
}

export interface GarageState {
  readonly credits: number;
  readonly selectedVehicleId: string;
  /** Owned vehicles, keyed by id. A key present here means the vehicle is owned. */
  readonly vehicles: Readonly<Record<string, VehicleProgress>>;
}

export type TxFailureCode =
  | 'unknown-vehicle'
  | 'locked-rank'
  | 'not-owned'
  | 'already-owned'
  | 'already-selected'
  | 'insufficient-credits'
  | 'unsupported-upgrade'
  | 'max-tier'
  | 'unknown-paint'
  | 'already-applied'
  | 'invalid-amount'
  | 'duplicate-click'
  | 'save-failed';

export type TxResult =
  | { readonly ok: true; readonly state: GarageState; readonly chargedCredits: number; readonly message: string }
  | { readonly ok: false; readonly code: TxFailureCode; readonly message: string };

const STOCK_UPGRADE_LEVELS: Readonly<Record<UpgradeCategory, number>> = { engine: 0, transmission: 0, tires: 0, brakes: 0 };

export function defaultProgress(vehicle: VehicleDefinition): VehicleProgress {
  return { upgrades: STOCK_UPGRADE_LEVELS, paintId: vehicle.factoryPaintId };
}

export function createDefaultGarage(): GarageState {
  const vehicles: Record<string, VehicleProgress> = {};
  for (const id of startingVehicleIds()) {
    const vehicle = vehicleDefinition(id);
    if (vehicle) vehicles[id] = defaultProgress(vehicle);
  }
  return { credits: GARAGE_CONFIG.startingCredits, selectedVehicleId: STARTER_VEHICLE_ID, vehicles };
}

export function isOwned(state: GarageState, vehicleId: string): boolean {
  return Object.hasOwn(state.vehicles, vehicleId);
}

export function ownedVehicleIds(state: GarageState): string[] {
  return CATALOGUE.filter((vehicle) => isOwned(state, vehicle.id)).map((vehicle) => vehicle.id);
}

/** Price of the next tier, or null when the category is already at its top tier. */
export function nextUpgradeCost(progress: VehicleProgress, category: UpgradeCategory): number | null {
  const current = progress.upgrades[category];
  if (current >= MAX_UPGRADE_TIER) return null;
  return GARAGE_CONFIG.upgradeTierCostCredits[current] ?? null;
}

/** Cost of applying a palette colour to a vehicle: free for its factory paint, otherwise a flat fee. */
export function paintCost(vehicle: VehicleDefinition, paintId: PaintId): number {
  return paintId === vehicle.factoryPaintId ? 0 : GARAGE_CONFIG.paintChangeCostCredits;
}

function fail(code: TxFailureCode, message: string): TxResult {
  return { ok: false, code, message };
}

function ok(state: GarageState, chargedCredits: number, message: string): TxResult {
  return { ok: true, state, chargedCredits, message };
}

function lookupOwned(state: GarageState, vehicleId: string): { vehicle: VehicleDefinition; progress: VehicleProgress } | TxResult {
  const vehicle = vehicleDefinition(vehicleId);
  if (!vehicle) return fail('unknown-vehicle', 'That vehicle is not in the catalogue.');
  const progress = state.vehicles[vehicleId];
  if (!progress || !isOwned(state, vehicleId)) return fail('not-owned', `You do not own the ${vehicle.name}.`);
  return { vehicle, progress };
}

function isFailure(value: TxResult | { vehicle: VehicleDefinition; progress: VehicleProgress }): value is TxResult {
  return 'ok' in value;
}

function shortfall(state: GarageState, cost: number): string {
  return `Need ${cost - state.credits} more credits.`;
}

/** Buys a catalogue vehicle at factory spec. Does not change the selection. Charged once, atomically. */
export function purchaseVehicle(state: GarageState, vehicleId: string): TxResult {
  const vehicle = vehicleDefinition(vehicleId);
  if (!vehicle) return fail('unknown-vehicle', 'That vehicle is not in the catalogue.');
  if (isOwned(state, vehicleId)) return fail('already-owned', `You already own the ${vehicle.name}.`);
  if (state.credits < vehicle.priceCredits) return fail('insufficient-credits', shortfall(state, vehicle.priceCredits));
  const next: GarageState = {
    credits: state.credits - vehicle.priceCredits,
    selectedVehicleId: state.selectedVehicleId,
    vehicles: { ...state.vehicles, [vehicleId]: defaultProgress(vehicle) },
  };
  return ok(next, vehicle.priceCredits, `Bought the ${vehicle.name} for ${vehicle.priceCredits} credits.`);
}

/** Makes an owned vehicle the active one. Free. Callers must check the race and pursuit rules first (garageGate.ts). */
export function selectVehicle(state: GarageState, vehicleId: string): TxResult {
  const looked = lookupOwned(state, vehicleId);
  if (isFailure(looked)) return looked;
  if (state.selectedVehicleId === vehicleId) return fail('already-selected', `The ${looked.vehicle.name} is already your active car.`);
  return ok({ ...state, selectedVehicleId: vehicleId }, 0, `The ${looked.vehicle.name} is now your active car.`);
}

/** Buys the next tier of one upgrade category. One tier per transaction, in order, never a downgrade. */
export function purchaseUpgrade(state: GarageState, vehicleId: string, category: UpgradeCategory): TxResult {
  const looked = lookupOwned(state, vehicleId);
  if (isFailure(looked)) return looked;
  const { vehicle, progress } = looked;
  if (!UPGRADE_CATEGORIES.includes(category) || !vehicle.upgradeSupport.includes(category)) {
    return fail('unsupported-upgrade', `The ${vehicle.name} cannot take ${category} upgrades.`);
  }
  const cost = nextUpgradeCost(progress, category);
  if (cost === null) return fail('max-tier', `${category} is already at its top tier.`);
  if (state.credits < cost) return fail('insufficient-credits', shortfall(state, cost));
  const tier = progress.upgrades[category] + 1;
  const next: GarageState = {
    ...state,
    credits: state.credits - cost,
    vehicles: {
      ...state.vehicles,
      [vehicleId]: { ...progress, upgrades: { ...progress.upgrades, [category]: tier } },
    },
  };
  return ok(next, cost, `${vehicle.name} ${category} upgraded to tier ${tier} for ${cost} credits.`);
}

/** Applies a palette colour to an owned vehicle. Charged per the cosmetic rule in garageConfig.ts. */
export function applyPaint(state: GarageState, vehicleId: string, paintId: string): TxResult {
  const looked = lookupOwned(state, vehicleId);
  if (isFailure(looked)) return looked;
  const { vehicle, progress } = looked;
  const paint = paintDefinition(paintId);
  if (!paint || !(PAINT_IDS as readonly string[]).includes(paintId)) return fail('unknown-paint', 'That colour is not in the palette.');
  if (progress.paintId === paint.id) return fail('already-applied', `The ${vehicle.name} is already ${paint.label.toLowerCase()}.`);
  const cost = paintCost(vehicle, paint.id);
  if (state.credits < cost) return fail('insufficient-credits', shortfall(state, cost));
  const next: GarageState = {
    ...state,
    credits: state.credits - cost,
    vehicles: { ...state.vehicles, [vehicleId]: { ...progress, paintId: paint.id } },
  };
  const priceNote = cost === 0 ? 'Factory paint is free.' : `Paint changed for ${cost} credits.`;
  return ok(next, cost, `${vehicle.name} is now ${paint.label.toLowerCase()}. ${priceNote}`);
}

/**
 * Takes the busted fine: a share of the credits, rounded to whole credits, never more than the balance. The share is a
 * percentage from PURSUIT_CONFIG (capture.bustFinePercent). With no credits, nothing is taken and nothing fails.
 */
export function chargeBustFine(state: GarageState, percent: number): TxResult {
  const share = Math.min(100, Math.max(0, percent));
  const fine = Math.min(state.credits, Math.round((state.credits * share) / 100));
  const message = fine > 0 ? `Busted: lost ${fine} credits (${share}%).` : 'Busted: no credits to lose.';
  return ok({ ...state, credits: state.credits - fine }, fine, message);
}

/** Adds earned credits (race rewards). Source is for the message only; de-duplication happens before this call. */
export function earnCredits(state: GarageState, amount: number, source: string): TxResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('invalid-amount', 'Reward must be a positive whole number.');
  return ok({ ...state, credits: state.credits + amount }, 0, `Earned ${amount} credits from ${source}.`);
}

export interface NormalizeReport {
  readonly state: GarageState;
  /** Each repair, in plain words. Empty when the data was already valid. */
  readonly repairs: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProgress(vehicle: VehicleDefinition, raw: unknown, repairs: string[]): VehicleProgress {
  if (!isRecord(raw)) {
    repairs.push(`${vehicle.name}: data unreadable, reset to factory.`);
    return defaultProgress(vehicle);
  }
  const upgrades: Record<UpgradeCategory, number> = { ...STOCK_UPGRADE_LEVELS };
  const rawUpgrades = isRecord(raw.upgrades) ? raw.upgrades : {};
  for (const category of UPGRADE_CATEGORIES) {
    const level = Object.hasOwn(rawUpgrades, category) ? rawUpgrades[category] : 0;
    const valid = typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= MAX_UPGRADE_TIER;
    if (!valid) {
      if (level !== 0 && level !== undefined) repairs.push(`${vehicle.name}: ${category} level invalid, reset to stock.`);
      continue;
    }
    if (!vehicle.upgradeSupport.includes(category)) {
      if (level !== 0) repairs.push(`${vehicle.name}: ${category} is not supported, removed.`);
      continue;
    }
    upgrades[category] = level;
  }
  const paintId = typeof raw.paintId === 'string' && (PAINT_IDS as readonly string[]).includes(raw.paintId) ? (raw.paintId as PaintId) : null;
  if (paintId === null) {
    if (raw.paintId !== undefined) repairs.push(`${vehicle.name}: unknown paint, reset to factory.`);
  }
  return { upgrades, paintId: paintId ?? vehicle.factoryPaintId };
}

/**
 * Turns unknown loaded data into a valid GarageState. Never throws. Anything missing or wrong falls back to a safe
 * default, and each repair is reported. The result always has at least one owned vehicle and a selection that is owned.
 */
export function normalizeGarage(raw: unknown): NormalizeReport {
  const repairs: string[] = [];
  if (!isRecord(raw)) {
    repairs.push('garage data missing or unreadable, default garage used.');
    return { state: createDefaultGarage(), repairs };
  }

  let credits: number = GARAGE_CONFIG.startingCredits;
  if (typeof raw.credits === 'number' && Number.isFinite(raw.credits) && raw.credits >= 0) {
    credits = Math.floor(raw.credits);
  } else {
    repairs.push('credits invalid, reset to the starting amount.');
  }

  const vehicles: Record<string, VehicleProgress> = {};
  const rawVehicles = isRecord(raw.vehicles) ? raw.vehicles : null;
  if (rawVehicles === null) repairs.push('vehicle list missing, starter car restored.');
  for (const id of rawVehicles ? Object.keys(rawVehicles) : []) {
    const vehicle = vehicleDefinition(id);
    if (!vehicle) {
      repairs.push(`unknown vehicle "${id.slice(0, 40)}" removed.`);
      continue;
    }
    vehicles[id] = normalizeProgress(vehicle, rawVehicles?.[id], repairs);
  }

  // At least one usable vehicle, always. The starter comes back if the save lost it.
  if (!Object.hasOwn(vehicles, STARTER_VEHICLE_ID)) {
    const starter = vehicleDefinition(STARTER_VEHICLE_ID);
    if (starter) {
      vehicles[STARTER_VEHICLE_ID] = defaultProgress(starter);
      repairs.push('starter car missing, restored.');
    }
  }

  let selectedVehicleId = STARTER_VEHICLE_ID;
  if (typeof raw.selectedVehicleId === 'string' && Object.hasOwn(vehicles, raw.selectedVehicleId)) {
    selectedVehicleId = raw.selectedVehicleId;
  } else if (raw.selectedVehicleId !== undefined) {
    repairs.push('selected vehicle not owned or unknown, starter car selected.');
  }

  return { state: { credits, selectedVehicleId, vehicles }, repairs };
}

