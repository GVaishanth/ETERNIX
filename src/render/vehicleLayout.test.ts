import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { VEHICLE_DESIGNS } from '../config/vehicleDesigns';
import { bodyPivotPosition, buildVehicleLayout, sideLabel, type WheelPart } from './vehicleLayout';

const design = VEHICLE_DESIGNS['kestrel-hatch'];
const layout = buildVehicleLayout(VEHICLE_CONFIG, design);
const wheels = layout.parts.filter((part): part is WheelPart => part.kind === 'wheel');

describe('vehicle layout: wheels', () => {
  it('builds exactly four wheels, named by axle and side', () => {
    expect(wheels.map((wheel) => wheel.name).sort()).toEqual(
      ['WheelFrontLeft', 'WheelFrontRight', 'WheelRearLeft', 'WheelRearRight'],
    );
  });

  it('puts the front axle at the wheelbase and the rear axle at zero, on the track', () => {
    const front = wheels.filter((wheel) => wheel.axle === 'front');
    const rear = wheels.filter((wheel) => wheel.axle === 'rear');
    for (const wheel of front) expect(wheel.center.z).toBeCloseTo(VEHICLE_CONFIG.wheelbaseMeters, 6);
    for (const wheel of rear) expect(wheel.center.z).toBeCloseTo(0, 6);
    for (const wheel of wheels) {
      expect(Math.abs(wheel.center.x)).toBeCloseTo(VEHICLE_CONFIG.trackWidthMeters / 2, 6);
      expect(Math.sign(wheel.center.x)).toBe(wheel.side === 'left' ? -1 : 1);
    }
  });

  it('sits each wheel on the road at the configured radius, with the design tyre and rim', () => {
    for (const wheel of wheels) {
      expect(wheel.center.y).toBeCloseTo(VEHICLE_CONFIG.wheelRadiusMeters, 6);
      expect(wheel.radius).toBe(VEHICLE_CONFIG.wheelRadiusMeters);
      expect(wheel.width).toBe(design.tireWidth);
      expect(wheel.rim).toBe(design.rim);
      expect(wheel.rimColor).toBe(design.rimColor);
    }
  });
});

describe('vehicle layout: body and pivot', () => {
  it('reports a nose ahead of the front axle and a tail behind the rear axle', () => {
    expect(layout.frontZ).toBeGreaterThan(VEHICLE_CONFIG.wheelbaseMeters);
    expect(layout.rearZ).toBeLessThan(0);
  });

  it('reports the roof as the highest cabin point, under the 1.45 m limit', () => {
    expect(layout.roofY).toBeGreaterThan(1.2);
    expect(layout.roofY).toBeLessThanOrEqual(1.45);
  });

  it('places the body pivot at the wheelbase midpoint, at wheel-centre height', () => {
    expect(bodyPivotPosition(VEHICLE_CONFIG)).toEqual({
      x: 0,
      y: VEHICLE_CONFIG.wheelRadiusMeters,
      z: VEHICLE_CONFIG.wheelbaseMeters / 2,
    });
  });

  it('labels sides for part names', () => {
    expect(sideLabel('left')).toBe('Left');
    expect(sideLabel('right')).toBe('Right');
  });
});
