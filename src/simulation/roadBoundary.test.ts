import { describe, expect, it } from 'vitest';
import { buildCircuitNetwork } from '../world/circuitNetwork';
import { NETWORK_BOUNDARY_HALF_WIDTH_METERS } from '../config/roadConfig';
import { arcCenterline, offsetPoint, straightCenterline } from '../world/roadGeometry';
import type { RoadSegment } from '../world/roadTypes';
import type { VehicleState } from '../core/types';
import { buildRoadBoundary, constrainVehicleToRoad, footprintFromConfig, normalAt, signedDistance } from './roadBoundary';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { createVehicleState } from './vehicle';

const network = buildCircuitNetwork();
const boundary = buildRoadBoundary(network);
const H = NETWORK_BOUNDARY_HALF_WIDTH_METERS;
const fp = footprintFromConfig(VEHICLE_CONFIG);

function sd(x: number, z: number): number {
  return signedDistance(boundary, x, z).distance;
}

/** Centreline samples of a segment, with headings, for straights and arcs. */
function centrelineOf(segment: RoadSegment) {
  if (!segment.centerline) throw new Error('no centerline');
  return segment.centerline;
}

describe('straight shape', () => {
  it('is inside at the centreline, on the edge at the boundary half width, and outside beyond it', () => {
    expect(sd(-100 + 0, 260)).toBeLessThan(0);
    expect(sd(0 + H, 100)).toBeCloseTo(0, 6);
    expect(sd(0 + H + 1, 100)).toBeCloseTo(1, 6);
    expect(sd(0 + H - 1, 100)).toBeCloseTo(-1, 6);
  });

  it('is exact past the far end of S1 (ends at z=200, with the T1 arc covering the corner)', () => {
    expect(sd(0, 150)).toBeLessThan(0);
    expect(sd(0, 300)).toBeGreaterThan(0);
  });
});

describe('arc shape', () => {
  it('keeps every interior centreline sample clearly inside (sign is exact, depth may be underestimated at joints)', () => {
    const t1 = network.segments.find((s) => s.id === 'T1');
    if (!t1) throw new Error('T1 missing');
    const line = centrelineOf(t1);
    const n = line.points.length;
    for (let i = 0; i < n; i += 1) {
      const p = line.points[i];
      if (!p) continue;
      const d = sd(p.x, p.z);
      expect(d).toBeLessThanOrEqual(1e-6);
      if (i > 0 && i < n - 1) expect(d).toBeLessThan(-0.5);
    }
  });

  it('places outer and inner edge points on the boundary (|sd| < 0.01)', () => {
    const { centerline, centre } = arcCenterline({ position: { x: 0, y: 0, z: 200 }, heading: 0 }, 60, -Math.PI / 2, 2);
    for (const p of centerline.points) {
      const dx = p.x - centre.x;
      const dz = p.z - centre.z;
      const r = Math.hypot(dx, dz);
      const outer = { x: centre.x + (dx / r) * (r + H), z: centre.z + (dz / r) * (r + H) };
      const inner = { x: centre.x + (dx / r) * (r - H), z: centre.z + (dz / r) * (r - H) };
      expect(Math.abs(sd(outer.x, outer.z))).toBeLessThan(0.01);
      expect(Math.abs(sd(inner.x, inner.z))).toBeLessThan(0.01);
    }
  });

  it('is outside the annulus beyond the arc and outside the angular range', () => {
    // Behind the start of T1 (z < 200), on the corner's far side, is outside the sector.
    expect(sd(-60 + 30, 200 + 80)).toBeGreaterThan(0);
  });
});

