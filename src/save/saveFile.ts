/**
 * Browser localStorage, one key, one versioned envelope. Part 8 wrote schema 1 (the garage). Part 9 writes schema 2:
 * the garage and the career, in one write, so a commit either saves both or neither.
 *
 * Format (schema version 2):
 *   {
 *     "schemaVersion": 2,
 *     "career": { "version": 1, "started": true, "reputation": 10, "completedEvents": [...], ... },
 *     "garage": {
 *       "credits": 1500,
 *       "selectedVehicleId": "kestrel-hatch",
 *       "vehicles": { "<vehicleId>": { "upgrades": { "engine": 0, "transmission": 0, "tires": 0, "brakes": 0 }, "paintId": "cherry" } }
 *     }
 *   }
 *
 * The save holds ids and numbers only. The catalogue, prices, and limits are code and config, never saved, so a
 * balance change applies to existing saves without a migration.
 *
 * Load rules (never throws):
 * - No key: a new game. Writes are allowed.
 * - Unversioned object (schema 0) and schema 1: migrated to schema 2. The garage is kept, and the career starts as a
 *   new career that has not begun. An existing profile is never reset by this, because a schema 0 or 1 save has no
 *   career to lose.
 * - Schema 2: the garage and the career are normalized. Bad values fall back to safe defaults, and each fix is reported.
 * - A career section that is present but not an object is copied to the backup key first, as with unreadable JSON.
 *   Writes are allowed only if that copy succeeded, so the career is never overwritten without a copy.
 * - A career written by a newer career data version is kept untouched, and writes are disabled.
 * - Schema above 2 (a newer build wrote it): the save is kept untouched. The session plays on defaults in memory,
 *   and writes are disabled, so newer progress is never overwritten.
 * - Unreadable JSON, or a wrong shape: the raw text is copied to SAVE_BACKUP_KEY first. Writes are allowed only if
 *   the copy succeeded, so the backup is never lost.
 * - Storage throws (blocked, full, or private mode): play on defaults in memory, with writes disabled and a notice.
 */
import { createDefaultGarage, normalizeGarage, type GarageState } from '../garage/garageModel';
import { CAREER_DATA_VERSION, createDefaultCareer, normalizeCareer, type CareerState, type ProfileState } from '../career/careerModel';

// The storage keys keep the original 'street-racer' prefix on purpose. Renaming them would hide existing saves.
export const SAVE_KEY = 'street-racer.save';
export const SAVE_BACKUP_KEY = 'street-racer.save.backup';
export const SAVE_SCHEMA_VERSION = 2;

/** The subset of the Storage API this module uses. Tests pass an in-memory fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LoadSource = 'empty' | 'current' | 'migrated' | 'corrupt' | 'newer' | 'unavailable';

export interface LoadResult {
  readonly state: GarageState;
  /** The career section (Part 9). A new career for a save that has none. */
  readonly career: CareerState;
  readonly source: LoadSource;
  /** Whether a later transaction may write the save key. */
  readonly writable: boolean;
  /** Repairs made while normalizing. Empty for a clean load. */
  readonly repairs: readonly string[];
  /** Plain-language notice for the player, or null when there is nothing to say. */
  readonly notice: string | null;
}

type Migrated = { readonly ok: true; readonly garage: unknown; readonly career: unknown; readonly migrated: boolean } | { readonly ok: false; readonly reason: 'newer' | 'corrupt' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Migrates any parsed save to the current schema's payload. Pure. Add one branch per schema bump, and keep the older
 * branch working, so every save written by an earlier build still loads.
 */
export function migrateSave(parsed: unknown): Migrated {
  if (!isRecord(parsed)) return { ok: false, reason: 'corrupt' };
  if (!Object.hasOwn(parsed, 'schemaVersion')) {
    // Schema 0: the unversioned object is the garage itself. Kept so a hand-made or older save still loads.
    return { ok: true, garage: parsed, career: undefined, migrated: true };
  }
  const version = parsed.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, reason: 'corrupt' };
  if (version > SAVE_SCHEMA_VERSION) return { ok: false, reason: 'newer' };
  // Schema 1 has no career section, so it migrates with career undefined. Schema 2 carries one.
  return { ok: true, garage: parsed.garage, career: parsed.career, migrated: version < SAVE_SCHEMA_VERSION };
}

function defaultResult(source: LoadSource, writable: boolean, notice: string | null): LoadResult {
  return { state: createDefaultGarage(), career: createDefaultCareer(), source, writable, repairs: [], notice };
}

