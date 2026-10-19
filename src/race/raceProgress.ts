import { RACE_CONFIG } from '../config/raceConfig';
import { crossesGate } from './gates';
import { wrapDelta, wrapToBase } from '../world/wrap/worldWrap';
import type { RaceRoute } from './raceRoute';
import type { RacerKind, RaceGateDef } from './raceTypes';

/*
 * Per-racer progress (Part 6). Pure. Gate crossings come from the swept centre-point segment every fixed step. Route
 * distance (where on the route the racer is) is found 10 Hz, by a nearest-point search over the route polyline, limited to
 * a window around the last estimate. Nothing here uses straight-line distance to rank racers.
 */

export interface RacerProgress {
  readonly id: string;
  readonly kind: RacerKind;
  readonly name: string;
  /** Centre point at the previous and current fixed step. */
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  /** Last route distance estimate, meters. */
  routeD: number;
  /** False when the racer is further than progressLostMeters from the route. Progress holds its last value. */
  onRoute: boolean;
  /** Gates passed, across all laps. The next expected gate is route.gates[gatesPassed % gates.length]. */
  gatesPassed: number;
  lapsDone: number;
  /** Route distance of the last passed gate, or of the racer's grid slot before the first gate. */
  legRefD: number;
  /** Race time at the last lap completion, or 0 at GO. */
  lapStartTime: number;
  lapTimes: number[];
  finished: boolean;
  finishTime: number | null;
  /** 1-based order in which racers finished. Null until finished. */
  finishOrder: number | null;
  /** Crossings that were not the next gate, each reported once. */
  outOfOrderCount: number;
  /** Distance driven since the racer's first step, meters (straight segments between fixed steps). */
  travelledMeters: number;
  /** Steps where the centre moved more than the relocation limit (recovery or reset). Gates are not tested on them. */
  relocations: number;
  lastRelocationSeconds: number | null;
  /** Relocations that would have moved the progress estimate past the next expected gate. Held at that gate. */
  relocationsHeld: number;
}

export type RaceProgressEvent =
  | { kind: 'gate-passed'; racerId: string; gateId: string; atSeconds: number }
  | { kind: 'out-of-order'; racerId: string; gateId: string; expectedGateId: string }
  | { kind: 'relocation-held'; racerId: string; gateId: string }
  | { kind: 'lap-completed'; racerId: string; lap: number; lapSeconds: number }
  | { kind: 'finished'; racerId: string; finishSeconds: number };

const NO_EVENTS: readonly RaceProgressEvent[] = Object.freeze([]);

/**
 * A racer at the start of an attempt. `gridRouteD` is where the racer stands. `legRefD` is the route distance the leg is
 * measured from: the start line, so a racer on the grid is behind it by its row, and the standings start in grid order.
 */
export function createRacerProgress(
  id: string,
  kind: RacerKind,
  name: string,
  x: number,
  z: number,
  gridRouteD: number,
  legRefD: number = gridRouteD,
): RacerProgress {
  return {
    id,
    kind,
    name,
    prevX: x,
    prevZ: z,
    x,
    z,
    routeD: gridRouteD,
    onRoute: true,
    gatesPassed: 0,
    lapsDone: 0,
    legRefD,
    lapStartTime: 0,
    lapTimes: [],
    finished: false,
    finishTime: null,
    finishOrder: null,
    outOfOrderCount: 0,
    travelledMeters: 0,
    relocations: 0,
    relocationsHeld: 0,
    lastRelocationSeconds: null,
  };
}

/** Signed distance from `from` to `to` along the route. On a cycle, the shorter way round. */
export function signedRouteDelta(to: number, from: number, route: Pick<RaceRoute, 'cyclic' | 'totalMeters'>): number {
  const delta = to - from;
  if (!route.cyclic) return delta;
  const L = route.totalMeters;
  let wrapped = ((delta % L) + L) % L;
  if (wrapped > L / 2) wrapped -= L;
  return wrapped;
}

export interface NearestRouteSample {
  /** Route distance of the nearest point, meters. */
  d: number;
  /** Distance from the query point to that point, meters. */
  distance: number;
}

/**
 * Nearest point on the route polyline to (x, z), projected onto each polyline segment. When a hint is given, only
 * segments within the progress window of the hint are considered, so a lap that overlaps itself cannot pull the
 * estimate to the wrong pass. If nothing is in the window, the whole polyline is searched.
 */
