import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three';
import type { Vector3 } from 'three';
import { RAIN_CONFIG } from '../config/environmentConfig';
import { rainStreakCount, wrapSymmetric } from '../environment/environmentModel';

/** Side length of the square the streak seeds are spread across, in metres. Streaks wrap inside a field around the camera. */
const RAIN_WORLD_SPAN = 1000;
const RAIN_SEED = 20260615;

/** Deterministic pseudo-random values in 0..1 for the streak seeds. Same seeds every run, so tests and screenshots agree. */
export function seededUnit(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Rain as one bounded LineSegments object. The buffer is allocated once at the highest quality count. Each frame only
 * rewrites the first `count` streaks, so there is no per-frame allocation and no unbounded growth.
 * Rain is visual only: it never changes grip or physics.
 */
export class RainField {
  readonly object: LineSegments;
  private readonly geometry: BufferGeometry;
  private readonly material: LineBasicMaterial;
  private readonly seeds: Float32Array;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(capacity * 6), 3));
    this.material = new LineBasicMaterial({ color: RAIN_CONFIG.colour, transparent: true, opacity: 0, depthWrite: false });
    this.object = new LineSegments(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.name = 'RainStreaks';
    const unit = seededUnit(RAIN_SEED);
    this.seeds = new Float32Array(capacity * 3);
    for (let i = 0; i < this.seeds.length; i += 1) this.seeds[i] = unit();
  }

  /** Streaks shown this frame: the quality budget scaled by wetness. */
  update(cameraPosition: Vector3, time: number, wetness: number, budget: number): void {
    const count = Math.min(rainStreakCount(budget, wetness), this.capacity);
    this.object.visible = count > 0;
    this.material.opacity = RAIN_CONFIG.opacity * wetness;
    if (count === 0) return;
    this.geometry.setDrawRange(0, count * 2);
    const positions = this.geometry.getAttribute('position');
    const array = positions.array as Float32Array;
    const radius = RAIN_CONFIG.fieldRadiusMeters;
    const height = RAIN_CONFIG.fieldHeightMeters;
    const length = RAIN_CONFIG.streakLengthMeters;
    const fall = RAIN_CONFIG.fallSpeedMetersPerSecond;
    for (let i = 0; i < count; i += 1) {
      const sx = (this.seeds[i * 3] ?? 0) * RAIN_WORLD_SPAN;
      const sz = (this.seeds[i * 3 + 1] ?? 0) * RAIN_WORLD_SPAN;
      const fy = this.seeds[i * 3 + 2] ?? 0;
      const x = cameraPosition.x + wrapSymmetric(sx - cameraPosition.x, radius);
      const z = cameraPosition.z + wrapSymmetric(sz - cameraPosition.z, radius);
      // Vertical fall, wrapped inside the field height, so streaks are always in view and never accumulate.
      const y = ((fy - (time * fall) / height) % 1 + 1) % 1 * height;
      const o = i * 6;
      array[o] = x;
      array[o + 1] = y;
      array[o + 2] = z;
      array[o + 3] = x + length * 0.12;
      array[o + 4] = y + length;
      array[o + 5] = z;
    }
    positions.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
