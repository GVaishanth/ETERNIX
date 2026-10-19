/*
 * Automated integration tests for the career service on the real garage commit path (Part 9). An in-memory store stands
 * in for the browser, so a test can reload a profile and inspect what was written.
 */
import { describe, expect, it } from 'vitest';
import { createGarageService } from '../garage/garageService';
import { SAVE_KEY, SAVE_SCHEMA_VERSION, type StorageLike } from '../save/saveFile';
import { createCareerService, ALL_RACE_IDS } from './careerService';
import { CAREER_RACE_IDS } from './careerRaces';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  writes = 0;
  failWrites = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('full');
    this.writes += 1;
    this.items.set(key, value);
  }
}

function setup(storage: StorageLike | null = new MemoryStorage()) {
  let clock = 0;
  const garage = createGarageService(storage, { now: () => clock });
  const career = createCareerService(garage, ALL_RACE_IDS);
  return {
    storage,
    garage,
    career,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

/** A finished attempt of a career race, with the session that produced it. */
function finished(raceEventId: string, attemptId: number, place: number, raceCredits: number, sessionId = 'sessA') {
  return { raceEventId, sessionId, attemptId, outcome: 'finished' as const, place, finishSeconds: 120, raceCredits };
}

describe('career service: start and tracking', () => {
  it('starting the career saves it, and a second start is refused without a reset', () => {
    const { career, storage } = setup();
    expect(career.start().ok).toBe(true);
    const saved = JSON.parse((storage as MemoryStorage).items.get(SAVE_KEY) ?? '{}') as { schemaVersion: number; career: { started: boolean } };
    expect(saved.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(saved.career.started).toBe(true);
    const again = career.start();
    expect(again.ok).toBe(false);
    expect(career.profile().career.started).toBe(true);
  });

  it('tracking a locked event is refused, and nothing is saved', () => {
    const { career, storage } = setup();
    career.start();
    const writesBefore = (storage as MemoryStorage).writes;
    const result = career.track('rival-teo-challenge');
    expect(result.ok).toBe(false);
    expect((storage as MemoryStorage).writes).toBe(writesBefore);
  });
});

describe('career service: race results', () => {
  it('a career win is saved once, with its credits and reputation in one write', () => {
    const { career, storage, garage } = setup();
    career.start();
    const before = garage.getState().credits;
    const writes = (storage as MemoryStorage).writes;
    const tx = career.applyRaceResult(finished('career-warmup-race', 1, 1, 150));
    expect(tx.ok).toBe(true);
    expect((storage as MemoryStorage).writes).toBe(writes + 1);
    expect(career.profile().career.reputation).toBe(15);
    expect(garage.getState().credits - before).toBe(150 + 100);
    expect(career.noticeStore.getState().lastOutcome?.completedEventTitle).toBe('Harbour Warm-Up');
  });

  it('the same attempt delivered twice pays once and writes nothing the second time', () => {
    const { career, storage, garage } = setup();
    career.start();
    career.applyRaceResult(finished('career-warmup-race', 1, 1, 150));
    const credits = garage.getState().credits;
    const writes = (storage as MemoryStorage).writes;
    const again = career.applyRaceResult(finished('career-warmup-race', 1, 1, 150));
    expect(again.ok).toBe(true);
    expect(garage.getState().credits).toBe(credits);
    expect((storage as MemoryStorage).writes).toBe(writes);
  });

  it('a save failure applies nothing: no credits, no reputation, and no notice', () => {
    const storage = new MemoryStorage();
    const { career, garage } = setup(storage);
    career.start();
    const credits = garage.getState().credits;
    storage.failWrites = true;
    const tx = career.applyRaceResult(finished('career-warmup-race', 1, 1, 150));
    expect(tx.ok).toBe(false);
    expect(garage.getState().credits).toBe(credits);
    expect(career.profile().career.reputation).toBe(0);
    expect(career.noticeStore.getState().lastOutcome).toBeNull();
    expect(career.noticeStore.getState().error).toMatch(/Could not save/);
  });

  it('a result for an unknown race id is refused and grants nothing', () => {
    const { career, garage } = setup();
    career.start();
    const credits = garage.getState().credits;
    const tx = career.applyRaceResult(finished('no-such-race', 1, 1, 999));
    expect(tx.ok).toBe(false);
    expect(garage.getState().credits).toBe(credits);
  });

  it('the same attempt number in a new session is recorded (no false duplicate after a reload)', () => {
    const storage = new MemoryStorage();
    const first = setup(storage);
    first.career.start();
    first.career.applyRaceResult(finished('career-warmup-race', 1, 3, 0, 'sessA'));
    // A reload: a new garage service and career service over the same storage, with a new session.
    const second = setup(storage);
    expect(second.career.profile().career.completedEvents).toEqual(['career-warmup']);
    const tx = second.career.applyRaceResult(finished('rival-mara-race', 1, 1, 300, 'sessB'));
    expect(tx.ok && tx.detail?.rivalDefeated).toBe('Mara Quill');
  });

  it('a reloaded profile keeps the career, the reputation, and the rivals defeated', () => {
    const storage = new MemoryStorage();
    const first = setup(storage);
    first.career.start();
    first.career.applyRaceResult(finished('career-warmup-race', 1, 1, 150, 'sessA'));
    first.career.applyRaceResult(finished('rival-mara-race', 2, 1, 300, 'sessA'));
    const second = setup(storage);
    expect(second.career.profile().career.defeatedRivals).toEqual(['mara-quill']);
    // Warm-up 10 + its objective 5 (finished in 120 s), then Mara 40.
    expect(second.career.profile().career.reputation).toBe(55);
  });

  it('a free-roam race id is not a career race', () => {
    expect(CAREER_RACE_IDS.has('sprint-eastside')).toBe(false);
    const { career, garage } = setup();
    career.start();
    const credits = garage.getState().credits;
    // A free-roam id is known to the game, but the career has no progress for it. It pays its race credits only.
    const tx = career.applyRaceResult(finished('sprint-eastside', 1, 1, 300));
    expect(tx.ok).toBe(true);
    expect(career.profile().career.reputation).toBe(0);
    expect(garage.getState().credits - credits).toBe(300);
  });

  it('dismissing the notice clears it without changing progress', () => {
    const { career } = setup();
    career.start();
    career.applyRaceResult(finished('career-warmup-race', 1, 1, 0));
    const reputation = career.profile().career.reputation;
    career.dismissOutcome();
    expect(career.noticeStore.getState().lastOutcome).toBeNull();
    expect(career.profile().career.reputation).toBe(reputation);
  });
});

describe('career service: no reset and no second profile', () => {
  it('a garage purchase keeps the career', () => {
    const { career, garage } = setup();
    career.start();
    career.applyRaceResult(finished('career-warmup-race', 1, 1, 150));
    garage.earnCredits(10, 'test');
    expect(career.profile().career.reputation).toBe(15);
    expect(career.profile().career.started).toBe(true);
  });
});
