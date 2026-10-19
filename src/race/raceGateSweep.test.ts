import { describe, expect, it } from 'vitest';
import { RACE_CONFIG } from '../config/raceConfig';
import { NETWORK_BOUNDARY_HALF_WIDTH_METERS } from '../config/roadConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute } from './raceRoute';
import { CIRCUIT_BLOCK } from './raceEvents';
import { createRacerProgress, stepRacerProgress, type RacerProgress } from './raceProgress';
import type { RaceRoute } from './raceRoute';

/*
 * Gate sweep diagnostic (Part 6, J3 investigation). A kinematic car follows the real Circuit route with a fixed lateral
 * bias and speed. Each fixed step goes through the real stepRacerProgress. This isolates gate registration from the
 * vehicle physics and the browser bot: if the car crosses a gate, the gate must register.
 */

const graph = buildLaneGraph(buildCityNetwork());
const built = buildRaceRoute(CIRCUIT_BLOCK, graph);
if (!built.route) throw new Error('circuit route did not build');
const route: RaceRoute = built.route;
/** Lateral offset of the route line from the road centre, metres, positive to the right (the lane's own offset). */
const ROUTE_OFFSET_RIGHT = graph.byId.get(route.laneIds[0] ?? '')?.offsetMeters ?? 0;

const DT = 1 / 60;

interface RunResult {
  gatesPassed: number;
  expectedGates: number;
  relocations: number;
  outOfOrder: number;
  /** Per expected gate in order: the closest lateral offset (metres, from gate centre) seen while the car was in the gate's sweep window. */
  lateralAtGate: number[];
  steps: number;
  finished: boolean;
}

/** Lateral offset (signed, along the gate's right) of a point from the gate centre. */
function lateralOf(gateX: number, gateZ: number, heading: number, x: number, z: number): number {
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);
  return (x - gateX) * rx + (z - gateZ) * rz;
}

/**
 * Drives the car along the route at a lateral position `roadCentreOffset` metres from the road centre (positive to the
 * right). The target is kept inside the drivable road, so the car stays on the route.
 */
