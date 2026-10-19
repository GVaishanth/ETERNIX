import { describe, expect, it } from 'vitest';
import { createDefaultGarage, purchaseVehicle, type GarageState } from '../garage/garageModel';
import { createDefaultCareer, type ProfileState } from '../career/careerModel';
import { SAVE_BACKUP_KEY, SAVE_KEY, SAVE_SCHEMA_VERSION, loadProfileSave, migrateSave, writeProfileSave, type StorageLike } from './saveFile';

/** A profile with a new career around the given garage, for writes in these tests. */
function profileOf(garage: GarageState): ProfileState {
  return { garage, career: createDefaultCareer() };
}

/** In-memory storage. `failWrites` and `failReads` simulate a full or blocked browser store. */
class FakeStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failWrites = false;
  failReads = false;
  getItem(key: string): string | null {
    if (this.failReads) throw new Error('blocked');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota');
    this.items.set(key, value);
  }
}

function richGarage(): GarageState {
  const result = purchaseVehicle({ ...createDefaultGarage(), credits: 9000 }, 'ember-gt');
  if (!result.ok) throw new Error('setup failed');
  return result.state;
}

describe('save file: new game and round trip', () => {
  it('a new game (no key) loads the default garage and allows writes', () => {
    const storage = new FakeStorage();
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('empty');
    expect(loaded.writable).toBe(true);
    expect(loaded.state).toEqual(createDefaultGarage());
  });

  it('writes the versioned envelope and reads back the same garage', () => {
    const storage = new FakeStorage();
    const garage = richGarage();
    expect(writeProfileSave(storage, profileOf(garage)).ok).toBe(true);
    const parsed = JSON.parse(storage.items.get(SAVE_KEY) ?? 'null') as { schemaVersion: number; garage: GarageState };
    expect(parsed.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('current');
    expect(loaded.state).toEqual(garage);
    expect(loaded.repairs).toEqual([]);
  });

  it('keeps catalogue data out of the save: only ids, numbers, and paint ids are written', () => {
    const storage = new FakeStorage();
    writeProfileSave(storage, profileOf(richGarage()));
    const text = storage.items.get(SAVE_KEY) ?? '';
    for (const forbidden of ['priceCredits', 'handling', 'engineAccelerationMps2', 'Ember GT', 'summary', 'limits']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('keeps other top-level sections when the garage is written', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, garage: createDefaultGarage(), futureSection: { a: 1 } }));
    writeProfileSave(storage, profileOf(richGarage()));
    const parsed = JSON.parse(storage.items.get(SAVE_KEY) ?? '{}') as { futureSection?: unknown };
    expect(parsed.futureSection).toEqual({ a: 1 });
  });
});

describe('save file: migration', () => {
  it('migrates an unversioned (schema 0) garage to the current schema, keeping its data', () => {
    const storage = new FakeStorage();
    const garage = richGarage();
    storage.setItem(SAVE_KEY, JSON.stringify(garage));
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('migrated');
    expect(loaded.state).toEqual(garage);
    expect(loaded.writable).toBe(true);
  });

  it('migrateSave reports the schema 0 path and the current path', () => {
    const v0 = migrateSave({ credits: 1 });
    expect(v0.ok && v0.migrated).toBe(true);
    const v1 = migrateSave({ schemaVersion: 1, garage: { credits: 1 } });
    expect(v1.ok && v1.migrated).toBe(true);
    const v2 = migrateSave({ schemaVersion: 2, garage: { credits: 1 }, career: {} });
    expect(v2.ok && v2.migrated).toBe(false);
  });

  it('a schema-1 save with a missing garage section loads the default garage, with a repair note', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 1 }));
    const loaded = loadProfileSave(storage);
    // A schema-1 save is migrated to schema 2 on load. Its missing garage section is repaired, as before.
    expect(loaded.source).toBe('migrated');
    expect(loaded.state.selectedVehicleId).toBe('kestrel-hatch');
    expect(loaded.repairs.length).toBeGreaterThan(0);
  });

  it('a save whose garage section is not an object is copied to the backup before the default garage replaces it', () => {
    const storage = new FakeStorage();
    const text = JSON.stringify({ schemaVersion: 2, garage: 'damaged', career: createDefaultCareer() });
    storage.setItem(SAVE_KEY, text);
    const loaded = loadProfileSave(storage);
    expect(loaded.state).toEqual(createDefaultGarage());
    expect(storage.items.get(SAVE_BACKUP_KEY)).toBe(text);
    expect(loaded.writable).toBe(true);
    expect(loaded.notice).toMatch(/garage could not be read/);
  });

  it('when a damaged garage cannot be copied to the backup, writes are disabled so the save is not replaced', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 2, garage: null, career: createDefaultCareer() }));
    storage.failWrites = true;
    const loaded = loadProfileSave(storage);
    expect(loaded.writable).toBe(false);
    expect(loaded.notice).toMatch(/could not be copied/);
  });

  it('a save with a repaired value loads with a notice, and is still writable', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 1, garage: { credits: 500, selectedVehicleId: 'ghost', vehicles: { 'kestrel-hatch': {} } } }));
    const loaded = loadProfileSave(storage);
    expect(loaded.state.credits).toBe(500);
    expect(loaded.notice).toMatch(/reset to safe values/);
    expect(loaded.writable).toBe(true);
  });
});

