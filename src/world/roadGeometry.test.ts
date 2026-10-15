import { describe, expect, it } from 'vitest';
import { arcCenterline, offsetPoint, sampleAtDistance, straightCenterline } from './roadGeometry';
import { buildArc, buildStraight } from './roadBuilders';

describe('straightCenterline', () => {
  it('runs along the heading with even spacing and no more than the maximum sample spacing', () => {
    const line = straightCenterline({ position: { x: 0, y: 0, z: 0 }, heading: 0 }, 200, 2);
    const last = line.points[line.points.length - 1];
    expect(last?.z).toBeCloseTo(200, 9);
    expect(last?.x).toBeCloseTo(0, 9);
    for (let i = 1; i < line.s.length; i += 1) {
      expect((line.s[i] ?? 0) - (line.s[i - 1] ?? 0)).toBeLessThanOrEqual(2 + 1e-9);
    }
  });
});

describe('arcCenterline', () => {
  it('keeps every sample at the arc radius from the centre, with the heading matching the tangent', () => {
    const { centerline, centre } = arcCenterline({ position: { x: 0, y: 0, z: 200 }, heading: 0 }, 60, -Math.PI / 2, 2);
    for (const p of centerline.points) {
      expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeCloseTo(60, 6);
    }
    expect(centre.x).toBeCloseTo(-60, 9);
    expect(centre.z).toBeCloseTo(200, 9);
    const end = centerline.points[centerline.points.length - 1];
    expect(end?.x).toBeCloseTo(-60, 6);
    expect(end?.z).toBeCloseTo(260, 6);
    const heading = centerline.headings[centerline.headings.length - 1] ?? 0;
    expect(heading).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('turns right for a positive sweep', () => {
    const { centerline } = arcCenterline({ position: { x: 0, y: 0, z: 0 }, heading: 0 }, 60, Math.PI / 2, 2);
    const end = centerline.points[centerline.points.length - 1];
    expect(end?.x).toBeCloseTo(60, 6);
    expect(end?.z).toBeCloseTo(60, 6);
  });
});

describe('sampleAtDistance', () => {
  it('interpolates between samples and clamps outside the range', () => {
    const line = straightCenterline({ position: { x: 0, y: 0, z: 0 }, heading: 0 }, 10, 2);
    expect(sampleAtDistance(line, 3.3).point.z).toBeCloseTo(3.3, 9);
    expect(sampleAtDistance(line, -4).point.z).toBeCloseTo(0, 9);
    expect(sampleAtDistance(line, 99).point.z).toBeCloseTo(10, 9);
  });
});

describe('offsetPoint', () => {
  it('offsets to the right of the heading, so yaw 0 offsets along +X', () => {
    const p = offsetPoint({ x: 0, y: 0, z: 0 }, 0, 1.8);
    expect(p.x).toBeCloseTo(1.8, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });
});

describe('builders', () => {
  it('refuses an arc whose radius would fold the boundary over itself', () => {
    expect(() =>
      buildArc({ id: 'bad', roadType: 'circuit', start: { position: { x: 0, y: 0, z: 0 }, heading: 0 }, radiusMeters: 5, turnRadians: -Math.PI / 2, speedLimitMps: 10 }),
    ).toThrow(/radius/);
  });

  it('builds straight ports at the centreline ends with opposite outward directions', () => {
    const segment = buildStraight({ id: 's', roadType: 'circuit', start: { position: { x: 0, y: 0, z: 0 }, heading: 0 }, lengthMeters: 50, speedLimitMps: 20 });
    const start = segment.ports.find((port) => port.id === 'start');
    const end = segment.ports.find((port) => port.id === 'end');
    expect(start?.outward.z).toBeCloseTo(-1, 9);
    expect(end?.outward.z).toBeCloseTo(1, 9);
    expect(end?.position.z).toBeCloseTo(50, 9);
    expect(segment.lengthMeters).toBe(50);
  });
});