function runCar(roadCentreOffset: number, speedMps: number, laps: number): RunResult {
  const { xs, zs } = route.polyline;
  const n = xs.length;
  const L = route.totalMeters;
  // Start on the grid behind the start line: at the first polyline point.
  let x = xs[0] ?? 0;
  let z = zs[0] ?? 0;
  let heading = Math.atan2((xs[1] ?? 0) - x, (zs[1] ?? 0) - z);
  const progress: RacerProgress = createRacerProgress('p', 'player', 'You', x, z, 0);
  const total = L * laps;
  // Run until the race finishes. The step cap only stops a car that never finishes; it is well above a full lap.
  const maxSteps = Math.ceil(((total / speedMps) / DT) * 1.5) + 600;
  let nearestIdx = 0;
  let finishOrder = 1;
  const gates = route.gates;
  const expectedGates = gates.length * laps;
  const lateralAtGate: number[] = new Array(expectedGates).fill(Number.POSITIVE_INFINITY);
  let steps = 0;
  let t = 0;
  while (!progress.finished && steps < maxSteps) {
    // Advance the nearest index forward on the lap polyline (cyclic).
    let best = nearestIdx;
    let bestD = Infinity;
    for (let k = 0; k < 80; k += 1) {
      const i = (nearestIdx + k) % (n - 1);
      const d = Math.hypot((xs[i] ?? 0) - x, (zs[i] ?? 0) - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    nearestIdx = best;
    // Lookahead point along the polyline, moved sideways to the requested road-centre offset.
    const look = 6 + 0.3 * speedMps;
    let acc = 0;
    let k = nearestIdx;
    while (acc < look) {
      const j = (k + 1) % (n - 1);
      acc += Math.hypot((xs[j] ?? 0) - (xs[k % (n - 1)] ?? 0), (zs[j] ?? 0) - (zs[k % (n - 1)] ?? 0));
      k = j;
    }
    const kk = k % (n - 1);
    const kn = (kk + 1) % (n - 1);
    const tx = xs[kk] ?? 0;
    const tz = zs[kk] ?? 0;
    const dirX = (xs[kn] ?? 0) - tx;
    const dirZ = (zs[kn] ?? 0) - tz;
    const dl = Math.hypot(dirX, dirZ) || 1;
    // Right-hand normal of the path direction, with the route line already offset from the road centre by its lane offset.
    const rightX = dirZ / dl;
    const rightZ = -dirX / dl;
    const lateralFromRoute = roadCentreOffset - ROUTE_OFFSET_RIGHT;
    const tgtX = tx + rightX * lateralFromRoute;
    const tgtZ = tz + rightZ * lateralFromRoute;
    // Pure pursuit curvature toward the target, in the car frame.
    const dx = tgtX - x;
    const dz = tgtZ - z;
    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);
    const along = dx * fwdX + dz * fwdZ;
    const side = dx * fwdZ - dz * fwdX;
    const ld2 = along * along + side * side;
    const curvature = (2 * side) / Math.max(ld2, 1e-6);
    heading += speedMps * curvature * DT;
    x += Math.sin(heading) * speedMps * DT;
    z += Math.cos(heading) * speedMps * DT;
    t += DT;
    steps += 1;
    const before = progress.gatesPassed;
    const outcome = stepRacerProgress(progress, route, x, z, t, finishOrder);
    if (outcome.finishedNow) finishOrder += 1;
    // Record the lateral offset of the car at each gate it is close to, for the gate it is due to pass.
    const due = before;
    if (due < expectedGates) {
      const gate = gates[due % gates.length];
      if (gate) {
        const along2 = (x - gate.x) * Math.sin(gate.headingRadians) + (z - gate.z) * Math.cos(gate.headingRadians);
        if (Math.abs(along2) < 2) {
          const lat = Math.abs(lateralOf(gate.x, gate.z, gate.headingRadians, x, z));
          lateralAtGate[due] = Math.min(lateralAtGate[due] ?? Infinity, lat);
        }
      }
    }
  }
  return {
    gatesPassed: progress.gatesPassed,
    expectedGates,
    relocations: progress.relocations,
    outOfOrder: progress.outOfOrderCount,
    lateralAtGate,
    steps,
    finished: progress.finished,
  };
}

describe('circuit gate sweep (J3 investigation)', () => {
  it('registers every gate of a centred lap at several speeds', () => {
    for (const speed of [12, 30, 60]) {
      const r = runCar(0, speed, 2);
      expect(r.gatesPassed, `speed ${speed}`).toBe(r.expectedGates);
      expect(r.finished, `speed ${speed}`).toBe(true);
    }
  });

  it('registers every gate when the car runs at the outer edge of the drivable road, on both sides', () => {
    // The car's centre can reach the boundary less the car's half width (9.275 m). The car runs at that edge on both
    // sides. Before the fix, a gate half width of 8.5 m missed the line silently at these positions.
    const legalEdge = NETWORK_BOUNDARY_HALF_WIDTH_METERS - VEHICLE_CONFIG.footprintHalfWidthMeters;
    for (const offset of [9.2, -9.2]) {
      for (const speed of [12, 30]) {
        const r = runCar(offset, speed, 2);
        const worst = Math.max(...r.lateralAtGate.filter((v) => Number.isFinite(v)));
        expect(worst, `offset ${offset} speed ${speed} closest approach`).toBeLessThanOrEqual(legalEdge);
        expect(r.gatesPassed, `offset ${offset} speed ${speed}`).toBe(r.expectedGates);
        expect(r.outOfOrder, `offset ${offset} speed ${speed}`).toBe(0);
      }
    }
  });

  it('a gate covers every lateral position the drivable road allows', () => {
    expect(RACE_CONFIG.gateHalfWidthMeters).toBeGreaterThanOrEqual(NETWORK_BOUNDARY_HALF_WIDTH_METERS);
  });
});