export function nearestRouteSample(
  route: RaceRoute,
  x: number,
  z: number,
  hint: number | null,
): NearestRouteSample | null {
  const { xs, zs, ds } = route.polyline;
  const n = xs.length;
  if (n < 2) return null;
  const L = route.totalMeters;
  const window = RACE_CONFIG.progressWindowMeters;

  let best: NearestRouteSample | null = null;
  let bestInWindow: NearestRouteSample | null = null;
  for (let i = 0; i < n; i += 1) {
    const last = i === n - 1;
    const j = last ? 0 : i + 1;
    const ax = xs[i] ?? 0;
    const az = zs[i] ?? 0;
    const bx = xs[j] ?? 0;
    const bz = zs[j] ?? 0;
    const startD = ds[i] ?? 0;
    // Segment length in route distance. The last segment of a cycle wraps back to the origin.
    const endD = last && route.cyclic ? L : (ds[j] ?? startD);
    const vx = bx - ax;
    const vz = bz - az;
    // A route that crosses the seam has one segment about a period long, from one side of the seam to the other. That is
    // not road. Left in, it would be the nearest segment for any car on the same row, with a wrong route distance.
    if (route.periodMeters !== undefined && Math.hypot(vx, vz) > route.periodMeters / 2) continue;
    const lenSq = vx * vx + vz * vz;
    const t = lenSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / lenSq)) : 0;
    const px = ax + vx * t;
    const pz = az + vz * t;
    const distance = Math.hypot(x - px, z - pz);
    const d = route.cyclic ? (((startD + (endD - startD) * t) % L) + L) % L : startD + (endD - startD) * t;
    const candidate = { d, distance };
    if (best === null || distance < best.distance) best = candidate;
    if (hint !== null && Math.abs(signedRouteDelta(d, hint, route)) <= window) {
      if (bestInWindow === null || distance < bestInWindow.distance) bestInWindow = candidate;
    }
  }
  // Prefer the windowed candidate only when it is actually near the racer. A stale hint must not hold a racer on a
  // wrong point of the route; then the whole polyline decides.
  if (bestInWindow !== null && bestInWindow.distance <= RACE_CONFIG.progressLostMeters) return bestInWindow;
  return best;
}

/**
 * Updates the route distance estimate for one racer, at standings time (10 Hz). When the racer is too far from the
 * route, the estimate holds and onRoute becomes false.
 */
export function refreshRouteDistance(progress: RacerProgress, route: RaceRoute): void {
  const near = nearestRouteSample(route, progress.x, progress.z, progress.routeD);
  if (!near || near.distance > RACE_CONFIG.progressLostMeters) {
    progress.onRoute = false;
    return;
  }
  progress.onRoute = true;
  progress.routeD = near.d;
}

/** Progress along the current leg, meters. Negative when the racer is behind the last gate. */
export function legProgressMeters(progress: RacerProgress, route: RaceRoute): number {
  return signedRouteDelta(progress.routeD, progress.legRefD, route);
}

/**
 * Advances one racer by one fixed step. Tests every gate in the lap for a forward crossing, and applies the sequence
 * rules: the next expected gate advances the racer; the gate just passed is ignored (re-crossing, or the launch from
 * the grid); any other gate is reported as out of order and does not advance. A centre move larger than the teleport
 * guard is a relocation, so no gates are tested for that step.
 */
export function stepRacerProgress(
  progress: RacerProgress,
  route: RaceRoute,
  x: number,
  z: number,
  raceTimeSeconds: number,
  finishOrderNext: number,
): { events: readonly RaceProgressEvent[]; finishedNow: boolean } {
  // A looping world's logical coordinates grow without bound. Mapping into the route's base domain makes a car one
  // period away the same car, so a wrap never tests a gate, never relocates the racer, and never finishes a lap.
  // The stored position is normalised first. A racer created at its logical grid position has not been through a step
  // yet, so without this its first step would look like a one-period relocation. Normalising twice changes nothing.
  progress.x = routeFrame(progress.x, route);
  progress.z = routeFrame(progress.z, route);
  return advanceRacer(progress, route, routeFrame(x, route), routeFrame(z, route), raceTimeSeconds, finishOrderNext);
}

/** The base-domain value of a logical coordinate. Finite routes are returned unchanged. */
export function routeFrame(value: number, route: Pick<RaceRoute, 'periodMeters'>): number {
  return route.periodMeters === undefined ? value : wrapToBase(value, route.periodMeters);
}

