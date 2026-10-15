import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { bodyPivotPosition, buildVehicleLayout, type VehiclePart } from './vehicleLayout';

const layout = buildVehicleLayout(VEHICLE_CONFIG);
const byName = (name: string): VehiclePart => {
  const part = layout.parts.find((p) => p.name === name);
  if (!part) throw new Error(`missing part ${name}`);
  return part;
};

describe('vehicle layout orientation', () => {
  it('puts the nose (headlights, front indicators) at +Z and the tail lights at -Z', () => {
    const headlight = byName('HeadlightRight');
    const taillight = byName('TaillightRight');
    expect(headlight.center.z).toBeGreaterThan(0);
    expect(taillight.center.z).toBeLessThan(0);
    expect(byName('IndicatorFrontLeft').center.z).toBeGreaterThan(0);
    expect(byName('IndicatorRearLeft').center.z).toBeLessThan(0);
  });

  it('places the windshield toward the nose and the rear window toward the tail', () => {
    expect(byName('Windshield').center.z).toBeGreaterThan(byName('RearWindow').center.z);
  });

  it('puts the right side at +X and the left side at -X', () => {
    expect(byName('HeadlightRight').center.x).toBeGreaterThan(0);
    expect(byName('HeadlightLeft').center.x).toBeLessThan(0);
    expect(byName('WheelFrontRight').center.x).toBeGreaterThan(0);
    expect(byName('WheelRearLeft').center.x).toBeLessThan(0);
  });

  it('spans the body from the tail to the nose with the configured length', () => {
    expect(layout.frontZ - layout.rearZ).toBeCloseTo(VEHICLE_CONFIG.bodyLengthMeters, 9);
    expect(layout.frontZ).toBeGreaterThan(VEHICLE_CONFIG.wheelbaseMeters);
  });
});

describe('vehicle layout ground contact', () => {
  it('places wheel centers at the wheel radius above the ground, on each axle', () => {
    const wheels = layout.parts.filter((p) => p.kind === 'wheel');
    expect(wheels).toHaveLength(4);
    for (const wheel of wheels) {
      expect(wheel.center.y).toBeCloseTo(VEHICLE_CONFIG.wheelRadiusMeters, 9);
      expect([0, VEHICLE_CONFIG.wheelbaseMeters]).toContain(wheel.center.z);
    }
  });

  it('places the rear axle at z = 0 and the front axle at z = wheelbase', () => {
    expect(byName('WheelRearLeft').center.z).toBeCloseTo(0, 9);
    expect(byName('WheelFrontLeft').center.z).toBeCloseTo(VEHICLE_CONFIG.wheelbaseMeters, 9);
  });

  it('keeps the body bottom above the ground and clear of the wheel tops', () => {
    const body = byName('VehicleBody');
    const bottom = body.center.y - body.size.y / 2;
    expect(bottom).toBeGreaterThanOrEqual(VEHICLE_CONFIG.wheelRadiusMeters - 1e-9);
    expect(bottom).toBeLessThan(VEHICLE_CONFIG.wheelRadiusMeters + 0.01);
  });

  it('keeps every non-wheel part above the ground', () => {
    for (const part of layout.parts) {
      if (part.kind === 'wheel') continue;
      expect(part.center.y - part.size.y / 2).toBeGreaterThan(0);
    }
  });
});

describe('vehicle layout symmetry', () => {
  it('mirrors left and right parts across the centerline', () => {
    const pairs: Array<[string, string]> = [
      ['HeadlightLeft', 'HeadlightRight'],
      ['TaillightLeft', 'TaillightRight'],
      ['WheelRearLeft', 'WheelRearRight'],
      ['WheelFrontLeft', 'WheelFrontRight'],
      ['IndicatorRearLeft', 'IndicatorRearRight'],
    ];
    for (const [left, right] of pairs) {
      const a = byName(left);
      const b = byName(right);
      expect(a.center.x).toBeCloseTo(-b.center.x, 9);
      expect(a.center.y).toBeCloseTo(b.center.y, 9);
      expect(a.center.z).toBeCloseTo(b.center.z, 9);
    }
  });
});

describe('vehicle layout axles and pivot', () => {
  it('tags front wheels as steered and rear wheels as fixed', () => {
    expect(byName('WheelFrontLeft').axle).toBe('front');
    expect(byName('WheelFrontRight').axle).toBe('front');
    expect(byName('WheelRearLeft').axle).toBe('rear');
    expect(byName('WheelRearRight').axle).toBe('rear');
  });

  it('places the cosmetic body pivot at the wheelbase midpoint, at wheel-center height', () => {
    const pivot = bodyPivotPosition(VEHICLE_CONFIG);
    expect(pivot.z).toBeCloseTo(VEHICLE_CONFIG.wheelbaseMeters / 2, 9);
    expect(pivot.y).toBeCloseTo(VEHICLE_CONFIG.wheelRadiusMeters, 9);
    expect(pivot.x).toBe(0);
  });
});
