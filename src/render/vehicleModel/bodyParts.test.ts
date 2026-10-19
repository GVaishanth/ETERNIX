import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../../config/vehicleConfig';
import { VEHICLE_DESIGNS } from '../../config/vehicleDesigns';
import { VEHICLE_CATALOGUE } from '../../config/vehicleCatalogue';
import { buildBodyParts } from './bodyParts';
import type { VehiclePart } from './partTypes';
import type { VehicleDesignProfile } from '../../vehicles/designProfile';

/** Every number inside a part, flattened, so the finite check covers vertices and sizes too. */
function numbersIn(part: VehiclePart): number[] {
  if (part.kind === 'loft') return Array.from(part.mesh.positions);
  if (part.kind === 'box') return [...Object.values(part.center), ...Object.values(part.size), part.rotationY];
  if (part.kind === 'cylinder') return [...Object.values(part.center), part.radius, part.length];
  if (part.kind === 'arch') return [...Object.values(part.center), part.radius, part.tube];
  return [...Object.values(part.center), part.radius, part.width];
}

function partsFor(id: string): { parts: VehiclePart[]; design: VehicleDesignProfile } {
  const design = VEHICLE_DESIGNS[id as keyof typeof VEHICLE_DESIGNS];
  if (!design) throw new Error(`no design for ${id}`);
  return { parts: buildBodyParts(VEHICLE_CONFIG, design), design };
}

describe('body parts for every catalogue car', () => {
  for (const vehicle of VEHICLE_CATALOGUE) {
    it(`${vehicle.name}: has the required body, glass, lights, and wheels-free body set`, () => {
      const { parts } = partsFor(vehicle.id);
      const names = parts.map((part) => part.name);
      expect(names).toContain('VehicleBody');
      expect(names).toContain('Greenhouse');
      const roles = new Set(parts.map((part) => part.role));
      for (const role of ['body', 'glass', 'headlight', 'taillight'] as const) {
        expect(roles.has(role), `${vehicle.id} missing role ${role}`).toBe(true);
      }
      expect(parts.some((part) => part.kind === 'wheel')).toBe(false);
    });

    it(`${vehicle.name}: every number is finite`, () => {
      const { parts } = partsFor(vehicle.id);
      for (const part of parts) {
        for (const value of numbersIn(part)) {
          expect(Number.isFinite(value), `${vehicle.id} ${part.name}`).toBe(true);
        }
      }
    });

    it(`${vehicle.name}: each design feature has its part (no silent drops)`, () => {
      const { parts, design } = partsFor(vehicle.id);
      const has = (prefix: string) => parts.some((part) => part.name.startsWith(prefix));
      if (design.splitter) expect(has('Splitter'), `${vehicle.id} splitter`).toBe(true);
      if (design.skirts) expect(has('Skirt'), `${vehicle.id} skirts`).toBe(true);
      if (design.cladding) expect(has('Cladding'), `${vehicle.id} cladding`).toBe(true);
      if (design.flares) expect(has('Flare'), `${vehicle.id} flares`).toBe(true);
      if (design.diffuser) expect(has('Diffuser'), `${vehicle.id} diffuser`).toBe(true);
      if (design.roofScoop) expect(has('RoofScoop'), `${vehicle.id} roof scoop`).toBe(true);
      if (design.hoodVents) expect(has('HoodVent'), `${vehicle.id} hood vents`).toBe(true);
      if (design.stripes) expect(has('Stripe'), `${vehicle.id} stripes`).toBe(true);
      if (design.exhaust !== 'none') expect(has('Exhaust'), `${vehicle.id} exhaust`).toBe(true);
      if (design.spoiler !== 'none') {
        expect(parts.some((part) => /^(SpoilerLip|Ducktail|Wing|WingPost|WingEndplate)/.test(part.name)), `${vehicle.id} spoiler`).toBe(true);
      }
    });

    it(`${vehicle.name}: stays inside the shared hull (x within 0.95 m, z from -0.85 to 3.75 m)`, () => {
      const { parts } = partsFor(vehicle.id);
      for (const part of parts) {
        if (part.kind !== 'loft') continue;
        const p = part.mesh.positions;
        for (let i = 0; i < p.length; i += 3) {
          expect(Math.abs(p[i] ?? 0), `${vehicle.id} ${part.name} x`).toBeLessThanOrEqual(0.95);
          expect(p[i + 2] ?? 0, `${vehicle.id} ${part.name} z`).toBeGreaterThanOrEqual(-0.85);
          expect(p[i + 2] ?? 0, `${vehicle.id} ${part.name} z`).toBeLessThanOrEqual(3.75);
        }
      }
    });
  }
});