function advanceRacer(
  progress: RacerProgress,
  route: RaceRoute,
  x: number,
  z: number,
  raceTimeSeconds: number,
  finishOrderNext: number,
): { events: readonly RaceProgressEvent[]; finishedNow: boolean } {
  if (progress.finished) {
    progress.prevX = x;
    progress.prevZ = z;
    progress.x = x;
    progress.z = z;
    return { events: NO_EVENTS, finishedNow: false };
  }
  progress.prevX = progress.x;
  progress.prevZ = progress.z;
  progress.x = x;
  progress.z = z;

  // The stored positions are in the base domain. On a looping route a step across the seam is therefore a jump of about
  // one period in the stored value. Its displacement is the short way round the period: that is driving, not a
  // relocation, and the gate test below uses that short segment, not one that spans the whole map.
  const period = route.periodMeters;
  const dx = period === undefined ? progress.x - progress.prevX : wrapDelta(progress.prevX, progress.x, period);
  const dz = period === undefined ? progress.z - progress.prevZ : wrapDelta(progress.prevZ, progress.z, period);
  const step = Math.hypot(dx, dz);
  if (step <= RACE_CONFIG.maxStepDisplacementMeters) progress.travelledMeters += step;
  if (step > RACE_CONFIG.maxStepDisplacementMeters) {
    progress.relocations += 1;
    progress.lastRelocationSeconds = raceTimeSeconds;
    // A relocation (recovery or reset), not driving. Re-anchor the estimate and do not test gates this step.
    const near = nearestRouteSample(route, x, z, null);
    if (!near || near.distance > RACE_CONFIG.progressLostMeters) return { events: NO_EVENTS, finishedNow: false };
    const expectedGate = route.gates.length > 0 && !progress.finished ? route.gates[progress.gatesPassed % route.gates.length] : undefined;
    const oldD = progress.routeD;
    if (expectedGate) {
      // A relocation must not move the estimate past the next gate without it being crossed. That would skip the
      // gate silently, because a jump is not a crossing. Hold the estimate at the gate; the gate then needs a real
      // forward crossing, or the racer must drive back through it.
      const toGate = signedRouteDelta(expectedGate.routeDistanceMeters, oldD, route);
      const toTarget = signedRouteDelta(near.d, oldD, route);
      if (toGate > 0 && toTarget >= toGate) {
        progress.routeD = expectedGate.routeDistanceMeters;
        progress.relocationsHeld += 1;
        return { events: [{ kind: 'relocation-held', racerId: progress.id, gateId: expectedGate.id }], finishedNow: false };
      }
    }
    progress.routeD = near.d;
    return { events: NO_EVENTS, finishedNow: false };
  }

  const gates = route.gates;
  const G = gates.length;
  if (G === 0) return { events: NO_EVENTS, finishedNow: false };
  let events: RaceProgressEvent[] | null = null;
  let finishedNow = false;
  for (let g = 0; g < G; g += 1) {
    const gate = gates[g];
    if (!gate) continue;
    if (!crossesGate(gate, progress.prevX, progress.prevZ, progress.prevX + dx, progress.prevZ + dz, RACE_CONFIG.gateHalfWidthMeters)) continue;
    const expectedIndex = progress.gatesPassed % G;
    // The gate just passed. Nothing is "just passed" before the first gate, so that case has no previous gate.
    const previousIndex = progress.gatesPassed > 0 ? (expectedIndex - 1 + G) % G : -1;
    const expected = gates[expectedIndex];
    // On a circuit the grid sits behind the start/finish line, so the first crossing of that line is the launch. It is
    // not a lap and not an error. Only a launch within half a lap counts; a whole lap without gates is reported.
    const launch = route.cyclic && progress.gatesPassed === 0 && gate.closesLap && progress.travelledMeters < route.totalMeters / 2;
    if (g === expectedIndex) {
      events ??= [];
      const result = passGate(progress, route, gate, raceTimeSeconds, finishOrderNext, events);
      if (result) finishedNow = true;
      if (progress.finished) break;
    } else if (g === previousIndex || launch) {
      // Re-crossing the gate just passed, or the circuit launch. Silent, by design.
      continue;
    } else {
      events ??= [];
      progress.outOfOrderCount += 1;
      events.push({ kind: 'out-of-order', racerId: progress.id, gateId: gate.id, expectedGateId: expected?.id ?? '' });
    }
  }
  return { events: events ?? NO_EVENTS, finishedNow };
}

/** Records a gate in sequence. Returns true when this gate finished the race. */
function passGate(
  progress: RacerProgress,
  route: RaceRoute,
  gate: RaceGateDef,
  raceTimeSeconds: number,
  finishOrderNext: number,
  events: RaceProgressEvent[],
): boolean {
  progress.gatesPassed += 1;
  progress.legRefD = gate.routeDistanceMeters;
  events.push({ kind: 'gate-passed', racerId: progress.id, gateId: gate.id, atSeconds: raceTimeSeconds });
  if (!gate.closesLap) return false;
  progress.lapsDone += 1;
  const lapSeconds = raceTimeSeconds - progress.lapStartTime;
  progress.lapTimes.push(lapSeconds);
  progress.lapStartTime = raceTimeSeconds;
  if (progress.lapsDone < route.laps) {
    events.push({ kind: 'lap-completed', racerId: progress.id, lap: progress.lapsDone, lapSeconds });
    return false;
  }
  progress.finished = true;
  progress.finishTime = raceTimeSeconds;
  progress.finishOrder = finishOrderNext;
  events.push({ kind: 'finished', racerId: progress.id, finishSeconds: raceTimeSeconds });
  return true;
}
