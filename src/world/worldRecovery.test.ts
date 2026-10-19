import { describe, expect, it } from 'vitest';
import { WORLD_RECOVERY } from '../config/worldConfig';
import { buildCityNetwork } from './city/cityNetwork';
import { CITY_DEV_RESET } from './city/cityLayout';
import { buildLaneGraph, nearestOnLane } from '../traffic/laneGraph';
import {
  createRecoveryMonitor,
  footprintCornersOf,
  nearestRecoveryPose,
  stepRecoveryMonitor,
  type RecoveryInput,
} from './worldRecovery';

/*
 * Part 5 recovery (world bounds and stuck handling). The monitor is pure, so each rule is checked on its own:
 * outside is immediate, off-road and stuck are timed, and a car stopped on the road never counts as stuck.
 */

const DT = 1 / 120;

function input(overrides: Partial<RecoveryInput> = {}): RecoveryInput {
  return {
    x: 0,
    z: 0,
    speedMps: 0,
    onSurface: true,
    footprintOnSurface: true,
    insideBounds: true,
    dtSeconds: DT,
    ...overrides,
  };
}

function runFor(monitor: ReturnType<typeof createRecoveryMonitor>, seconds: number, make: () => RecoveryInput) {
  let reason: ReturnType<typeof stepRecoveryMonitor> = null;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && reason === null; i += 1) reason = stepRecoveryMonitor(monitor, make(), WORLD_RECOVERY);
  return reason;
}

describe('recovery monitor (test: world bounds)', () => {
  it('recovers at once when the car is outside the world bounds', () => {
    const monitor = createRecoveryMonitor();
    expect(stepRecoveryMonitor(monitor, input({ insideBounds: false }), WORLD_RECOVERY)).toBe('outside-bounds');
  });

  it('never recovers a car that is stopped on the road, however long it waits', () => {
    const monitor = createRecoveryMonitor();
    expect(runFor(monitor, 120, () => input())).toBeNull();
  });

  it('recovers off-road only after the configured time, not before', () => {
    const monitor = createRecoveryMonitor();
    const before = runFor(monitor, WORLD_RECOVERY.offRoadSeconds - 0.2, () => input({ onSurface: false, footprintOnSurface: false, speedMps: 5 }));
    expect(before).toBeNull();
    expect(runFor(monitor, 0.4, () => input({ onSurface: false, footprintOnSurface: false, speedMps: 5 }))).toBe('off-road');
  });

  it('resets the off-road timer as soon as the car is back on the surface', () => {
    const monitor = createRecoveryMonitor();
    runFor(monitor, WORLD_RECOVERY.offRoadSeconds - 0.5, () => input({ onSurface: false, footprintOnSurface: false, speedMps: 5 }));
    expect(stepRecoveryMonitor(monitor, input({ speedMps: 5 }), WORLD_RECOVERY)).toBeNull();
    expect(monitor.offRoadSeconds).toBe(0);
  });
});

describe('recovery monitor, stuck rule (test: irrecoverable stuck state)', () => {
  const wedged = { onSurface: true, footprintOnSurface: false, speedMps: 0 };

  it('recovers a car stopped with part of it wedged off the road, only after the stuck time', () => {
    const monitor = createRecoveryMonitor();
    expect(runFor(monitor, WORLD_RECOVERY.stuckSeconds - 1, () => input(wedged))).toBeNull();
    expect(runFor(monitor, 2, () => input(wedged))).toBe('stuck');
  });

  it('never counts a car pinned on the road as stuck: it can reverse out', () => {
    const monitor = createRecoveryMonitor();
    expect(runFor(monitor, 120, () => input({ footprintOnSurface: true, speedMps: 0 }))).toBeNull();
  });

  it('does not count a wedged car that is still moving', () => {
    const monitor = createRecoveryMonitor();
    expect(runFor(monitor, 120, () => input({ ...wedged, speedMps: WORLD_RECOVERY.stuckSpeedMps * 2 }))).toBeNull();
  });

  it('resets the stuck timer when the car moves again', () => {
    const monitor = createRecoveryMonitor();
    runFor(monitor, WORLD_RECOVERY.stuckSeconds - 1, () => input(wedged));
    stepRecoveryMonitor(monitor, input({ ...wedged, speedMps: 3 }), WORLD_RECOVERY);
    expect(monitor.stuckSeconds).toBe(0);
    expect(runFor(monitor, WORLD_RECOVERY.stuckSeconds - 1, () => input(wedged))).toBeNull();
  });

  it('places the footprint corners correctly for a heading', () => {
    const fp = { rearMeters: 1, frontMeters: 3, halfWidthMeters: 1 };
    // Facing +Z: the front corners sit 3 m ahead (+Z), the rear corners 1 m behind, at x = +/-1.
    const north = footprintCornersOf(0, 0, 0, fp);
    expect(north.map((c) => [Math.round(c.x), Math.round(c.z)])).toEqual([[-1, -1], [1, -1], [-1, 3], [1, 3]]);
    // Facing +X (yaw pi/2): the front corners are 3 m toward +X.
    const east = footprintCornersOf(0, 0, Math.PI / 2, fp);
    expect(Math.max(...east.map((c) => c.x))).toBeCloseTo(3, 6);
  });
});

describe('recovery pose and the DEV reset pose (test: world management)', () => {
  const network = buildCityNetwork();
  const lanes = buildLaneGraph(network).lanes;

  it('returns a pose on a driving lane, with the lane heading as the yaw', () => {
    const pose = nearestRecoveryPose(lanes, -100, -1.8);
    expect(pose).not.toBeNull();
    if (!pose) return;
    // The spawn is on the eastbound inner lane of H-1-2: the recovered yaw is the east heading.
    expect(Math.abs(pose.yawRadians - Math.PI / 2)).toBeLessThan(1e-6);
    expect(Math.abs(pose.position.z - -1.8)).toBeLessThan(0.05);
  });

  it('only returns segment lanes, never connectors', () => {
    const pose = nearestRecoveryPose(lanes, 0, 0);
    expect(pose).not.toBeNull();
    if (!pose) return;
    const segmentLanes = lanes.filter((lane) => lane.kind === 'segment');
    const hit = segmentLanes.some((lane) => (nearestOnLane(lane, pose.position.x, pose.position.z)?.distance ?? 1) < 0.01);
    expect(hit).toBe(true);
  });

  it('returns null with no lanes', () => {
    expect(nearestRecoveryPose([], 0, 0)).toBeNull();
  });

  it('puts the explicit DEV reset pose on a driving lane, facing the lane heading', () => {
    const pose = nearestRecoveryPose(lanes, CITY_DEV_RESET.position.x, CITY_DEV_RESET.position.z);
    expect(pose).not.toBeNull();
    if (!pose) return;
    expect(Math.hypot(pose.position.x - CITY_DEV_RESET.position.x, pose.position.z - CITY_DEV_RESET.position.z)).toBeLessThan(0.05);
    expect(Math.abs(pose.yawRadians - CITY_DEV_RESET.yawRadians)).toBeLessThan(1e-6);
  });
});
