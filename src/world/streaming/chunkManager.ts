import type { ChunkCoord } from './chunkGrid';

/*
 * Chunk lifecycle. A pure state machine. It decides which chunk moves through which state and how many may load at
 * once. It builds nothing and renders nothing. The renderer reports back through complete, fail, and released.
 *
 *   QUEUED     wanted, waiting for a load slot
 *   LOADING    started; the renderer is building it
 *   ACTIVE     built and mounted
 *   UNLOADING  no longer kept; the renderer removes it on its next sync, then calls released
 *   FAILED     the build failed; retried while failures are within the retry limit
 *
 * Rules that the tests check:
 *   - One record per chunk key. A chunk cannot be queued twice or built twice.
 *   - A queued chunk that is no longer kept is cancelled before it starts. No work is wasted.
 *   - A chunk that is still loading when it stops being kept is unloaded as soon as it is mounted.
 *   - Hysteresis lives in the keep set, not here. A chunk that re-enters the keep set while UNLOADING is restored to
 *     its previous state, so the renderer does not rebuild it.
 *   - Pinned chunks are kept and loaded whatever the distance says.
 *   - The number of loaded and loading chunks never exceeds maxActiveChunks, except for chunks that were already
 *     mounted before a lower limit was set.
 *   - Urgent chunks (under the car) start at once. They skip the start budget and the concurrency limit, but not the
 *     active cap. There are only a handful, so the road under the wheels is never waiting behind distant chunks.
 */

export type ChunkState = 'QUEUED' | 'LOADING' | 'ACTIVE' | 'UNLOADING' | 'FAILED';
export type ChunkDetail = 'full' | 'roads';

export interface ChunkRecord {
  readonly key: string;
  readonly coord: ChunkCoord;
  state: ChunkState;
  detail: ChunkDetail;
  priority: number;
  urgent: boolean;
  /** True once the renderer has reported the chunk built. Decides what an UNLOADING chunk returns to. */
  loaded: boolean;
  failures: number;
  error: string | null;
}

export interface ChunkRequest {
  readonly key: string;
  readonly coord: ChunkCoord;
  readonly priority: number;
  readonly detail: ChunkDetail;
  /** Under the car. Starts without waiting for the start budget or the concurrency limit. */
  readonly urgent: boolean;
}

export interface ManagerLimits {
  readonly maxActiveChunks: number;
  readonly maxConcurrentLoads: number;
  readonly maxRetries: number;
}

export interface ManagerUpdate {
  /** Chunks that should be loaded now. Pinned chunks must be included by the caller. */
  readonly load: readonly ChunkRequest[];
  /** Chunks that may stay loaded. Must include every key in `load`. Hysteresis is expressed here. */
  readonly keep: ReadonlySet<string>;
  /** Pinned chunks. Always kept. */
  readonly pinned: ReadonlySet<string>;
  /** Maximum chunks to start in this update. */
  readonly maxStarts: number;
}

export interface ManagerUpdateResult {
  readonly started: number;
  readonly queuedCancelled: number;
  readonly unloading: number;
  readonly restored: number;
}

export interface ManagerCounts {
  readonly queued: number;
  readonly loading: number;
  readonly active: number;
  readonly unloading: number;
  readonly failed: number;
}

export class ChunkManager {
  private readonly records = new Map<string, ChunkRecord>();
  private readonly limits: ManagerLimits;
  private totalStarted = 0;
  private totalUnloaded = 0;
  private totalFailures = 0;
  private totalCancelled = 0;

  constructor(limits: ManagerLimits) {
    if (limits.maxActiveChunks < 1 || limits.maxConcurrentLoads < 1) {
      throw new Error('Chunk manager limits must allow at least one active chunk and one load');
    }
    this.limits = limits;
  }

  record(key: string): ChunkRecord | undefined {
    return this.records.get(key);
  }

