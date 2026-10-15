import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { GameSimulation } from '../engine/gameSimulation';
import type { InputState, VehicleState } from '../core/types';
import { computeMaxSteerAngle } from '../simulation/vehicle';
import { buildRoadBoundary } from '../simulation/roadBoundary';
import { buildCircuitNetwork, buildCircuitReferencePath, CIRCUIT_SPAWN, type ReferencePath } from './circuitNetwork';

/*
 * Pure-pursuit lap driver for the test circuit. Test support only: never imported by the app.
 * It drives through the real GameSimulation (movement plus road boundary), with no physics engine. The controller
 * reads only the car and a reference line that runs down the car's lane. It never reads the boundary, so a lap
 * shows the road itself can be driven.
 */

export const circuitNetwork = buildCircuitNetwork();
export const circuitBoundary = buildRoadBoundary(circuitNetwork);
const centrePath: ReferencePath = buildCircuitReferencePath(circuitNetwork);
const WHEELBASE = VEHICLE_CONFIG.wheelbaseMeters;

/** Shifts the reference path to the right of its tangent, so it runs down the car's lane (the inner right lane). */
export function offsetPathRight(source: ReferencePath, offset: number): ReferencePath {
  const n = source.points.length;
  const points = source.points.map((p, i) => {
    const a = source.points[(i - 1 + n) % n];
    const b = source.points[(i + 1) % n];
    const tx = (b?.x ?? p.x) - (a?.x ?? p.x);
    const tz = (b?.z ?? p.z) - (a?.z ?? p.z);
    const length = Math.hypot(tx, tz) || 1;
    // Right of heading: forward (sin h, cos h) gives right (cos h, -sin h) = (fz, -fx).
    return { x: p.x + (tz / length) * offset, y: 0, z: p.z - (tx / length) * offset };
  });
  return { ...source, points };
}

export const LANE_OFFSET_METERS = CIRCUIT_SPAWN.position.x;
export const lanePath: ReferencePath = offsetPathRight(centrePath, LANE_OFFSET_METERS);

export function speedTargetFor(segmentId: string): number {
  if (segmentId.startsWith('T')) return 14;
  if (segmentId === 'J1') return 10;
  return 22;
}

export interface LapStepInfo {
  step: number;
  sim: GameSimulation;
  state: VehicleState;
}

export interface LapResult {
  travelled: number;
  maxStepDisplacement: number;
  maxSpeedRatio: number;
  minSpeedAfterStart: number;
  contactSteps: number;
  segmentsVisited: Set<string>;
  maxLateralOffset: number;
  worst: string;
  finished: boolean;
  steps: number;
  junctionMinSpeed: number;
  lastSegment: string | null;
  nanSeen: boolean;
}

export interface LapOptions {
  maxSteps?: number;
  /** 'analog' sets any steer value; 'binary' quantises to -1, 0, +1 like the keyboard. */
  steerMode?: 'analog' | 'binary';
  /** Called after every fixed step. Used by the camera test. */
  onStep?: (info: LapStepInfo) => void;
}

