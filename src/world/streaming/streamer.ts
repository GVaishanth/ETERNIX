import { WORLD_STREAMING_CONFIG, type WorldStreamingConfig } from '../../config/worldStreamingConfig';
import { chunkKey, chunkOfPoint, parseChunkKey, type ChunkCoord } from './chunkGrid';
import { ChunkManager, type ChunkDetail, type ChunkRequest } from './chunkManager';
import { assertStreamingFitsPeriod, canonicalChunk, footprintOwnersAt } from './periodicChunks';
import { chunkDetail, chunkPriority, selectChunks } from './wantedChunks';
import { aheadSamples, countUnloadedAhead, hasChunkContent } from './streamingGaps';
import type { WorldIndex } from './worldIndex';

/**
 * Coordinate of a chunk key in this index. Finite worlds look the key up directly. A looping world accepts any logical
 * key whose canonical chunk has content. Returns undefined for keys that do not name a chunk of this world.
 */
function chunkCoordOfKey(index: WorldIndex, key: string): ChunkCoord | undefined {
  if (!index.period) return index.chunks.get(key);
  const coord = parseChunkKey(key);
  if (!coord) return undefined;
  return index.chunks.has(chunkKey(canonicalChunk(index.period, coord))) ? coord : undefined;
}

/*
 * World streamer. Connects the pure parts: the world index, the wanted-chunk rule, pins, and the chunk manager. It is
 * driven once per render frame from the existing frame loop (RenderLoop.tick). It does not create Three.js objects.
 * The renderer subscribes, mounts the chunks it is told to mount, and reports back.
 *
 * Simulation independence. The streamer reads the player's pose. It never writes to the vehicle, the road boundary,
 * the lane graph, or the race and pursuit state. Those read the global graph, so streaming cannot change them.
 */

export interface StreamPose {
  readonly x: number;
  readonly z: number;
  /** Direction of travel, unit vector in the XZ plane. Used for load priority only. */
  readonly forward: { readonly x: number; readonly z: number };
  readonly speedMps: number;
}

export interface MountedChunk {
  readonly key: string;
  readonly coord: ChunkCoord;
  readonly detail: ChunkDetail;
}

export interface StreamerStats {
  /** Logical chunks with content that the car reaches within the gap strip and that are not active. Zero: no gap ahead. */
  readonly unloadedAhead: number;
  /** True when the chunk under the car is active, or has no content. Null before the first update. */
  readonly underCarActive: boolean | null;
  readonly updates: number;
  readonly teleports: number;
  readonly loadRadiusMeters: number;
  readonly keepRadiusMeters: number;
  readonly queued: number;
  readonly loading: number;
  readonly active: number;
  readonly unloading: number;
  readonly failed: number;
  readonly mounted: number;
  readonly peakMounted: number;
  readonly started: number;
  readonly unloaded: number;
  readonly failures: number;
  readonly cancelled: number;
  readonly pinnedChunks: number;
}

export class WorldStreamer {
  private readonly index: WorldIndex;
  private readonly config: WorldStreamingConfig;
  private readonly manager: ChunkManager;
  private readonly pins = new Map<string, ReadonlySet<string>>();
  private readonly listeners = new Set<() => void>();
  private lastPose: StreamPose | null = null;
  private lastSignature = '';
  private updateCount = 0;
  private teleportCount = 0;
  private peak = 0;
  private loadRadius: number = WORLD_STREAMING_CONFIG.loadRadiusMeters;
  private keepRadius: number = WORLD_STREAMING_CONFIG.loadRadiusMeters + WORLD_STREAMING_CONFIG.keepMarginMeters;
  private disposed = false;

  constructor(index: WorldIndex, config: WorldStreamingConfig = WORLD_STREAMING_CONFIG) {
    this.index = index;
    this.config = config;
    if (index.period) assertStreamingFitsPeriod(index.period, config.maxLoadRadiusMeters + config.keepMarginMeters);
    this.manager = new ChunkManager({
      maxActiveChunks: config.maxActiveChunks,
      maxConcurrentLoads: config.maxConcurrentLoads,
      maxRetries: config.maxRetries,
    });
  }

  /** Advances the streamer by one frame. Cheap: one pass over the footprints, and no allocation for unchanged state. */
  update(pose: StreamPose): void {
    if (this.disposed) return;
    this.updateCount += 1;
    const teleported = this.lastPose !== null && Math.hypot(pose.x - this.lastPose.x, pose.z - this.lastPose.z) > this.config.teleportDistanceMeters;
    if (teleported) this.teleportCount += 1;
    this.lastPose = pose;

    const c = this.config;
    const speed = Math.max(0, pose.speedMps);
    this.loadRadius = Math.min(c.maxLoadRadiusMeters, c.loadRadiusMeters + speed * c.speedLookaheadSeconds);
    this.keepRadius = this.loadRadius + c.keepMarginMeters;

    const loadSet = selectChunks(this.index, pose, this.loadRadius);
    const keepSet = selectChunks(this.index, pose, this.keepRadius);
    const pinned = this.pinnedKeys();
    for (const key of pinned) {
      loadSet.add(key);
      keepSet.add(key);
    }

    const urgent = this.urgentKeys(pose);
    const requests: ChunkRequest[] = [];
    for (const key of loadSet) {
      const coord = chunkCoordOfKey(this.index, key);
      if (!coord) continue;
      const existing = this.manager.record(key);
      const detail = chunkDetail(this.index, coord, pose, c.sceneryRadiusMeters, c.sceneryMarginMeters, existing ? existing.detail : null);
      requests.push({
        key,
        coord,
        priority: chunkPriority(this.index, coord, pose, pose.forward, c.forwardPriorityBias),
        detail,
        urgent: urgent.has(key),
      });
    }

    this.manager.update({
      load: requests,
      keep: keepSet,
      pinned,
      maxStarts: teleported ? c.teleportStartsPerUpdate : c.maxStartsPerUpdate,
    });

    const mounted = this.manager.mounted().length;
    if (mounted > this.peak) this.peak = mounted;
    this.notifyIfChanged();
  }

