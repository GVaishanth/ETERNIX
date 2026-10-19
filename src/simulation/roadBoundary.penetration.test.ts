import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState, VehicleState } from '../core/types';
import { buildCityNetwork, buildLoopCityNetwork } from '../world/city/cityNetwork';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { constrainVehicleToRoad, footprintFromConfig, buildRoadBoundary, signedDistance, type RoadBoundary } from './roadBoundary';
import { createVehicleState, stepVehicle } from './vehicle';

/*
 * A car driven straight into a guardrail must never end a step with a footprint corner outside the drivable region.
 * This is the "drive through the grey blocks" failure: a corner that ends up beyond the rail is a penetration.
 * Every case starts inside the road, drives at 25 m/s into the rail, and checks every step after the constraint.
 */

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
/** The east seam in logical coordinates: the base domain's origin plus one period. */
const SEAM_EAST = WORLD_WRAP_CONFIG.baseOriginMeters + PERIOD;
const DT = 1 / 120;
const STEPS = 240;
const SPEED = 25;
const TOLERANCE_M = 0.02;
const NO_INPUT: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const FP = footprintFromConfig(VEHICLE_CONFIG);

/** Corners of the footprint. Forward is (sin yaw, cos yaw); right is (cos yaw, -sin yaw). Yaw 0 drives along +z. */
function corners(state: VehicleState): Array<{ x: number; z: number }> {
  const s = Math.sin(state.yaw);
  const c = Math.cos(state.yaw);
  const out: Array<{ x: number; z: number }> = [];
  for (const along of [FP.frontMeters, -FP.rearMeters]) {
    for (const side of [FP.halfWidthMeters, -FP.halfWidthMeters]) {
      out.push({
        x: state.position.x + s * along + c * side,
        z: state.position.z + c * along - s * side,
      });
    }
  }
  return out;
}

function worstCornerDistance(boundary: RoadBoundary, state: VehicleState): number {
  let worst = -Infinity;
  for (const p of corners(state)) {
    const d = signedDistance(boundary, p.x, p.z).distance;
    if (d > worst) worst = d;
  }
  return worst;
}

interface DriveResult {
  startedInside: boolean;
  contactSteps: number;
  worstAfterConstraint: number;
}

function driveInto(boundary: RoadBoundary, x: number, z: number, yaw: number): DriveResult {
  const base = createVehicleState({ x, y: 0, z }, yaw);
  let state: VehicleState = { ...base, speed: SPEED };
  const startedInside = worstCornerDistance(boundary, state) <= 0;
  let contactSteps = 0;
  let worst = -Infinity;
  for (let i = 0; i < STEPS; i += 1) {
    state = stepVehicle(state, NO_INPUT, VEHICLE_CONFIG, DT);
    const constrained = constrainVehicleToRoad(state, boundary, FP);
    state = constrained.state;
    if (constrained.contact) contactSteps += 1;
    const d = worstCornerDistance(boundary, state);
    if (d > worst) worst = d;
  }
  return { startedInside, contactSteps, worstAfterConstraint: worst };
}

/** Rows of the lattice (east-west streets) and columns, including the seam rows and columns and mid-block points. */
const ROWS = [-1200, -400, 0, 1000];
const COLUMNS = [-1195, -1150, -1000, -600, -200, 0, 200, 600, 1000, 1150, 1195];

const loopBoundary = buildRoadBoundary(buildLoopCityNetwork());
const finiteBoundary = buildRoadBoundary(buildCityNetwork());

function runSweep(boundary: RoadBoundary, label: string): { cases: number; worst: number; contacts: number; detail: string } {
  let cases = 0;
  let worst = -Infinity;
  let contacts = 0;
  let detail = '';
  for (const row of ROWS) {
    for (const col of COLUMNS) {
      // Drive north and south into the rails of an east-west street, offset from its centreline by 6 m.
      for (const [z0, yaw] of [
        [row + 6, 0],
        [row - 6, Math.PI],
      ] as const) {
        const result = driveInto(boundary, col, z0, yaw);
        if (!result.startedInside) continue;
        cases += 1;
        contacts += result.contactSteps;
        if (result.worstAfterConstraint > worst) {
          worst = result.worstAfterConstraint;
          detail = `${label} start (${col},${z0}) yaw ${yaw}`;
        }
      }
    }
  }
  return { cases, worst, contacts, detail };
}

describe('guardrail penetration', () => {
  it('the finite city: no corner ends a step outside the drivable region', () => {
    const r = runSweep(finiteBoundary, 'finite');
    expect(r.cases).toBeGreaterThan(0);
    expect(r.contacts).toBeGreaterThan(0);
    expect(r.worst, r.detail).toBeLessThanOrEqual(TOLERANCE_M);
  }, 120_000);

  it('the loop: no corner ends a step outside the drivable region, including at the seams', () => {
    const r = runSweep(loopBoundary, 'loop');
    expect(r.cases).toBeGreaterThan(0);
    expect(r.contacts).toBeGreaterThan(0);
    expect(r.worst, r.detail).toBeLessThanOrEqual(TOLERANCE_M);
  }, 120_000);

  it('the loop seam: a car driven straight across the east seam at speed stays inside its drivable region', () => {
    // The street at z = -400 runs east-west; a car drives east from inside the seam, along the road, then turns into a
    // rail at the seam by pointing slightly outward. Every corner is checked after every step.
    const start = createVehicleState({ x: SEAM_EAST - 50, y: 0, z: -394 }, Math.PI / 2 - 0.2);
    let state: VehicleState = { ...start, speed: SPEED };
    let worst = -Infinity;
    let crossed = false;
    for (let i = 0; i < STEPS * 2; i += 1) {
      state = stepVehicle(state, NO_INPUT, VEHICLE_CONFIG, DT);
      state = constrainVehicleToRoad(state, loopBoundary, FP).state;
      if (state.position.x > SEAM_EAST) crossed = true;
      const d = worstCornerDistance(loopBoundary, state);
      if (d > worst) worst = d;
    }
    expect(crossed).toBe(true);
    expect(worst).toBeLessThanOrEqual(TOLERANCE_M);
  });

  it('the boundary and the finite and loop worlds agree on the rail position one period apart', () => {
    for (const z of [-400, 0]) {
      const here = signedDistance(loopBoundary, 1190, z + 10.2).distance;
      const there = signedDistance(loopBoundary, 1190 - PERIOD, z + 10.2).distance;
      expect(here).toBeCloseTo(there, 9);
    }
  });
});
