/*
 * A read-only snapshot of the player's save for the prototype's landing and status line. It uses the game's own
 * load rule (save/saveFile.ts loadProfileSave), so the car, paint, and credits shown here are the same ones the game
 * loads. The storage passed in refuses every write. The landing never changes the save.
 */
import { paintDefinition } from '../../config/paintConfig';
import type { VehicleConfig } from '../../config/vehicleConfig';
import { ETERNIX_PROTOTYPE_CONFIG } from '../../config/eternixPrototypeConfig';
import { activeDesign, activePaint, activeSpecs } from '../../garage/activeVehicle';
import type { GarageState } from '../../garage/garageModel';
import { browserStorage, loadProfileSave, type LoadSource, type StorageLike } from '../../save/saveFile';
import { vehicleDefinition } from '../../vehicles/catalogue';
import type { VehicleDesignProfile } from '../../vehicles/designProfile';

export interface CarSummary {
  readonly name: string;
  readonly vehicleClass: string;
  readonly config: VehicleConfig;
  readonly design: VehicleDesignProfile;
  readonly paintColor: string;
  readonly paintLabel: string;
}

export interface SaveSnapshot {
  readonly state: GarageState;
  readonly source: LoadSource;
  /** Plain-language status of the save, shown in the status line and in the loader. */
  readonly saveLabel: string;
  /** Notice from the load rule, or null. */
  readonly notice: string | null;
  readonly car: CarSummary;
}

const SOURCE_LABEL: Readonly<Record<LoadSource, string>> = {
  empty: 'No save yet',
  current: 'Saved in this browser',
  migrated: 'Saved, updated to the current format',
  corrupt: 'Unreadable save, copied to a backup',
  newer: 'Saved by a newer build',
  unavailable: 'Browser storage unavailable',
};

/** Reads everything and writes nothing. A write attempt throws, and the load rule treats that as a failed backup copy. */
function readOnly(storage: StorageLike): StorageLike {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: () => {
      throw new Error('The ETERNIX prototype reads the save and never writes it.');
    },
  };
}

export function readSaveSnapshot(): SaveSnapshot {
  const storage = browserStorage();
  const loaded = loadProfileSave(storage === null ? null : readOnly(storage));
  const state = loaded.state;
  const specs = activeSpecs(state);
  const definition = vehicleDefinition(specs.vehicleId);
  const paint = paintDefinition(activePaint(state));
  return {
    state,
    source: loaded.source,
    saveLabel: SOURCE_LABEL[loaded.source],
    notice: loaded.notice,
    car: {
      name: definition ? definition.name : specs.vehicleId,
      vehicleClass: definition ? definition.vehicleClass : '',
      config: specs.config,
      design: activeDesign(state),
      paintColor: paint ? paint.color : ETERNIX_PROTOTYPE_CONFIG.colours.fallbackPaint,
      paintLabel: paint ? paint.label : activePaint(state),
    },
  };
}
