/**
 * The ONE commit path for progress. It holds the profile (garage and career) and writes it to the save.
 *
 * - The UI calls these methods. The UI never changes credits, ownership, reputation, defeats, or unlocks directly.
 * - Each transaction: (1) the pure rule decides, (2) the whole profile is saved in one write, (3) only then is the store
 *   updated. If the save fails, nothing changes and nothing is charged or granted.
 * - A repeated click with the same intent inside DUPLICATE_INTENT_WINDOW_MS is ignored, so a double click cannot
 *   charge or grant twice.
 * - Race rewards arrive through earnCredits() or, for career races, through the career service (career/careerService).
 *   Each race attempt is de-duplicated before it reaches here.
 *
 * The store is the game's persistent state, the same role appStore and raceStore play for the HUD. It is a plain
 * zustand store, consistent with the rest of the app.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { DUPLICATE_INTENT_WINDOW_MS } from '../config/garageConfig';
import { vehicleDefinition } from '../vehicles/catalogue';
import { vehicleUnlock } from './vehicleUnlock';
import type { UpgradeCategory } from '../config/upgradeConfig';
import type { CareerState, ProfileState } from '../career/careerModel';
import { browserStorage, loadProfileSave, writeProfileSave, type LoadSource, type StorageLike } from '../save/saveFile';
import {
  applyPaint as applyPaintRule,
  chargeBustFine as bustFineRule,
  earnCredits as earnRule,
  purchaseUpgrade as purchaseUpgradeRule,
  purchaseVehicle as purchaseVehicleRule,
  selectVehicle as selectVehicleRule,
  type GarageState,
  type TxFailureCode,
  type TxResult,
} from './garageModel';

export interface PersistenceStatus {
  /** True when a transaction may write the save key. */
  readonly writable: boolean;
  readonly source: LoadSource;
  /** Notice for the player, or null. */
  readonly notice: string | null;
}

export interface GarageStore {
  readonly garage: GarageState;
  /** The career progress (Part 9). It is saved in the same write as the garage. */
  readonly career: CareerState;
  readonly persistence: PersistenceStatus;
  /** Outcome of the last user transaction, for the message line. Null before any. */
  readonly lastResult: { readonly ok: boolean; readonly message: string } | null;
}

export type GarageStoreHook = UseBoundStore<StoreApi<GarageStore>>;