describe('circuit union', () => {
  it('contains every centreline sample of every segment', () => {
    for (const segment of network.segments) {
      if (!segment.centerline) continue;
      for (const p of segment.centerline.points) {
        expect(sd(p.x, p.z)).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('has its edge points on the boundary for every straight and arc', () => {
    for (const segment of network.segments) {
      if (!segment.centerline) continue;
      const line = segment.centerline;
      for (let i = 0; i < line.points.length; i += 1) {
        const p = line.points[i];
        const h = line.headings[i] ?? 0;
        if (!p) continue;
        const left = offsetPoint(p, h, -H);
        const right = offsetPoint(p, h, H);
        expect(Math.abs(sd(left.x, left.z))).toBeLessThan(0.01);
        expect(Math.abs(sd(right.x, right.z))).toBeLessThan(0.01);
      }
    }
  });

  it('leaves the junction mouths open: the pad is drivable into every arm', () => {
    expect(sd(-180, 262)).toBeLessThan(0);
    expect(sd(-180, 280)).toBeLessThan(0); // north spur mouth
    expect(sd(-180, 240)).toBeLessThan(0); // south spur mouth
    expect(sd(-175, 260)).toBeLessThan(0); // east arm mouth
    expect(sd(-185, 260)).toBeLessThan(0); // west arm mouth
  });

  it('walls off the dead ends of both spurs', () => {
    expect(sd(-180, 420.2 + 1)).toBeGreaterThan(0);
    expect(sd(-180, 99.8 - 1)).toBeGreaterThan(0);
  });

  it('is outside the grass beside the road', () => {
    expect(sd(H + 2, 100)).toBeGreaterThan(0);
    expect(sd(-200, 100)).toBeGreaterThan(0);
  });

  it('gives an outward normal that points away from the road at a straight edge', () => {
    const n = normalAt(boundary, H, 100);
    expect(n.x).toBeCloseTo(1, 2);
    expect(Math.abs(n.z)).toBeLessThan(0.01);
  });

  it('has segment ids for nearest-segment reporting', () => {
    expect(signedDistance(boundary, 0, 100).segmentId).toBe('S1');
    expect(signedDistance(boundary, -180, 260).segmentId).toBe('J1');
  });
});

function stateAt(x: number, z: number, yaw: number, speed: number, lateral: number): VehicleState {
  const base = createVehicleState({ x, y: 0, z }, yaw);
  return { ...base, speed, lateralSpeed: lateral };
}

describe('constrainVehicleToRoad', () => {
  it('returns the same state object when the car is inside the road (no contact)', () => {
    const state = stateAt(1.8, 50, 0, 20, 0);
    const result = constrainVehicleToRoad(state, boundary, fp);
    expect(result.contact).toBe(false);
    expect(result.state).toBe(state);
  });

  it('pushes a car that is outside back inside, along the normal, and keeps all corners in the region', () => {
    const state = stateAt(10.6, 100, 0, 10, 0);
    const result = constrainVehicleToRoad(state, boundary, fp);
    expect(result.contact).toBe(true);
    expect(result.state.position.x).toBeLessThan(10.6);
    for (const along of [fp.frontMeters, -fp.rearMeters]) {
      for (const side of [fp.halfWidthMeters, -fp.halfWidthMeters]) {
        const cx = result.state.position.x + side;
        const cz = result.state.position.z + along;
        expect(sd(cx, cz)).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('removes the outward velocity component and keeps the tangential one (scrubbed by retention)', () => {
    // Moving right (+X) into the right guardrail at 3 m/s lateral, 10 m/s forward.
    const state = stateAt(9.0, 100, 0, 10, 3);
    const result = constrainVehicleToRoad(state, boundary, fp);
    expect(result.contact).toBe(false); // corner x = 9.0 + 0.925 < 10.2, so not yet in contact
    const pressed = stateAt(9.5, 100, 0, 10, 3);
    const hit = constrainVehicleToRoad(pressed, boundary, fp);
    expect(hit.contact).toBe(true);
    expect(hit.state.lateralSpeed).toBeCloseTo(0, 6);
    expect(hit.state.speed).toBeCloseTo(10 * fp.tangentialRetentionPerStep, 6);
  });

  it('never changes heading, steer angle, or pedal state', () => {
    const base = stateAt(10.6, 100, 0.1, 10, 1);
    const withSteer = { ...base, steerAngle: 0.3, throttlePedal: 0.5, yawRate: 0.2 };
    const result = constrainVehicleToRoad(withSteer, boundary, fp);
    expect(result.state.yaw).toBe(withSteer.yaw);
    expect(result.state.steerAngle).toBe(0.3);
    expect(result.state.throttlePedal).toBe(0.5);
    expect(result.state.yawRate).toBe(0.2);
  });

  it('does not add speed: the speed magnitude never grows through contact', () => {
    const state = stateAt(10.5, 100, 0, 15, 2);
    const result = constrainVehicleToRoad(state, boundary, fp);
    expect(Math.abs(result.state.speed)).toBeLessThanOrEqual(Math.abs(state.speed) + 1e-9);
  });

  it('passes a car straight through the open junction without contact', () => {
    // Drives north from the junction centre (-180, 260) toward the north spur. The pad and the spur share walls.
    for (let z = 255; z <= 290; z += 5) {
      const result = constrainVehicleToRoad(stateAt(-180 + 1.8, z, 0, 10, 0), boundary, fp);
      expect(result.contact).toBe(false);
    }
  });

  it('keeps the car on the straight segment S1 for the whole length', () => {
    const s1 = network.segments.find((s) => s.id === 'S1');
    if (!s1) throw new Error('S1 missing');
    const line = straightCenterline({ position: { x: 1.8, y: 0, z: 0 }, heading: 0 }, 200, 2);
    for (const p of line.points) {
      expect(constrainVehicleToRoad(stateAt(p.x, p.z, 0, 10, 0), boundary, fp).contact).toBe(false);
    }
  });
});