/** Copies unreadable text under the backup key. Returns false when the copy could not be made. */
function copyUnreadable(storage: StorageLike, text: string): boolean {
  try {
    storage.setItem(SAVE_BACKUP_KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** Reads and normalizes the profile (garage and career). Never throws, and never writes except the backup copy. */
export function loadProfileSave(storage: StorageLike | null): LoadResult {
  if (storage === null) {
    return defaultResult('unavailable', false, 'Browser storage is unavailable. Progress lasts until you reload.');
  }

  let text: string | null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return defaultResult('unavailable', false, 'Browser storage is blocked. Progress lasts until you reload.');
  }
  if (text === null) return defaultResult('empty', true, null);

  let parsed: unknown;
  let parseFailed = false;
  try {
    parsed = JSON.parse(text);
  } catch {
    parseFailed = true;
  }

  const migrated: Migrated = parseFailed ? { ok: false, reason: 'corrupt' } : migrateSave(parsed);

  if (!migrated.ok && migrated.reason === 'newer') {
    return defaultResult(
      'newer',
      false,
      'Your save was written by a newer version of the game. It is kept as it is, so this session does not save.',
    );
  }

  if (!migrated.ok) {
    // Keep the unreadable text before anything else. Writes stay enabled only if the copy was made.
    const backedUp = copyUnreadable(storage, text);
    return defaultResult(
      'corrupt',
      backedUp,
      backedUp
        ? 'Your saved progress could not be read. A copy was kept, and you start with a new garage.'
        : 'Your saved progress could not be read and could not be copied. This session does not save.',
    );
  }

  // A garage section that is missing or not an object is copied to the backup key before the default garage replaces
  // it, as the career section is (Part 11). Without the copy, the next write would erase the player's garage.
  const garageReadable = isRecord(migrated.garage);
  const garageBackedUp = garageReadable ? true : copyUnreadable(storage, text);
  const report = normalizeGarage(migrated.garage);
  const career = loadCareerSection(storage, text, migrated.career);
  const repairs = [...report.repairs, ...career.repairs];
  const garageNotice = garageReadable
    ? null
    : garageBackedUp
      ? 'Your saved garage could not be read. A copy of the save was kept, and the garage starts again.'
      : 'Your saved garage could not be read and could not be copied. This session does not save.';
  return {
    state: report.state,
    career: career.state,
    source: migrated.migrated ? 'migrated' : 'current',
    writable: garageBackedUp && career.writable,
    repairs,
    notice: garageNotice ?? career.notice ?? (repairs.length > 0 ? 'Some saved data was reset to safe values.' : null),
  };
}

interface CareerSectionLoad {
  readonly state: CareerState;
  readonly writable: boolean;
  readonly repairs: readonly string[];
  readonly notice: string | null;
}

/**
 * Reads the career section. A missing section is a new career (a schema 1 save, or a first run). A section that is
 * not an object is backed up before it is replaced, and writes stay on only if the copy worked. A section written by a
 * newer career version is kept, and writes are off, so it is not overwritten.
 */
function loadCareerSection(storage: StorageLike, text: string, raw: unknown): CareerSectionLoad {
  if (raw === undefined) return { state: createDefaultCareer(), writable: true, repairs: [], notice: null };
  if (isRecord(raw) && typeof raw.version === 'number' && raw.version > CAREER_DATA_VERSION) {
    return {
      state: createDefaultCareer(),
      writable: false,
      repairs: [],
      notice: 'Your career was saved by a newer version of the game. It is kept as it is, so this session does not save.',
    };
  }
  if (!isRecord(raw)) {
    const backedUp = copyUnreadable(storage, text);
    return {
      state: createDefaultCareer(),
      writable: backedUp,
      repairs: ['career data was unreadable: reset to a new career'],
      notice: backedUp
        ? 'Your career data could not be read. A copy of the save was kept, and the career starts again.'
        : 'Your career data could not be read and could not be copied. This session does not save.',
    };
  }
  const report = normalizeCareer(raw);
  return { state: report.state, writable: true, repairs: report.repairs, notice: null };
}

export type WriteResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Writes the whole profile (garage and career) in one storage call, so the two cannot be saved apart. Keeps any other
 * top-level sections already in a schema-2 save, so later sections are not erased by a write.
 */
export function writeProfileSave(storage: StorageLike, profile: ProfileState): WriteResult {
  let existing: Record<string, unknown> = {};
  try {
    const text = storage.getItem(SAVE_KEY);
    if (text !== null) {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed) && parsed.schemaVersion === SAVE_SCHEMA_VERSION) existing = parsed;
    }
  } catch {
    existing = {};
  }
  const envelope = { ...existing, schemaVersion: SAVE_SCHEMA_VERSION, garage: profile.garage, career: profile.career };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(envelope));
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not save: browser storage is full or blocked.' };
  }
}

/** The browser's localStorage, or null when it is missing or blocked. Never throws. */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    // Touching the property can throw when storage is blocked. Probe with a read.
    window.localStorage.getItem(SAVE_KEY);
    return window.localStorage;
  } catch {
    return null;
  }
}