describe('save file: corrupt and newer data', () => {
  it('unreadable JSON falls back to the default garage, copies the text to a backup, and stays writable', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('corrupt');
    expect(loaded.state).toEqual(createDefaultGarage());
    expect(storage.items.get(SAVE_BACKUP_KEY)).toBe('{not json');
    expect(loaded.writable).toBe(true);
  });

  it('a wrong schema version type is treated as corrupt', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 'one', garage: {} }));
    expect(loadProfileSave(storage).source).toBe('corrupt');
  });

  it('when the backup cannot be written, the corrupt save is not overwritten (writes are disabled)', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      if (key === SAVE_BACKUP_KEY) throw new Error('quota');
      originalSet(key, value);
    };
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('corrupt');
    expect(loaded.writable).toBe(false);
    expect(storage.items.get(SAVE_KEY)).toBe('{not json');
  });

  it('a save from a newer schema is kept untouched, and the session does not write', () => {
    const storage = new FakeStorage();
    const newer = JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION + 1, garage: { credits: 99999 } });
    storage.setItem(SAVE_KEY, newer);
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('newer');
    expect(loaded.writable).toBe(false);
    expect(storage.items.get(SAVE_KEY)).toBe(newer);
    expect(storage.items.has(SAVE_BACKUP_KEY)).toBe(false);
  });

  it('blocked storage on read plays on defaults with writes disabled', () => {
    const storage = new FakeStorage();
    storage.failReads = true;
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('unavailable');
    expect(loaded.writable).toBe(false);
    expect(loaded.notice).toMatch(/blocked/);
  });

  it('no storage at all plays on defaults with writes disabled', () => {
    const loaded = loadProfileSave(null);
    expect(loaded.source).toBe('unavailable');
    expect(loaded.writable).toBe(false);
  });

  it('a failed write reports failure and does not throw', () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    const result = writeProfileSave(storage, profileOf(richGarage()));
    expect(result.ok).toBe(false);
  });
});

describe('save file: career section (schema 2)', () => {
  function startedCareer() {
    return { ...createDefaultCareer(), started: true, reputation: 50, completedEvents: ['career-warmup'], defeatedRivals: ['mara-quill'] };
  }

  it('a schema-1 save loads with a new career that has not started, and keeps the garage', () => {
    const storage = new FakeStorage();
    const garage = richGarage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 1, garage }));
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('migrated');
    expect(loaded.writable).toBe(true);
    expect(loaded.career.started).toBe(false);
    expect(loaded.state.credits).toBe(garage.credits);
  });

  it('a started career round-trips through one write and reloads the same progress', () => {
    const storage = new FakeStorage();
    const career = startedCareer();
    writeProfileSave(storage, { garage: richGarage(), career });
    const loaded = loadProfileSave(storage);
    expect(loaded.source).toBe('current');
    expect(loaded.career).toEqual(career);
    expect(loaded.repairs).toEqual([]);
  });

  it('one commit is one storage write, so the garage and the career cannot be saved apart', () => {
    const storage = new FakeStorage();
    let writes = 0;
    const original = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      writes += 1;
      original(key, value);
    };
    writeProfileSave(storage, { garage: richGarage(), career: startedCareer() });
    expect(writes).toBe(1);
  });

  it('a career that is not an object is backed up before it is replaced, and writes stay on', () => {
    const storage = new FakeStorage();
    const raw = JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, garage: richGarage(), career: 'broken' });
    storage.setItem(SAVE_KEY, raw);
    const loaded = loadProfileSave(storage);
    expect(storage.items.get(SAVE_BACKUP_KEY)).toBe(raw);
    expect(loaded.career.started).toBe(false);
    expect(loaded.writable).toBe(true);
    expect(loaded.state.credits).toBe(richGarage().credits);
  });

  it('a career written by a newer career version is kept untouched, and writes are off', () => {
    const storage = new FakeStorage();
    const raw = JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, garage: richGarage(), career: { version: 99, started: true } });
    storage.setItem(SAVE_KEY, raw);
    const loaded = loadProfileSave(storage);
    expect(loaded.writable).toBe(false);
    expect(storage.items.get(SAVE_KEY)).toBe(raw);
  });

  it('a damaged career section is repaired field by field and the repairs are reported', () => {
    const storage = new FakeStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, garage: richGarage(), career: { started: true, reputation: -4, completedEvents: ['nope'] } }));
    const loaded = loadProfileSave(storage);
    expect(loaded.career.started).toBe(true);
    expect(loaded.career.reputation).toBe(0);
    expect(loaded.repairs.length).toBeGreaterThan(0);
    expect(loaded.notice).not.toBeNull();
  });
});