export function driveLap(options: LapOptions = {}): LapResult {
  const maxSteps = options.maxSteps ?? 20000;
  const path = lanePath;
  const sim = new GameSimulation(VEHICLE_CONFIG, {
    spawn: { position: CIRCUIT_SPAWN.position, yawRadians: CIRCUIT_SPAWN.yawRadians },
    boundary: circuitBoundary,
  });
  const n = path.points.length;
  const L = path.lengthMeters;
  /** Unwrapped arc length of path index k (k may exceed n, to continue around the loop). */
  const sAt = (k: number): number => (path.s[k % n] ?? 0) + Math.floor(k / n) * L;
  const pointAt = (k: number) => path.points[k % n];

  let progress = 0;
  let previousPosition = { ...sim.state.position };
  const result: LapResult = {
    travelled: 0,
    maxStepDisplacement: 0,
    maxSpeedRatio: 0,
    minSpeedAfterStart: Infinity,
    contactSteps: 0,
    segmentsVisited: new Set<string>(),
    maxLateralOffset: 0,
    worst: '',
    finished: false,
    steps: 0,
    junctionMinSpeed: Infinity,
    lastSegment: null,
    nanSeen: false,
  };

  for (let step = 0; step < maxSteps; step += 1) {
    const state = sim.state;
    const { x, z } = state.position;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(state.yaw) || !Number.isFinite(state.speed)) {
      result.nanSeen = true;
      break;
    }

    // Nearest path point in a window around the progress index, so the search cannot jump to another pass of the loop.
    let bestK = progress;
    let bestDistance = Infinity;
    for (let k = progress - 20; k <= progress + 200; k += 1) {
      const p = pointAt(k);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestDistance) {
        bestDistance = d;
        bestK = k;
      }
    }
    progress = Math.max(progress, bestK);
    if (bestDistance > result.maxLateralOffset) {
      result.maxLateralOffset = bestDistance;
      result.worst = `step=${step} seg=${path.segmentIds[bestK % n]} v=${state.speed.toFixed(2)} pos=(${x.toFixed(2)},${z.toFixed(2)}) yaw=${state.yaw.toFixed(3)} steer=${state.steerAngle.toFixed(3)}`;
    }
    result.travelled = sAt(progress);

    // Lookahead target: walk forward along the path until the lookahead arc length is covered.
    const speed = state.speed;
    const lookahead = 6 + 0.35 * Math.max(speed, 0);
    let targetK = progress;
    while (sAt(targetK) - sAt(progress) < lookahead && targetK - progress < 600) targetK += 1;
    const target = pointAt(targetK) ?? { x, y: 0, z };

    const rightX = Math.cos(state.yaw);
    const rightZ = -Math.sin(state.yaw);
    const dx = target.x - x;
    const dz = target.z - z;
    const lateral = dx * rightX + dz * rightZ;
    const distance = Math.hypot(dx, dz);
    const curvature = distance > 0.01 ? (2 * lateral) / (distance * distance) : 0;
    const desiredSteer = Math.atan(WHEELBASE * curvature);
    const maxSteer = computeMaxSteerAngle(speed, VEHICLE_CONFIG);
    const analogSteer = Math.max(-1, Math.min(1, desiredSteer / maxSteer));
    const steer = options.steerMode === 'binary' ? (Math.abs(analogSteer) < 0.08 ? 0 : Math.sign(analogSteer)) : analogSteer;

    const segmentId = path.segmentIds[progress % n] ?? '';
    const targetSpeed = speedTargetFor(segmentId);
    const throttle = Math.max(0, Math.min(1, (targetSpeed - speed) * 0.5));
    const brake = Math.max(0, Math.min(1, (speed - targetSpeed - 2) * 0.5));
    const input: InputState = { steer, throttle, brake, handbrake: 0 };

    const stepsBefore = sim.stepCount;
    sim.update(FIXED_STEP_SECONDS, input);
    if (sim.stepCount === stepsBefore) continue;

    const after = sim.state;
    const displacement = Math.hypot(after.position.x - previousPosition.x, after.position.z - previousPosition.z);
    previousPosition = { ...after.position };
    result.maxStepDisplacement = Math.max(result.maxStepDisplacement, displacement);
    result.maxSpeedRatio = Math.max(result.maxSpeedRatio, Math.abs(after.speed) / 62);
    if (step * FIXED_STEP_SECONDS > 5) result.minSpeedAfterStart = Math.min(result.minSpeedAfterStart, after.speed);
    if (sim.roadContact) result.contactSteps += 1;
    result.lastSegment = sim.currentRoadSegmentId;
    if (sim.currentRoadSegmentId) result.segmentsVisited.add(sim.currentRoadSegmentId);
    if (segmentId === 'J1') result.junctionMinSpeed = Math.min(result.junctionMinSpeed, after.speed);
    result.steps = step + 1;

    options.onStep?.({ step, sim, state: after });

    if (result.travelled >= L - 2) {
      result.finished = true;
      break;
    }
  }
  return result;
}