  /** Mounted chunks, in key order. LOADING and ACTIVE only. The renderer mounts exactly these. */
  mountedChunks(): MountedChunk[] {
    return this.manager.mounted().map((record) => ({ key: record.key, coord: record.coord, detail: record.detail }));
  }

  /** Renderer reports that a mounted chunk is built and in the scene. */
  complete(key: string): boolean {
    return this.manager.complete(key);
  }

  /** Renderer reports that a chunk could not be built. The message is kept for diagnostics. */
  fail(key: string, message: string): boolean {
    const changed = this.manager.fail(key, message);
    this.notifyIfChanged();
    return changed;
  }

  /** Renderer reports that a chunk's visuals were removed. */
  released(key: string): boolean {
    return this.manager.released(key);
  }

  /** Error recorded for a failed chunk, or null. */
  errorOf(key: string): string | null {
    return this.manager.record(key)?.error ?? null;
  }

  /**
   * Pins the chunks an owner needs (for example a race route, or a police unit's surroundings). Pinned chunks are loaded
   * and kept until the owner releases them. Keys that are not chunks of this world are ignored.
   */
  setPins(owner: string, keys: Iterable<string>): void {
    const valid = new Set<string>();
    for (const key of keys) {
      if (chunkCoordOfKey(this.index, key)) valid.add(key);
    }
    if (valid.size === 0) this.pins.delete(owner);
    else this.pins.set(owner, valid);
  }

  releasePins(owner: string): void {
    this.pins.delete(owner);
  }

  /** Subscribes to changes of the mounted set or of any chunk's detail. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stats(): StreamerStats {
    const counts = this.manager.counts();
    const totals = this.manager.totals();
    const isActive = (key: string): boolean => this.manager.record(key)?.state === 'ACTIVE';
    let unloadedAhead = 0;
    let underCarActive: boolean | null = null;
    if (this.lastPose) {
      const samples = aheadSamples(this.lastPose, this.lastPose.forward, {
        lookaheadMeters: this.config.gapLookaheadMeters,
        lateralMeters: this.config.gapLateralMeters,
        stepMeters: this.config.gapStepMeters,
      });
      unloadedAhead = countUnloadedAhead(this.index, samples, isActive);
      const underCar = chunkKey(chunkOfPoint(this.lastPose.x, this.lastPose.z, this.index.sizeMeters));
      underCarActive = !hasChunkContent(this.index, underCar) || isActive(underCar);
    }
    return {
      unloadedAhead,
      underCarActive,
      updates: this.updateCount,
      teleports: this.teleportCount,
      loadRadiusMeters: this.loadRadius,
      keepRadiusMeters: this.keepRadius,
      queued: counts.queued,
      loading: counts.loading,
      active: counts.active,
      unloading: counts.unloading,
      failed: counts.failed,
      mounted: counts.loading + counts.active,
      peakMounted: this.peak,
      started: totals.started,
      unloaded: totals.unloaded,
      failures: totals.failures,
      cancelled: totals.cancelled,
      pinnedChunks: this.pinnedKeys().size,
    };
  }

  /** Stops the streamer. Forgets records and listeners. The renderer is responsible for unmounting its chunks. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.pins.clear();
    this.manager.clear();
  }

  /**
   * Chunks under the car: the chunk that holds the player, and the owner of every footprint that contains the player's
   * point. These start at once, so the road beneath the wheels is never waiting behind distant chunks.
   */
  private urgentKeys(pose: StreamPose): Set<string> {
    const out = new Set<string>();
    out.add(chunkKey(chunkOfPoint(pose.x, pose.z, this.index.sizeMeters)));
    if (this.index.period) {
      for (const key of footprintOwnersAt(this.index.footprints, this.index.period, pose.x, pose.z)) out.add(key);
      return out;
    }
    for (const footprint of this.index.footprints) {
      if (pose.x >= footprint.minX && pose.x <= footprint.maxX && pose.z >= footprint.minZ && pose.z <= footprint.maxZ) {
        out.add(footprint.owner);
      }
    }
    return out;
  }

  private pinnedKeys(): Set<string> {
    const out = new Set<string>();
    for (const keys of this.pins.values()) {
      for (const key of keys) out.add(key);
    }
    return out;
  }

  private signature(): string {
    return this.manager
      .mounted()
      .map((record) => `${chunkKey(record.coord)}:${record.detail}`)
      .join('|');
  }

  private notifyIfChanged(): void {
    const next = this.signature();
    if (next === this.lastSignature) return;
    this.lastSignature = next;
    for (const listener of this.listeners) listener();
  }
}
