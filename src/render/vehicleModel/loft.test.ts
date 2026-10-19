import { describe, expect, it } from 'vitest';
import { buildLoft, loftSurfaceZ, signedVolume, type LoftStation } from './loft';

/** A straight prism: constant cross-section from z 0 to z 2. Ellipse section, height 1.0 m, half-width 0.9 m. */
const PRISM: LoftStation[] = [
  { z: 0, bottom: 0.2, top: 1.2, halfWidth: 0.9 },
  { z: 2, bottom: 0.2, top: 1.2, halfWidth: 0.9 },
];

describe('loft solids', () => {
  it('builds a closed solid whose faces point outward (positive signed volume)', () => {
    const mesh = buildLoft(PRISM, 2);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
  });

  it('matches the analytic ellipse volume within 3% (20-segment polygon section)', () => {
    const mesh = buildLoft(PRISM, 2);
    // Ellipse area = pi * a * b, with a = 0.9 and b = 0.5. Times length 2.
    const analytic = Math.PI * 0.9 * 0.5 * 2;
    expect(Math.abs(signedVolume(mesh) - analytic) / analytic).toBeLessThan(0.03);
  });

  it('keeps a tapered nose solid and outward, with every coordinate finite', () => {
    const taper: LoftStation[] = [
      { z: 0, bottom: 0.2, top: 0.7, halfWidth: 0.8 },
      { z: 1.5, bottom: 0.2, top: 1.0, halfWidth: 0.9 },
      { z: 3, bottom: 0.25, top: 0.6, halfWidth: 0.4 },
    ];
    const mesh = buildLoft(taper, 3);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
    expect(mesh.positions.every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe('loftSurfaceZ (projecting lights and aero onto the curved body)', () => {
  it('finds the front-most and rear-most surface behind a point inside the section', () => {
    expect(loftSurfaceZ(PRISM, 2, 0, 0.7, 'max')).toBeCloseTo(2, 6);
    expect(loftSurfaceZ(PRISM, 2, 0, 0.7, 'min')).toBeCloseTo(0, 6);
  });

  it('returns null for a point outside the section, so nothing floats in the air', () => {
    expect(loftSurfaceZ(PRISM, 2, 2.0, 0.7, 'max')).toBeNull();
    expect(loftSurfaceZ(PRISM, 2, 0, 3.0, 'max')).toBeNull();
  });
});
