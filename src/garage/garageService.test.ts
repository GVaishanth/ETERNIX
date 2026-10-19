import { describe, expect, it } from 'vitest';
import { DUPLICATE_INTENT_WINDOW_MS, GARAGE_CONFIG } from '../config/garageConfig';
import { SAVE_KEY } from '../save/saveFile';
import { createGarageService } from './garageService';
import { createDefaultGarage } from './garageModel';
import type { StorageLike } from '../save/saveFile';

class FakeStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota');
    this.items.set(key, value);
  }
}

/** A service with a controllable clock, so the duplicate-click window can be tested exactly. */
function serviceWith(storage: StorageLike | null) {
  let time = 10_000;
  const service = createGarageService(storage, { now: () => time });
  return {
    service,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('garage service: transactions', () => {
  it('charges a purchase exactly once and saves it', () => {
    const storage = new FakeStorage();
    const { service } = serviceWith(storage);
    const before = service.getState().credits;
    const result = service.purchaseVehicle('rook-rs');
    expect(result.ok).toBe(true);
    expect(service.getState().credits).toBe(before - 950);
    expect(storage.items.has(SAVE_KEY)).toBe(true);
  });

  it('a repeated click with the same intent is ignored, so it cannot charge twice', () => {
    const { service } = serviceWith(new FakeStorage());
    const before = service.getState().credits;
    expect(service.purchaseVehicle('rook-rs').ok).toBe(true);
    const second = service.purchaseVehicle('rook-rs');
    expect(second.ok).toBe(false);
    expect(!second.ok && second.code).toBe('duplicate-click');
    expect(service.getState().credits).toBe(before - 950);
  });

  it('a rapid double upgrade click buys one tier, not two', () => {
    const { service } = serviceWith(new FakeStorage());
    service.purchaseVehicle('rook-rs');
    const before = service.getState().credits;
    expect(service.purchaseUpgrade('rook-rs', 'engine').ok).toBe(true);
    expect(service.purchaseUpgrade('rook-rs', 'engine').ok).toBe(false);
    expect(service.getState().vehicles['rook-rs']?.upgrades.engine).toBe(1);
    expect(service.getState().credits).toBe(before - GARAGE_CONFIG.upgradeTierCostCredits[0]!);
  });

  it('the same intent works again once the window has passed', () => {
    const { service, advance } = serviceWith(new FakeStorage());
    service.earnCredits(5000, 'test top-up');
    service.purchaseVehicle('rook-rs');
    service.purchaseUpgrade('rook-rs', 'engine');
    advance(DUPLICATE_INTENT_WINDOW_MS + 1);
    expect(service.purchaseUpgrade('rook-rs', 'engine').ok).toBe(true);
    expect(service.getState().vehicles['rook-rs']?.upgrades.engine).toBe(2);
  });

  it('a failed transaction changes nothing, not even the balance', () => {
    const { service } = serviceWith(new FakeStorage());
    const before = service.getState();
    const result = service.purchaseVehicle('halcyon-gt');
    expect(result.ok).toBe(false);
    expect(service.getState()).toEqual(before);
  });

  it('if the save cannot be written, the purchase is refused and nothing is charged', () => {
    const storage = new FakeStorage();
    const { service } = serviceWith(storage);
    storage.failWrites = true;
    const before = service.getState();
    const result = service.purchaseVehicle('rook-rs');
    expect(!result.ok && result.code).toBe('save-failed');
    expect(service.getState()).toEqual(before);
  });

  it('when the save is not writable (newer version), transactions apply in memory and nothing is written', () => {
    const storage = new FakeStorage();
    const newer = JSON.stringify({ schemaVersion: 99, garage: { credits: 5 } });
    storage.items.set(SAVE_KEY, newer);
    const { service } = serviceWith(storage);
    expect(service.store.getState().persistence.writable).toBe(false);
    expect(service.purchaseVehicle('rook-rs').ok).toBe(true);
    expect(storage.items.get(SAVE_KEY)).toBe(newer);
  });

  it('race earnings are credited without the click guard, so each credit lands', () => {
    const { service } = serviceWith(new FakeStorage());
    const before = service.getState().credits;
    service.earnCredits(300, 'race a#1');
    service.earnCredits(300, 'race a#2');
    expect(service.getState().credits).toBe(before + 600);
  });

  it('shows the last user-facing outcome for the message line', () => {
    const { service } = serviceWith(new FakeStorage());
    service.purchaseVehicle('halcyon-gt');
    expect(service.store.getState().lastResult?.ok).toBe(false);
    service.selectVehicle('kestrel-hatch');
    expect(service.store.getState().lastResult?.ok).toBe(false);
  });
});

describe('garage service: persistence across a reload', () => {
  it('a new service on the same storage restores ownership, selection, upgrades, paint, and credits', () => {
    const storage = new FakeStorage();
    const first = serviceWith(storage);
    first.service.earnCredits(5000, 'test top-up');
    first.service.purchaseVehicle('ember-gt');
    first.advance(1000);
    first.service.purchaseUpgrade('ember-gt', 'tires');
    first.advance(1000);
    first.service.applyPaint('ember-gt', 'midnight');
    first.advance(1000);
    first.service.selectVehicle('ember-gt');
    const expected = first.service.getState();

    const reloaded = createGarageService(storage);
    expect(reloaded.getState()).toEqual(expected);
    expect(reloaded.getState().selectedVehicleId).toBe('ember-gt');
  });

  it('a corrupt save loads as the default garage, and the next transaction saves cleanly', () => {
    const storage = new FakeStorage();
    storage.items.set(SAVE_KEY, '<<<');
    const { service, advance } = serviceWith(storage);
    expect(service.getState()).toEqual(createDefaultGarage());
    advance(1000);
    expect(service.purchaseVehicle('vesper-c2').ok).toBe(true);
    const reloaded = createGarageService(storage);
    expect(reloaded.getState().vehicles['vesper-c2']).toBeDefined();
  });
});

/** Counts successful writes to storage, so a test can prove that a failed or unchanged commit writes nothing. */
class CountingStorage extends FakeStorage {
  writes = 0;
  override setItem(key: string, value: string): void {
    this.writes += 1;
    super.setItem(key, value);
  }
}

describe('garage service: commitProfile (the one commit path)', () => {
  it('a successful rule saves once, then updates the store', () => {
    const storage = new CountingStorage();
    const { service } = serviceWith(storage);
    const before = service.getProfile();
    const tx = service.commitProfile((profile) => ({
      ok: true,
      profile: { ...profile, garage: { ...profile.garage, credits: profile.garage.credits + 7 } },
      message: 'Added 7.',
      detail: 7,
    }), null, true);
    expect(tx.ok).toBe(true);
    expect(storage.writes).toBe(1);
    expect(service.getProfile().garage.credits).toBe(before.garage.credits + 7);
    expect(storage.items.get(SAVE_KEY)).toContain(String(before.garage.credits + 7));
  });

  it('a refused rule writes nothing and changes nothing', () => {
    const storage = new CountingStorage();
    const { service } = serviceWith(storage);
    const before = service.getProfile();
    const tx = service.commitProfile(() => ({ ok: false, code: 'refused', message: 'No.' }), null, true);
    expect(tx.ok).toBe(false);
    expect(storage.writes).toBe(0);
    expect(service.getProfile()).toEqual(before);
  });

  it('a save failure applies nothing, says nothing was charged, and leaves the store as it was', () => {
    const storage = new CountingStorage();
    const { service } = serviceWith(storage);
    const before = service.getProfile();
    storage.failWrites = true;
    const tx = service.commitProfile((profile) => ({
      ok: true,
      profile: { ...profile, garage: { ...profile.garage, credits: profile.garage.credits + 99 } },
      message: 'Added 99.',
      detail: null,
    }), null, true);
    expect(tx.ok).toBe(false);
    if (!tx.ok) {
      expect(tx.code).toBe('save-failed');
      expect(tx.message).toMatch(/Nothing was charged/);
    }
    expect(service.getProfile()).toEqual(before);
  });

  it('a rule that returns the same profile reference saves nothing', () => {
    const storage = new CountingStorage();
    const { service } = serviceWith(storage);
    const writesBefore = storage.writes;
    const tx = service.commitProfile((profile) => ({ ok: true, profile, message: 'Nothing to change.', detail: null }), null, true);
    expect(tx.ok).toBe(true);
    expect(storage.writes).toBe(writesBefore);
  });

  it('a repeated intent inside the window is refused once, then allowed after the window', () => {
    const storage = new CountingStorage();
    const { service, advance } = serviceWith(storage);
    const rule = (profile: ReturnType<typeof service.getProfile>) => ({ ok: true as const, profile: { ...profile }, message: 'ok', detail: null });
    expect(service.commitProfile(rule, 'buy-x', true).ok).toBe(true);
    const second = service.commitProfile(rule, 'buy-x', true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('duplicate-click');
    advance(DUPLICATE_INTENT_WINDOW_MS + 1);
    expect(service.commitProfile(rule, 'buy-x', true).ok).toBe(true);
  });
});

describe('garage service: rank gate for catalogue cars', () => {
  it('refuses a car whose career rank is not reached, and charges nothing', () => {
    const { service } = serviceWith(new FakeStorage());
    service.earnCredits(5000, 'test top-up');
    const before = service.getState();
    const result = service.purchaseVehicle('vandal-r');
    expect(!result.ok && result.code).toBe('locked-rank');
    expect(service.getState()).toEqual(before);
  });

  it('buys the same car once the reputation reaches its rank, and charges its price once', () => {
    const { service } = serviceWith(new FakeStorage());
    service.earnCredits(5000, 'test top-up');
    service.commitProfile<null>(
      (profile) => ({ ok: true, profile: { garage: profile.garage, career: { ...profile.career, reputation: 40 } }, message: 'test: reputation', detail: null }),
      null,
      false,
    );
    const before = service.getState().credits;
    expect(service.purchaseVehicle('vandal-r').ok).toBe(true);
    expect(service.getState().credits).toBe(before - 2400);
    expect(service.purchaseVehicle('vandal-r').ok).toBe(false);
    expect(service.getState().credits).toBe(before - 2400);
  });
});