  /** Records in the mounted set, in key order: LOADING and ACTIVE. The renderer mounts exactly these. */
  mounted(): ChunkRecord[] {
    const out: ChunkRecord[] = [];
    for (const record of this.records.values()) {
      if (record.state === 'LOADING' || record.state === 'ACTIVE') out.push(record);
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  counts(): ManagerCounts {
    let queued = 0;
    let loading = 0;
    let active = 0;
    let unloading = 0;
    let failed = 0;
    for (const record of this.records.values()) {
      if (record.state === 'QUEUED') queued += 1;
      else if (record.state === 'LOADING') loading += 1;
      else if (record.state === 'ACTIVE') active += 1;
      else if (record.state === 'UNLOADING') unloading += 1;
      else failed += 1;
    }
    return { queued, loading, active, unloading, failed };
  }

  /** Lifetime totals, for diagnostics and tests. */
  totals(): { started: number; unloaded: number; failures: number; cancelled: number } {
    return { started: this.totalStarted, unloaded: this.totalUnloaded, failures: this.totalFailures, cancelled: this.totalCancelled };
  }

  update(input: ManagerUpdate): ManagerUpdateResult {
    let cancelled = 0;
    let unloading = 0;
    let restored = 0;
    const kept = (key: string) => input.keep.has(key) || input.pinned.has(key);

    // 1. Records that are no longer kept. Queued work is cancelled. Mounted work starts to unload.
    for (const [key, record] of this.records) {
      if (kept(key)) continue;
      if (record.state === 'QUEUED' || record.state === 'FAILED') {
        this.records.delete(key);
        if (record.state === 'QUEUED') cancelled += 1;
      } else if (record.state === 'LOADING' || record.state === 'ACTIVE') {
        record.state = 'UNLOADING';
        unloading += 1;
      }
    }

    // 2. Wanted chunks. Create or refresh a record. Restore an UNLOADING chunk that is wanted again.
    for (const request of input.load) {
      const existing = this.records.get(request.key);
      if (!existing) {
        this.records.set(request.key, {
          key: request.key,
          coord: request.coord,
          state: 'QUEUED',
          detail: request.detail,
          priority: request.priority,
          urgent: request.urgent,
          loaded: false,
          failures: 0,
          error: null,
        });
        continue;
      }
      existing.priority = request.priority;
      existing.urgent = request.urgent;
      if (existing.state === 'UNLOADING') {
        existing.state = existing.loaded ? 'ACTIVE' : 'LOADING';
        restored += 1;
      } else if (existing.state === 'FAILED' && existing.failures <= this.limits.maxRetries) {
        existing.state = 'QUEUED';
      }
      if (existing.state === 'ACTIVE' || existing.state === 'LOADING') {
        existing.detail = request.detail;
      }
    }

    // 3. Start queued chunks. Urgent chunks first, then nearest first. Ordinary chunks respect the start budget and the
    // concurrent-load limit. Every chunk respects the active cap.
    const queued = [...this.records.values()].filter((record) => record.state === 'QUEUED');
    queued.sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) || a.priority - b.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
    let started = 0;
    let loading = 0;
    let occupied = 0;
    for (const record of this.records.values()) {
      if (record.state === 'LOADING') loading += 1;
      if (record.state === 'LOADING' || record.state === 'ACTIVE' || record.state === 'UNLOADING') occupied += 1;
    }
    for (const record of queued) {
      if (occupied >= this.limits.maxActiveChunks) break;
      if (!record.urgent) {
        if (started >= input.maxStarts) break;
        if (loading >= this.limits.maxConcurrentLoads) break;
      }
      record.state = 'LOADING';
      record.loaded = false;
      started += 1;
      loading += 1;
      occupied += 1;
      this.totalStarted += 1;
    }
    this.totalCancelled += cancelled;
    return { started, queuedCancelled: cancelled, unloading, restored };
  }

  /** The renderer built and mounted the chunk. LOADING becomes ACTIVE. Unknown or other states are left alone. */
  complete(key: string): boolean {
    const record = this.records.get(key);
    if (!record || record.state !== 'LOADING') return false;
    record.state = 'ACTIVE';
    record.loaded = true;
    record.error = null;
    return true;
  }

  /** The renderer could not build the chunk. The chunk is FAILED and retried on a later update, within the limit. */
  fail(key: string, message: string): boolean {
    const record = this.records.get(key);
    if (!record || (record.state !== 'LOADING' && record.state !== 'ACTIVE')) return false;
    record.state = 'FAILED';
    record.loaded = false;
    record.failures += 1;
    record.error = message;
    this.totalFailures += 1;
    return true;
  }

  /**
   * The renderer removed the chunk's visuals. UNLOADING records are deleted. FAILED records are kept for retry. A
   * mounted record ignores this call, which keeps React's double effects (if any) from losing a live chunk.
   */
  released(key: string): boolean {
    const record = this.records.get(key);
    if (!record) return false;
    if (record.state === 'UNLOADING') {
      this.records.delete(key);
      this.totalUnloaded += 1;
      return true;
    }
    return false;
  }

  /** Forgets every record. Used on dispose. Does not touch the renderer. */
  clear(): void {
    this.records.clear();
  }
}
