import { describe, expect, it } from 'vitest';
import { VEHICLE_CATALOGUE } from '../config/vehicleCatalogue';
import { VEHICLE_DESIGNS } from '../config/vehicleDesigns';
import { designHull } from './catalogue';
import { validateDesign, bodyTopAt, type VehicleDesignProfile } from './designProfile';

const hull = designHull();
const base = VEHICLE_DESIGNS['kestrel-hatch'];

function withChange(change: Partial<VehicleDesignProfile>): VehicleDesignProfile {
  return { ...base, ...change };
}

/** Linear sample of a station column, clamped to its ends. Used for silhouette comparisons. */
function sample(stations: ReadonlyArray<readonly number[]>, t: number, column: number): number {
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (!first || !last) return 0;
  if (t <= (first[0] ?? 0)) return first[column] ?? 0;
  if (t >= (last[0] ?? 1)) return last[column] ?? 0;
  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1];
    const b = stations[i];
    if (!a || !b) continue;
    if (t <= (b[0] ?? 0)) {
      const f = (t - (a[0] ?? 0)) / ((b[0] ?? 1) - (a[0] ?? 0));
      return (a[column] ?? 0) + ((b[column] ?? 0) - (a[column] ?? 0)) * f;
    }
  }
  return last[column] ?? 0;
}

/** Side silhouette: body top and roof, sampled along the length. Zero where there is no cabin. */
function silhouette(id: keyof typeof VEHICLE_DESIGNS): number[] {
  const design = VEHICLE_DESIGNS[id];
  const samples: number[] = [];
  for (let k = 0; k <= 20; k += 1) {
    const t = k / 20;
    samples.push(bodyTopAt(design.body, t));
    const inCabin = t >= (design.cabin[0]?.[0] ?? 1) && t <= (design.cabin[design.cabin.length - 1]?.[0] ?? 0);
    samples.push(inCabin ? sample(design.cabin, t, 1) : 0);
  }
  return samples;
}

/** Discrete design choices that show in the silhouette or on the body. */
function features(id: keyof typeof VEHICLE_DESIGNS): string[] {
  const d = VEHICLE_DESIGNS[id];
  return [d.roof, d.headlights, d.taillights, d.grille, d.intakes, String(d.splitter), String(d.skirts), String(d.cladding),
    String(d.flares), d.spoiler, String(d.diffuser), d.exhaust, String(d.roofScoop), String(d.hoodVents), String(d.stripes),
    d.mirrors, d.rim];
}

describe('design validation', () => {
  it('accepts all 20 real profiles against the shared hull', () => {
    for (const vehicle of VEHICLE_CATALOGUE) {
      expect(validateDesign(VEHICLE_DESIGNS[vehicle.id], hull, vehicle.id)).toEqual([]);
    }
  });

  it('rejects a body with too few stations', () => {
    const issues = validateDesign(withChange({ body: base.body.slice(0, 3) }), hull, 'short');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('rejects stations that are not strictly increasing in t', () => {
    const body = [...base.body];
    body[2] = [0.05, 0.22, 0.7, 0.88];
    expect(validateDesign(withChange({ body }), hull, 'unsorted').length).toBeGreaterThan(0);
  });

  it('rejects a spoiler on a car whose cabin reaches too far back (clearance rule, t >= 0.2)', () => {
    const cabin = base.cabin.map(([t, top, hw]) => [t, top, hw] as const);
    // Move only the rear station to t = 0.1, so the cabin starts behind the 0.2 clearance line whatever the base car is.
    const shifted = cabin.map(([t, top, hw], i) => [i === 0 ? 0.1 : t, top, hw] as const);
    const issues = validateDesign(withChange({ cabin: shifted, spoiler: 'wing' }), hull, 'spoiler');
    expect(issues.join(' ')).toMatch(/spoiler/i);
  });

  it('rejects a non-hex colour', () => {
    expect(validateDesign(withChange({ accent: 'red' }), hull, 'colour').length).toBeGreaterThan(0);
  });

  it('rejects a tyre width outside the hull allowance', () => {
    expect(validateDesign(withChange({ tireWidth: 0.4 }), hull, 'tyre').length).toBeGreaterThan(0);
  });

  it('rejects a roof above the vertical limit', () => {
    const cabin = base.cabin.map(([t, , hw]) => [t, 1.6, hw] as const);
    expect(validateDesign(withChange({ cabin }), hull, 'roof').length).toBeGreaterThan(0);
  });

  it('computes the body top between stations (used for silhouettes)', () => {
    expect(bodyTopAt(base.body, 0)).toBeCloseTo(base.body[0]![2], 6);
    expect(bodyTopAt(base.body, 1)).toBeCloseTo(base.body[base.body.length - 1]![2], 6);
  });
});

describe('design distinctness (silhouette, not colour)', () => {
  const ids = VEHICLE_CATALOGUE.map((vehicle) => vehicle.id);

  it('no two cars share the same side silhouette and feature set', () => {
    const keys = ids.map((id) => JSON.stringify([silhouette(id), features(id)]));
    expect(new Set(keys).size).toBe(ids.length);
  });

  it('every pair of cars differs by at least 2 discrete features or 0.03 m of silhouette', () => {
    const problems: string[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i]!;
        const b = ids[j]!;
        const fa = features(a);
        const fb = features(b);
        const discrete = fa.filter((value, index) => value !== fb[index]).length;
        const sa = silhouette(a);
        const sb = silhouette(b);
        const maxDiff = Math.max(...sa.map((value, index) => Math.abs(value - (sb[index] ?? 0))));
        if (discrete < 2 && maxDiff < 0.03) problems.push(`${a} vs ${b}: ${discrete} features, ${maxDiff.toFixed(3)} m`);
      }
    }
    expect(problems).toEqual([]);
  });
});
