import { describe, expect, it } from 'vitest';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { circuitBoundary, driveLap } from '../world/circuitDriver';
import type { InputState } from '../core/types';
import { GameSimulation } from './gameSimulation';

/*
 * Lap driven by a pure-pursuit controller through the real GameSimulation (movement + road boundary), with no
 * physics engine. The driver lives in world/circuitDriver.ts (test support). It never reads the boundary.
 */

const lap = driveLap();

describe('circuit lap with the road boundary (pure-pursuit driver)', () => {
  it('completes one lap without NaN or teleporting', () => {
    expect(lap.nanSeen).toBe(false);
    expect(lap.finished).toBe(true);
    // Per-step displacement must stay near speed × dt, never a jump. Max speed 22 m/s → 0.37 m per step.
    expect(lap.maxStepDisplacement).toBeLessThan(0.5);
  });

  it('visits every segment of the loop, including the junction', () => {
    for (const id of ['S1', 'T1', 'S2a', 'J1', 'S2b', 'T2', 'S3', 'T3', 'S4', 'T4']) {
      expect(lap.segmentsVisited.has(id), `visited ${id}`).toBe(true);
    }
  });

  it('never gets stuck: speed stays above 5 m/s after the start', () => {
    expect(lap.minSpeedAfterStart).toBeGreaterThan(5);
  });

  it('keeps control through the junction (speed stays above 5 m/s)', () => {
    expect(lap.junctionMinSpeed).toBeGreaterThan(5);
  });

  it('never contacts the boundary on the reference line: no wall or invisible-wall corrections', () => {
    expect(lap.contactSteps).toBe(0);
  });

  it('also completes the lap with keyboard-style binary steering, without boundary contact', () => {
    // The browser test uses A/D keys, which are binary. The controller must work with that input too.
    const binary = driveLap({ steerMode: 'binary' });
    expect(binary.finished).toBe(true);
    expect(binary.contactSteps).toBe(0);
    expect(binary.minSpeedAfterStart).toBeGreaterThan(5);
  });

  it('stays within 1.5 m of the driving lane (cross-track error to the nearest lane point)', () => {
    // The 3.6 m lane is wide enough for this. Measured peak on the reference controller: about 1.1 m (analog) and
    // 1.44 m (binary). The peak is controller lag at speed, not the road. The car stays on the road (contactSteps = 0).
    expect(lap.maxLateralOffset, lap.worst).toBeLessThan(1.5);
  });
});

describe('boundary behaviour under the real vehicle', () => {
  it('stops a car driven into the dead end of a spur, without passing through the end cap', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG, {
      spawn: { position: { x: -180 + 1.8, y: 0, z: 300 }, yawRadians: 0 },
      boundary: circuitBoundary,
    });
    const throttle: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };
    for (let i = 0; i < 60 * 40; i += 1) sim.update(FIXED_STEP_SECONDS, throttle);
    expect(sim.state.position.z).toBeLessThanOrEqual(420.2 + 0.01);
    expect(sim.state.position.z).toBeGreaterThan(400);
    expect(Math.abs(sim.state.speed)).toBeLessThan(1);
    expect(sim.roadContact).toBe(true);
  });

  it('drives off the right shoulder into grass only by the boundary, which stops the car at the rail', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG, {
      spawn: { position: { x: 1.8, y: 0, z: 20 }, yawRadians: 0 },
      boundary: circuitBoundary,
    });
    // Steer hard right, at moderate throttle, for 4 s.
    for (let i = 0; i < 60 * 4; i += 1) sim.update(FIXED_STEP_SECONDS, { steer: 1, throttle: 0.4, brake: 0, handbrake: 0 });
    // The car footprint's right corner stays inside the boundary at x <= 10.2 + tiny tolerance.
    expect(sim.state.position.x + VEHICLE_CONFIG.footprintHalfWidthMeters).toBeLessThanOrEqual(10.2 + 0.01);
    expect(Number.isFinite(sim.state.yaw)).toBe(true);
  });

  it('is unaffected by the boundary when there is none (legacy behaviour)', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG);
    expect(sim.hasRoadBoundary).toBe(false);
    for (let i = 0; i < 60 * 4; i += 1) sim.update(FIXED_STEP_SECONDS, { steer: 1, throttle: 1, brake: 0, handbrake: 0 });
    expect(sim.roadContact).toBe(false);
  });
});
