import { TRAFFIC_CONFIG } from '../config/trafficConfig';
import type { AmbientTrafficGenerator } from './trafficAmbient';
import type { PlayerPose, SpawnRequest, SpawnResult, TrafficSystem } from './trafficSystem';

/*
 * Spawn scheduler (Part 4). Holds spawn requests and retries them on a timer. A request that is rejected stays pending
 * and is retried later. Nothing is forced into the world. Requests come from a scenario (fixed) or from a seeded
 * generator, so the same scenario always produces the same spawn sequence.
 */

export interface PendingSpawn {
  request: SpawnRequest;
  attempts: number;
  lastRejection: string | null;
  /** True for requests proposed by the ambient generator. Those are dropped after maxAttempts. */
  ambient: boolean;
}

export class TrafficSpawner {
  private readonly initial: readonly SpawnRequest[];
  private pending: PendingSpawn[];
  private retryElapsed = 0;
  private suspended = false;
  /** Ambient requests dropped after maxAttempts. Counted, never silent. */
  ambientDropped = 0;
  private readonly ambient: AmbientTrafficGenerator | null;

  constructor(requests: readonly SpawnRequest[], ambient: AmbientTrafficGenerator | null = null) {
    this.initial = requests;
    this.ambient = ambient;
    this.pending = requests.map((request) => ({ request, attempts: 0, lastRejection: null, ambient: false }));
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get pendingRequests(): readonly PendingSpawn[] {
    return this.pending;
  }

  /** Stops new spawns and retries until resume(). Existing vehicles are not touched. */
  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /** Restores the scenario's requests. Used by the development scenario reset. */
  reset(): void {
    this.pending = this.initial.map((request) => ({ request, attempts: 0, lastRejection: null, ambient: false }));
    this.retryElapsed = TRAFFIC_CONFIG.spawn.retryIntervalSeconds;
    this.ambientDropped = 0;
    this.ambient?.reset();
  }

  /**
   * Tries each pending request once per retry interval. Successful requests leave the queue. Rejected ones stay, with
   * the reason recorded. Returns the number of vehicles spawned by this call.
   */
  tick(system: TrafficSystem, player: PlayerPose, dtSeconds: number): number {
    // Suspended spawning (a race keeps its area clear): nothing is requested and nothing is retried.
    if (this.suspended) return 0;
    if (this.ambient) {
      // The generator sees the population including pending requests, so it never over-requests.
      const population = system.activeCount + this.pending.length;
      const request = this.ambient.next(player, population, dtSeconds);
      if (request) this.pending.push({ request, attempts: 0, lastRejection: null, ambient: true });
    }

    this.retryElapsed += dtSeconds;
    if (this.retryElapsed < TRAFFIC_CONFIG.spawn.retryIntervalSeconds) return 0;
    this.retryElapsed = 0;

    let spawned = 0;
    const remaining: PendingSpawn[] = [];
    for (const entry of this.pending) {
      const result: SpawnResult = system.spawn(entry.request, player);
      entry.attempts += 1;
      if (result.ok) {
        spawned += 1;
        entry.lastRejection = null;
      } else {
        entry.lastRejection = result.reason;
        if (entry.ambient && entry.attempts >= TRAFFIC_CONFIG.ambient.maxAttempts) {
          this.ambientDropped += 1;
          continue;
        }
        remaining.push(entry);
      }
    }
    this.pending = remaining;
    return spawned;
  }
}
