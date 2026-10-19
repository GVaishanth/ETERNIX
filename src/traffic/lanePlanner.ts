import type { LaneGraph } from './laneGraph';

/*
 * Lane route planning for tests and offline checks only. Not used by traffic or the AI, which pick their own successor
 * with successorOf. A breadth-first search over the successor edges gives the fewest-lane route between two lanes, so a
 * test can name waypoints and get a drivable route through them.
 */

/**
 * Shortest lane sequence from `fromId` to `toId`, inclusive, following successor edges. Null when no route exists.
 * Deterministic: successors are visited in their sorted order.
 */
export function findLanePath(graph: LaneGraph, fromId: string, toId: string): string[] | null {
  if (!graph.byId.has(fromId) || !graph.byId.has(toId)) return null;
  const previous = new Map<string, string | null>([[fromId, null]]);
  const queue: string[] = [fromId];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    if (id === undefined) break;
    if (id === toId) break;
    const lane = graph.byId.get(id);
    for (const next of lane?.successorIds ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, id);
      queue.push(next);
    }
  }
  if (!previous.has(toId)) return null;
  const path: string[] = [];
  let cursor: string | null | undefined = toId;
  while (cursor !== null && cursor !== undefined) {
    path.push(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return path.reverse();
}

/** Concatenates shortest paths through waypoints. Null if any leg has no route. */
export function findRouteThrough(graph: LaneGraph, waypointIds: readonly string[]): string[] | null {
  const route: string[] = [];
  for (let k = 0; k + 1 < waypointIds.length; k += 1) {
    const from = waypointIds[k];
    const to = waypointIds[k + 1];
    if (from === undefined || to === undefined) return null;
    const leg = findLanePath(graph, from, to);
    if (!leg) return null;
    // The first lane of each leg is the last lane of the previous leg; avoid repeating it.
    route.push(...(route.length === 0 ? leg : leg.slice(1)));
  }
  return route;
}

/**
 * Shortest lane sequence by length, from `fromId` to `toId`, inclusive. Dijkstra over the successor edges, weighted by
 * each lane's length in metres, so a long lane costs more than a short one. Null when no route exists. Deterministic:
 * ties are broken by lane id. Use this for drivers' routes (navigation). findLanePath counts lanes, not metres.
 */
export function findShortestLanePath(graph: LaneGraph, fromId: string, toId: string): string[] | null {
  if (!graph.byId.has(fromId) || !graph.byId.has(toId)) return null;
  const cost = new Map<string, number>([[fromId, 0]]);
  const previous = new Map<string, string | null>([[fromId, null]]);
  const done = new Set<string>();
  const heap = new LaneHeap();
  heap.push(0, fromId);
  while (heap.size > 0) {
    const top = heap.pop();
    if (top === undefined) break;
    const [distance, id] = top;
    if (done.has(id)) continue;
    done.add(id);
    if (id === toId) break;
    for (const next of graph.byId.get(id)?.successorIds ?? []) {
      if (done.has(next)) continue;
      const nextLane = graph.byId.get(next);
      if (!nextLane) continue;
      const candidate = distance + nextLane.lengthMeters;
      const known = cost.get(next);
      if (known !== undefined && known <= candidate) continue;
      cost.set(next, candidate);
      previous.set(next, id);
      heap.push(candidate, next);
    }
  }
  if (!done.has(toId)) return null;
  const path: string[] = [];
  let cursor: string | null | undefined = toId;
  while (cursor !== null && cursor !== undefined) {
    path.push(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return path.reverse();
}

/** Minimal binary min-heap of (distance, lane id). Ordered by distance, then id, so the search is deterministic. */
class LaneHeap {
  private readonly items: Array<[number, string]> = [];

  get size(): number {
    return this.items.length;
  }

  push(distance: number, id: string): void {
    this.items.push([distance, id]);
    let at = this.items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.less(at, parent)) break;
      this.swap(at, parent);
      at = parent;
    }
  }

  pop(): [number, string] | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let smallest = at;
        if (left < this.items.length && this.less(left, smallest)) smallest = left;
        if (right < this.items.length && this.less(right, smallest)) smallest = right;
        if (smallest === at) break;
        this.swap(at, smallest);
        at = smallest;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a];
    const y = this.items[b];
    if (!x || !y) return false;
    if (x[0] !== y[0]) return x[0] < y[0];
    return x[1] < y[1];
  }

  private swap(a: number, b: number): void {
    const x = this.items[a];
    this.items[a] = this.items[b]!;
    this.items[b] = x!;
  }
}