/** The result of one profile transaction. A rule returns this; commitProfile returns it after the save step. */
export type ProfileTx<T> =
  | { readonly ok: true; readonly profile: ProfileState; readonly message: string; readonly detail: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface GarageService {
  readonly store: GarageStoreHook;
  getState(): GarageState;
  getProfile(): ProfileState;
  purchaseVehicle(vehicleId: string): TxResult;
  selectVehicle(vehicleId: string): TxResult;
  purchaseUpgrade(vehicleId: string, category: UpgradeCategory): TxResult;
  applyPaint(vehicleId: string, paintId: string): TxResult;
  /** Race rewards and other earnings. The caller guarantees each source is credited once. */
  earnCredits(amount: number, source: string): TxResult;
  /** The busted fine: `percent` of the credits, taken in one save. Null intent: a capture is never a double click. */
  chargeBustFine(percent: number): TxResult;
  /**
   * The single commit path for the whole profile. The career service uses this. A rule returns the next profile or a
   * failure. The result is saved in one write, and the store changes only after the write succeeds.
   */
  commitProfile<T>(rule: (profile: ProfileState) => ProfileTx<T>, intent: string | null, userFacing: boolean): ProfileTx<T>;
}

export interface GarageServiceOptions {
  readonly now?: () => number;
}

export function createGarageService(storage: StorageLike | null, options: GarageServiceOptions = {}): GarageService {
  const now = options.now ?? (() => Date.now());
  const loaded = loadProfileSave(storage);
  const store = create<GarageStore>()(() => ({
    garage: loaded.state,
    career: loaded.career,
    persistence: { writable: loaded.writable, source: loaded.source, notice: loaded.notice },
    lastResult: null,
  }));
  const lastIntentAt = new Map<string, number>();

  /** Applies one profile rule: save first, then update the store. Failures change nothing. */
  function commitProfile<T>(rule: (profile: ProfileState) => ProfileTx<T>, intent: string | null, userFacing: boolean): ProfileTx<T> {
    if (intent !== null) {
      const previous = lastIntentAt.get(intent);
      const time = now();
      if (previous !== undefined && time - previous < DUPLICATE_INTENT_WINDOW_MS) {
        return { ok: false, code: 'duplicate-click', message: 'Ignored a repeated click.' };
      }
      lastIntentAt.set(intent, time);
    }

    const current = store.getState();
    const profile: ProfileState = { garage: current.garage, career: current.career };
    const result = rule(profile);
    if (!result.ok) {
      if (userFacing) store.setState({ lastResult: { ok: false, message: result.message } });
      return result;
    }
    // A rule that changed nothing (for example a duplicate race attempt) saves nothing and touches nothing.
    if (result.profile === profile) return result;

    if (current.persistence.writable && storage !== null) {
      const written = writeProfileSave(storage, result.profile);
      if (!written.ok) {
        const failure: ProfileTx<T> = { ok: false, code: 'save-failed', message: `${written.message} Nothing was charged.` };
        if (userFacing) store.setState({ lastResult: { ok: false, message: failure.message } });
        return failure;
      }
    }

    store.setState({
      garage: result.profile.garage,
      career: result.profile.career,
      lastResult: userFacing ? { ok: true, message: result.message } : current.lastResult,
    });
    return result;
  }

  /**
   * Buys a vehicle. The career rank is checked first, against the saved reputation, in the same commit as the charge.
   * A locked car is refused before any credits move.
   */
  function buyVehicle(vehicleId: string): TxResult {
    const tx = commitProfile<TxResult>(
      (profile) => {
        const vehicle = vehicleDefinition(vehicleId);
        if (vehicle) {
          const unlock = vehicleUnlock(vehicle, profile.career.reputation);
          if (!unlock.unlocked) {
            return {
              ok: false,
              code: 'locked-rank',
              message: `Reach ${unlock.requiredName} (${unlock.requiredReputation} reputation) to buy the ${vehicle.name}. ${unlock.reputationToGo} to go.`,
            };
          }
        }
        const result = purchaseVehicleRule(profile.garage, vehicleId);
        if (!result.ok) return { ok: false, code: result.code, message: result.message };
        return { ok: true, profile: { garage: result.state, career: profile.career }, message: result.message, detail: result };
      },
      `buy:${vehicleId}`,
      true,
    );
    if (tx.ok) return tx.detail;
    return { ok: false, code: tx.code as TxFailureCode, message: tx.message };
  }

  /** The garage rules, run through the one profile commit. */
  function commitGarage(rule: (state: GarageState) => TxResult, intent: string | null, userFacing: boolean): TxResult {
    const tx = commitProfile<TxResult>(
      (profile) => {
        const result = rule(profile.garage);
        if (!result.ok) return { ok: false, code: result.code, message: result.message };
        return { ok: true, profile: { garage: result.state, career: profile.career }, message: result.message, detail: result };
      },
      intent,
      userFacing,
    );
    if (tx.ok) return tx.detail;
    // The codes come only from the garage rules and the save step, so they are all garage failure codes.
    return { ok: false, code: tx.code as TxFailureCode, message: tx.message };
  }

  return {
    store,
    getState: () => store.getState().garage,
    getProfile: () => {
      const state = store.getState();
      return { garage: state.garage, career: state.career };
    },
    purchaseVehicle: (vehicleId) => buyVehicle(vehicleId),
    selectVehicle: (vehicleId) => commitGarage((state) => selectVehicleRule(state, vehicleId), `select:${vehicleId}`, true),
    purchaseUpgrade: (vehicleId, category) =>
      commitGarage((state) => purchaseUpgradeRule(state, vehicleId, category), `upgrade:${vehicleId}:${category}`, true),
    applyPaint: (vehicleId, paintId) => commitGarage((state) => applyPaintRule(state, vehicleId, paintId), `paint:${vehicleId}:${paintId}`, true),
    earnCredits: (amount, source) => commitGarage((state) => earnRule(state, amount, source), null, false),
    chargeBustFine: (percent) => commitGarage((state) => bustFineRule(state, percent), null, false),
    commitProfile,
  };
}

/** The app's single profile service, backed by browser storage. Loaded once when the module is first imported. */
export const garageService = createGarageService(browserStorage());

/** Hook for components. Read-only from the UI: changes go through garageService or careerService. */
export const useGarageStore = garageService.store;
