import { wrapAngle } from '../core/math';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { nearestOnLane, successorOf, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import { imageNear } from '../world/wrap/worldWrap';

/*
 * Road-aware routing for police (Part 7). Routes are lane chains on the directed lane graph, so a unit only ever drives
 * a legal direction and never routes through a gap between roads. Pure: the only state is the immutable graph index and
 * reusable search buffers.
 *
 * Reachability: a unit routes over successor lanes and over lane changes (LanePath.lateralIds). A lane change costs
 * PURSUIT_CONFIG.routing.laneChangeCostMeters, so a route changes lane only when that saves more than the cost. Every
 * lane of a road is reachable from every other lane of it, so a unit on any of the four lanes can reach the player.
 * planTo() chooses the target among the lanes it can reach.
 *
 * Cost: one Dijkstra per plan, with a binary heap (O(E log V)) and typed arrays reused between calls. Each lane has a
 * bounding box, and lanes whose box is farther than the search radius are skipped before the exact point test. The box
 * distance is a lower bound on the exact distance, so the skip never changes an answer. The controller calls routing on
 * a timer, and never every frame for every unit.
 */

export interface LaneHit {
  laneIndex: number;
  s: number;
  distance: number;
}

export interface PlannedRoute {
  /** Lane indices from the unit's lane to the target lane, inclusive. */
  path: number[];
  targetIndex: number;
  /** Distance from the target point to the target lane, meters. */
  targetDistanceMeters: number;
}

export interface PlanOptions {
  /** Lanes never used, except the start and the target. Used to give a second unit a different approach. */
  avoid?: ReadonlySet<number> | null;
  /** Heading the target point is approached with, or null for any. Lanes facing against it are penalised. */
  preferHeading?: number | null;
  /** Largest distance from the target point to a lane that can be the target, meters. */
  maxTargetMeters: number;
}

/** A lane facing against the preferred heading costs this many extra meters in the target choice. */
const OPPOSING_LANE_PENALTY_METERS = 60;

export class LaneRouter {
  readonly lanes: readonly LanePath[];
  private readonly indexById = new Map<string, number>();
  /** Successor indices per lane, from the graph's candidate successors. */
  private readonly successors: number[][];
  /** Lane-change neighbour indices per lane. Each costs the lane-change penalty on top of the lane length. */
  private readonly laterals: number[][];
  private readonly lengths: Float64Array;
  private readonly dist: Float64Array;
  private readonly previous: Int32Array;
  private readonly done: Uint8Array;
  /** Lane bounding boxes, for the exact lower-bound skip in nearestLane and planTo. */
  private readonly minX: Float64Array;
  private readonly maxX: Float64Array;
  private readonly minZ: Float64Array;
  private readonly maxZ: Float64Array;
  /** Binary heap of (distance, lane index) entries for the search. Lazy deletion: stale entries are skipped. */
  private readonly heapDist: Float64Array;
  private readonly heapIndex: Int32Array;
  private heapSize = 0;

  constructor(graph: LaneGraph) {
    this.lanes = graph.lanes;
    this.lanes.forEach((lane, index) => this.indexById.set(lane.id, index));
    this.successors = this.lanes.map((lane) => {
      const out: number[] = [];
      for (const id of lane.successorIds) {
        const index = this.indexById.get(id);
        if (index !== undefined) out.push(index);
      }
      return out;
    });
    this.laterals = this.lanes.map((lane) => {
      const out: number[] = [];
      for (const id of lane.lateralIds) {
        const index = this.indexById.get(id);
        if (index !== undefined) out.push(index);
      }
      return out;
    });
    this.lengths = Float64Array.from(this.lanes.map((lane) => lane.lengthMeters));
    this.dist = new Float64Array(this.lanes.length);
    this.previous = new Int32Array(this.lanes.length);
    this.done = new Uint8Array(this.lanes.length);
    const count = this.lanes.length;
    this.minX = new Float64Array(count);
    this.maxX = new Float64Array(count);
    this.minZ = new Float64Array(count);
    this.maxZ = new Float64Array(count);
    this.lanes.forEach((lane, index) => {
      let x0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let z0 = Number.POSITIVE_INFINITY;
      let z1 = Number.NEGATIVE_INFINITY;
      for (const point of lane.points) {
        x0 = Math.min(x0, point.x);
        x1 = Math.max(x1, point.x);
        z0 = Math.min(z0, point.z);
        z1 = Math.max(z1, point.z);
      }
      this.minX[index] = x0;
      this.maxX[index] = x1;
      this.minZ[index] = z0;
      this.maxZ[index] = z1;
    });
    // Each link can be relaxed at most once per settled lane, so this bounds the heap.
    let edges = 1;
    for (const out of this.successors) edges += out.length;
    for (const out of this.laterals) edges += out.length;
    this.heapDist = new Float64Array(edges);
    this.heapIndex = new Int32Array(edges);
  }

  /**
   * Distance from a point to a lane's bounding box. Zero inside it. A lower bound on the distance to the lane. On a loop
   * the point is first moved to the image nearest the box, so a target across a seam is measured the short way.
   */
  private boxDistance(index: number, x0: number, z0: number): number {
    const minX = this.minX[index]!;
    const maxX = this.maxX[index]!;
    const minZ = this.minZ[index]!;
    const maxZ = this.maxZ[index]!;
    const period = this.lanes[index]?.periodMeters ?? null;
    const x = imageNear((minX + maxX) / 2, x0, period);
    const z = imageNear((minZ + maxZ) / 2, z0, period);
    const dx = Math.max(minX - x, 0, x - maxX);
    const dz = Math.max(minZ - z, 0, z - maxZ);
    return Math.hypot(dx, dz);
  }

  indexOf(laneId: string): number | undefined {
    return this.indexById.get(laneId);
  }

  /**
   * The nearest lane to a point that a unit with heading `yaw` can drive on. Only lanes whose travel heading agrees
   * with `yaw` (within `toleranceRadians`) count, so a unit is never placed on the opposing lane. Pass `yaw` null to
   * ignore heading (used for a last-known position, where no heading is known).
   */
  nearestLane(x: number, z: number, yaw: number | null, toleranceRadians: number, maxMeters: number): LaneHit | null {
    let best: LaneHit | null = null;
    for (let index = 0; index < this.lanes.length; index += 1) {
      const lane = this.lanes[index];
      if (!lane) continue;
      if (this.boxDistance(index, x, z) > maxMeters) continue;
      const hit = nearestOnLane(lane, x, z);
      if (!hit || hit.distance > maxMeters) continue;
      if (yaw !== null && Math.abs(wrapAngle(hit.heading - yaw)) > toleranceRadians) continue;
      if (!best || hit.distance < best.distance) best = { laneIndex: index, s: hit.s, distance: hit.distance };
    }
    return best;
  }

  /**
   * Plans a route from a lane to the reachable lane nearest a target point. One search covers every reachable lane, then
   * the target is the best reachable lane: nearest the point, with lanes facing against the preferred heading penalised.
   * Returns null when no reachable lane is within `maxTargetMeters`. Deterministic: ties keep the lower index.
   */
  planTo(fromIndex: number, x: number, z: number, options: PlanOptions): PlannedRoute | null {
    if (fromIndex < 0 || fromIndex >= this.lanes.length) return null;
    this.search(fromIndex, options.avoid ?? null, -1);
    let targetIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDistance = 0;
    for (let index = 0; index < this.lanes.length; index += 1) {
      if (!Number.isFinite(this.dist[index]!)) continue;
      if (this.boxDistance(index, x, z) > options.maxTargetMeters) continue;
      const lane = this.lanes[index]!;
      const hit = nearestOnLane(lane, x, z);
      if (!hit || hit.distance > options.maxTargetMeters) continue;
      let score = hit.distance;
      if (options.preferHeading !== null && options.preferHeading !== undefined) {
        if (Math.abs(wrapAngle(hit.heading - options.preferHeading)) > Math.PI / 2) score += OPPOSING_LANE_PENALTY_METERS;
      }
      if (score < bestScore) {
        bestScore = score;
        targetIndex = index;
        bestDistance = hit.distance;
      }
    }
    if (targetIndex < 0) return null;
    const path = this.reconstruct(fromIndex, targetIndex);
    if (!path) return null;
    return { path, targetIndex, targetDistanceMeters: bestDistance };
  }

  /**
   * Lane chain from `fromIndex` to `toIndex`, inclusive, or null when the target cannot be reached. `avoid` lanes are
   * never used, except the start and the target. Deterministic: ties keep the lower index.
   */
  route(fromIndex: number, toIndex: number, avoid: ReadonlySet<number> | null = null): number[] | null {
    const count = this.lanes.length;
    if (fromIndex < 0 || fromIndex >= count || toIndex < 0 || toIndex >= count) return null;
    if (fromIndex === toIndex) return [fromIndex];
    this.search(fromIndex, avoid, toIndex);
    return this.reconstruct(fromIndex, toIndex);
  }

  /** Next-lane map for a route: lane id to the id of the lane after it. The last lane has no entry. */
  routeMap(path: readonly number[]): Map<string, string> {
    const map = new Map<string, string>();
    for (let i = 0; i + 1 < path.length; i += 1) {
      const from = this.lanes[path[i]!];
      const to = this.lanes[path[i + 1]!];
      if (from && to) map.set(from.id, to.id);
    }
    return map;
  }

  /**
   * Lane `meters` ahead of a lane position along the traffic chain (successorOf). Used to pick an intercept point on the
   * player's road. Returns the lane index and the position on it, or null when the chain ends.
   */
  laneAhead(laneIndex: number, s: number, meters: number): { laneIndex: number; s: number } | null {
    let lane: LanePath | undefined = this.lanes[laneIndex];
    let at = s;
    let remaining = meters;
    for (let hop = 0; lane && hop < 32; hop += 1) {
      const available = lane.lengthMeters - at;
      if (remaining <= available) {
        const index = this.indexById.get(lane.id);
        return index === undefined ? null : { laneIndex: index, s: at + remaining };
      }
      remaining -= available;
      const nextId = successorOf(lane);
      const nextIndex = nextId !== undefined ? this.indexById.get(nextId) : undefined;
      lane = nextIndex !== undefined ? this.lanes[nextIndex] : undefined;
      at = 0;
    }
    return null;
  }

  /**
   * Dijkstra from `from`, over lanes, with each lane's length as its cost. Stops early at `to` when it is >= 0; a full
   * search when `to` is -1. Fills dist and previous for the lanes it settled.
   */
  private search(from: number, avoid: ReadonlySet<number> | null, to: number): void {
    this.dist.fill(Number.POSITIVE_INFINITY);
    this.done.fill(0);
    this.previous.fill(-1);
    this.dist[from] = 0;
    this.heapSize = 0;
    this.heapPush(0, from);
    for (;;) {
      // Closest unfinished lane. Ties go to the lower index, as the linear scan this replaced did, so routes are unchanged.
      const current = this.heapPop();
      if (current < 0) return;
      if (this.done[current] === 1) continue;
      if (current === to) return;
      this.done[current] = 1;
      const best = this.dist[current]!;
      const step = best + this.lengths[current]!;
      for (const next of this.successors[current] ?? []) {
        if (this.done[next] === 1) continue;
        if (avoid?.has(next) && next !== to) continue;
        if (step < this.dist[next]!) {
          this.dist[next] = step;
          this.previous[next] = current;
          this.heapPush(step, next);
        }
      }
      const changed = step + PURSUIT_CONFIG.routing.laneChangeCostMeters;
      for (const next of this.laterals[current] ?? []) {
        if (this.done[next] === 1) continue;
        if (avoid?.has(next) && next !== to) continue;
        if (changed < this.dist[next]!) {
          this.dist[next] = changed;
          this.previous[next] = current;
          this.heapPush(changed, next);
        }
      }
    }
  }

  private heapLess(a: number, b: number): boolean {
    const da = this.heapDist[a]!;
    const db = this.heapDist[b]!;
    return da < db || (da === db && this.heapIndex[a]! < this.heapIndex[b]!);
  }

  private heapSwap(a: number, b: number): void {
    const d = this.heapDist[a]!;
    this.heapDist[a] = this.heapDist[b]!;
    this.heapDist[b] = d;
    const i = this.heapIndex[a]!;
    this.heapIndex[a] = this.heapIndex[b]!;
    this.heapIndex[b] = i;
  }

  private heapPush(distance: number, index: number): void {
    let at = this.heapSize;
    this.heapSize += 1;
    this.heapDist[at] = distance;
    this.heapIndex[at] = index;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.heapLess(at, parent)) break;
      this.heapSwap(at, parent);
      at = parent;
    }
  }

  /** Removes the smallest entry and returns its lane index, or -1 when the heap is empty. */
  private heapPop(): number {
    if (this.heapSize === 0) return -1;
    const top = this.heapIndex[0]!;
    this.heapSize -= 1;
    if (this.heapSize > 0) {
      this.heapSwap(0, this.heapSize);
      let at = 0;
      for (;;) {
        const left = 2 * at + 1;
        const right = left + 1;
        let smallest = at;
        if (left < this.heapSize && this.heapLess(left, smallest)) smallest = left;
        if (right < this.heapSize && this.heapLess(right, smallest)) smallest = right;
        if (smallest === at) break;
        this.heapSwap(at, smallest);
        at = smallest;
      }
    }
    return top;
  }

  /** The path to `to` from the last search, or null when `to` was not reached. */
  private reconstruct(from: number, to: number): number[] | null {
    if (!Number.isFinite(this.dist[to]!)) return null;
    const path: number[] = [];
    for (let at = to; at !== -1; at = this.previous[at]!) {
      path.push(at);
      if (at === from) break;
    }
    if (path[path.length - 1] !== from) return null;
    return path.reverse();
  }
}
