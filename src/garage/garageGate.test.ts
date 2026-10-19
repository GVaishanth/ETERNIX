import { describe, expect, it } from 'vitest';
import { GARAGE_CONFIG } from '../config/garageConfig';
import { distanceOnWorld, evaluateGarageEntry, evaluateGarageEntryAt, type GarageEntryInputs } from './garageGate';

const open: GarageEntryInputs = {
  hasEntrance: true,
  distanceToEntranceMeters: 0,
  speedMps: 0,
  racePhase: 'FREE_ROAM',
  pursuitState: 'INACTIVE',
};

function reasonOf(inputs: Partial<GarageEntryInputs>): string | null {
  const decision = evaluateGarageEntry({ ...open, ...inputs });
  return decision.allowed ? null : decision.reason;
}

describe('garage entry rules', () => {
  it('allows entry when parked inside the entrance in free roam with no pursuit', () => {
    expect(evaluateGarageEntry(open)).toEqual({ allowed: true });
  });

  it('refuses where the city has no garage', () => {
    expect(reasonOf({ hasEntrance: false })).toMatch(/city/);
  });

  it('refuses during any race state except free roam, including the countdown and the race itself', () => {
    for (const phase of ['EVENT_APPROACH', 'COUNTDOWN', 'RACING', 'FINISHED', 'FAILED', 'PAUSED'] as const) {
      expect(reasonOf({ racePhase: phase }), phase).toMatch(/race/);
    }
  });

  it('refuses during a pursuit, so entry never silently clears it', () => {
    for (const state of ['DETECTION', 'INITIATING', 'PURSUING', 'ESCALATING', 'SEARCHING', 'COOLDOWN', 'BUSTED'] as const) {
      expect(reasonOf({ pursuitState: state }), state).toMatch(/police/);
    }
  });

  it('refuses outside the entrance radius', () => {
    expect(reasonOf({ distanceToEntranceMeters: GARAGE_CONFIG.entranceRadiusMeters + 0.5 })).toMatch(/Drive to the garage/);
  });

  it('accepts exactly the radius boundary', () => {
    expect(reasonOf({ distanceToEntranceMeters: GARAGE_CONFIG.entranceRadiusMeters })).toBeNull();
  });

  it('refuses while moving faster than the entrance speed limit', () => {
    expect(reasonOf({ speedMps: GARAGE_CONFIG.entranceMaxSpeedMps + 0.1 })).toMatch(/Stop/);
    expect(reasonOf({ speedMps: GARAGE_CONFIG.entranceMaxSpeedMps })).toBeNull();
  });

  it('reports the first failing rule in order (city, race, pursuit, place, speed)', () => {
    expect(reasonOf({ hasEntrance: false, racePhase: 'RACING', pursuitState: 'PURSUING', speedMps: 50 })).toMatch(/city/);
    expect(reasonOf({ racePhase: 'RACING', pursuitState: 'PURSUING' })).toMatch(/race/);
    expect(reasonOf({ pursuitState: 'PURSUING', speedMps: 50 })).toMatch(/police/);
  });

  it('treats a non-finite distance as outside the zone', () => {
    expect(reasonOf({ distanceToEntranceMeters: Number.NaN })).toMatch(/Drive to the garage/);
  });
});

describe('garage entry at a position (shared by the V key and the button)', () => {
  const entrance = { position: { x: 100, z: 200 } };

  it('uses the distance from the entrance point', () => {
    const near = evaluateGarageEntryAt({ position: { x: 103, z: 204 }, speedMps: 0, entrance, racePhase: 'FREE_ROAM', pursuitState: 'INACTIVE' });
    expect(near.allowed).toBe(true);
    const far = evaluateGarageEntryAt({ position: { x: 150, z: 200 }, speedMps: 0, entrance, racePhase: 'FREE_ROAM', pursuitState: 'INACTIVE' });
    expect(far.allowed).toBe(false);
  });

  it('refuses in a world with no entrance', () => {
    const none = evaluateGarageEntryAt({ position: { x: 0, z: 0 }, speedMps: 0, entrance: null, racePhase: 'FREE_ROAM', pursuitState: 'INACTIVE' });
    expect(none.allowed).toBe(false);
  });
});

describe('garage entry on the looping world', () => {
  const PERIOD = 2400;
  const entrance = { position: { x: 1190, z: -201.8 } };

  it('measures the short way round the period, so a car one period away is at the entrance', () => {
    expect(distanceOnWorld({ x: -1210, z: -201.8 }, entrance.position, PERIOD)).toBeCloseTo(0, 6);
    expect(distanceOnWorld({ x: 1190 + PERIOD, z: -201.8 }, entrance.position, PERIOD)).toBeCloseTo(0, 6);
    expect(distanceOnWorld({ x: 1100, z: -201.8 }, entrance.position, PERIOD)).toBeCloseTo(90, 6);
  });

  it('opens the garage for a stopped car one period away, and refuses it on a finite world at the same place', () => {
    const place = { position: { x: 1190 + PERIOD, z: -201.8 }, speedMps: 0, entrance, racePhase: 'FREE_ROAM' as const, pursuitState: 'INACTIVE' as const };
    expect(evaluateGarageEntryAt({ ...place, periodMeters: PERIOD }).allowed).toBe(true);
    expect(evaluateGarageEntryAt({ ...place, periodMeters: null }).allowed).toBe(false);
  });
});
