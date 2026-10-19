/*
 * Part 10 tire-smoke rules (pure). Decides when a rear wheel emits smoke and keeps a bounded particle pool. Emission
 * follows real slip or handbrake state, never a timer alone, and a stopped car never emits.
 */

export interface SmokeInput {
  readonly speedMetersPerSecond: number;
  readonly lateralSpeedMetersPerSecond: number;
  readonly handbrake: boolean;
  readonly throttle: number;
  readonly wheelSpinRadiansPerSecond: number;
}

export const SMOKE_RULES = {
  minSpeedMetersPerSecond: 3,
  slipStartMetersPerSecond: 3.5,
  slipFullMetersPerSecond: 9,
  /** Wheel spin from throttle at low speed. Converted to a level below. */
  spinFullRadiansPerSecond: 40,
  /** Particles per second per wheel at full level. Bounded by the pool size as well. */
  maxEmitPerSecond: 14,
  lifetimeSeconds: 0.9,
} as const;

/** Smoke level 0..1 from real slip, handbrake, and wheelspin. Zero below the minimum speed. */
export function smokeLevel(input: SmokeInput): number {
  if (Math.abs(input.speedMetersPerSecond) < SMOKE_RULES.minSpeedMetersPerSecond) return 0;
  const span = SMOKE_RULES.slipFullMetersPerSecond - SMOKE_RULES.slipStartMetersPerSecond;
  const slip = clamp01((Math.abs(input.lateralSpeedMetersPerSecond) - SMOKE_RULES.slipStartMetersPerSecond) / span);
  const spin = input.throttle > 0.5 ? clamp01(Math.abs(input.wheelSpinRadiansPerSecond) / SMOKE_RULES.spinFullRadiansPerSecond) : 0;
  const brake = input.handbrake ? 0.6 : 0;
  return clamp01(Math.max(slip, spin, brake));
}

/** How many particles to emit this frame for one wheel. Fractional emission accumulates in the caller. */
export function emitCountFor(level: number, dtSeconds: number): number {
  return clamp01(level) * SMOKE_RULES.maxEmitPerSecond * Math.max(0, dtSeconds);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A bounded ring pool of particle slots. Reuses the oldest slot when full, so the count never grows. */
export class SmokePool {
  readonly capacity: number;
  private nextSlot = 0;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;

  constructor(capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.ages = new Float32Array(this.capacity).fill(-1);
    this.lifetimes = new Float32Array(this.capacity);
  }

  /** Claims a slot for a new particle. Returns -1 when the pool is empty (capacity 0). */
  spawn(lifetimeSeconds: number): number {
    if (this.capacity === 0) return -1;
    const slot = this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % this.capacity;
    this.ages[slot] = 0;
    this.lifetimes[slot] = lifetimeSeconds;
    return slot;
  }

  /** Advances all live particles. Returns the live age fraction per slot via `ages`, and retires expired ones. */
  step(dtSeconds: number): void {
    for (let i = 0; i < this.capacity; i += 1) {
      const age = this.ages[i] ?? -1;
      if (age < 0) continue;
      const next = age + Math.max(0, dtSeconds);
      this.ages[i] = next >= (this.lifetimes[i] ?? 0) ? -1 : next;
    }
  }

  /** Age fraction 0..1 of a slot, or -1 when the slot is free. */
  lifeFraction(slot: number): number {
    const age = this.ages[slot] ?? -1;
    if (age < 0) return -1;
    const life = this.lifetimes[slot] ?? 1;
    return life > 0 ? clamp01(age / life) : 1;
  }

  liveCount(): number {
    let live = 0;
    for (let i = 0; i < this.capacity; i += 1) if ((this.ages[i] ?? -1) >= 0) live += 1;
    return live;
  }
}
