import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { effectFeed } from './effectFeed';
import { SMOKE_RULES, SmokePool, emitCountFor, smokeLevel } from './tireSmokeModel';

/*
 * Pooled tire smoke (Part 10). One InstancedMesh sized once for the highest quality count. A ring pool bounds the live
 * particles, so the count never grows, and a stopped car emits nothing. Presentation only: it never touches the body
 * or the physics.
 */

const REAR_AXLE_BEHIND_METERS = 1.3;
const WHEEL_HALF_TRACK_METERS = 0.8;
const PUFF_RISE_PER_SECOND = 0.7;
const PUFF_RADIUS_METERS = 0.35;
const PUFF_HEIGHT_METERS = 0.2;
const PUFF_DRIFT_METERS_PER_SECOND = 1.5;
const FIELD_STRIDE = 5; // x, y, z, drift x, drift z per particle.

export class TireSmokeField {
  readonly object: InstancedMesh;
  private readonly geometry: SphereGeometry;
  private readonly material: MeshBasicMaterial;
  private readonly maxParticles: number;
  private readonly slots: Float32Array;
  private readonly accumulators: [number, number] = [0, 0];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly colour = new Color();
  private pool: SmokePool;
  private capacity = 0;
  private live = 0;

  constructor(maxParticles: number, capacity: number) {
    this.maxParticles = maxParticles;
    this.geometry = new SphereGeometry(PUFF_RADIUS_METERS, 6, 4);
    this.material = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
    this.object = new InstancedMesh(this.geometry, this.material, maxParticles);
    this.object.instanceMatrix.setUsage(DynamicDrawUsage); // Rewritten every frame while the car is moving.
    this.object.frustumCulled = false;
    this.object.count = 0;
    this.object.name = 'TireSmoke';
    const white = new Color('#ffffff');
    for (let i = 0; i < maxParticles; i += 1) this.object.setColorAt(i, white);
    this.slots = new Float32Array(maxParticles * FIELD_STRIDE);
    this.pool = new SmokePool(0);
    this.setCapacity(capacity);
  }

  /** Changes the live particle budget (quality). The pool is rebuilt only when the budget changes. */
  setCapacity(capacity: number): void {
    const next = Math.max(0, Math.min(this.maxParticles, capacity));
    if (next === this.capacity) return;
    this.capacity = next;
    this.pool = new SmokePool(next);
    this.object.count = 0;
  }

  /** One frame. Emits from real slip, wheelspin, or the handbrake, then writes every live slot. */
  update(dt: number, feed: Readonly<typeof effectFeed>): void {
    this.pool.step(dt);
    if (this.capacity === 0 || !feed.active) {
      this.object.count = 0;
      this.live = 0;
      this.object.userData.liveParticles = 0;
      return;
    }
    const level = smokeLevel({
      speedMetersPerSecond: feed.speed,
      lateralSpeedMetersPerSecond: feed.lateralSpeed,
      handbrake: feed.handbrake,
      throttle: feed.throttle,
      wheelSpinRadiansPerSecond: feed.wheelSpin,
    });
    const forwardX = Math.sin(feed.yaw);
    const forwardZ = Math.cos(feed.yaw);
    const rightX = Math.cos(feed.yaw);
    const rightZ = -Math.sin(feed.yaw);
    const rearX = feed.x - forwardX * REAR_AXLE_BEHIND_METERS;
    const rearZ = feed.z - forwardZ * REAR_AXLE_BEHIND_METERS;
    const emit = emitCountFor(level, dt);
    for (let wheel = 0; wheel < 2; wheel += 1) {
      const side = wheel === 0 ? WHEEL_HALF_TRACK_METERS : -WHEEL_HALF_TRACK_METERS;
      let remaining = (this.accumulators[wheel] ?? 0) + emit;
      while (remaining >= 1) {
        remaining -= 1;
        const slot = this.pool.spawn(SMOKE_RULES.lifetimeSeconds);
        if (slot < 0) continue;
        const o = slot * FIELD_STRIDE;
        this.slots[o] = rearX + rightX * side;
        this.slots[o + 1] = PUFF_HEIGHT_METERS;
        this.slots[o + 2] = rearZ + rightZ * side;
        this.slots[o + 3] = -forwardX * PUFF_DRIFT_METERS_PER_SECOND; // Puffs drift back behind the car.
        this.slots[o + 4] = -forwardZ * PUFF_DRIFT_METERS_PER_SECOND;
      }
      this.accumulators[wheel] = remaining;
    }

    let live = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      const life = this.pool.lifeFraction(i);
      if (life < 0) {
        this.scale.set(0, 0, 0);
      } else {
        live += 1;
        const o = i * FIELD_STRIDE;
        const span = life * SMOKE_RULES.lifetimeSeconds;
        this.position.set(
          (this.slots[o] ?? 0) + (this.slots[o + 3] ?? 0) * span,
          (this.slots[o + 1] ?? 0) + PUFF_RISE_PER_SECOND * span,
          (this.slots[o + 2] ?? 0) + (this.slots[o + 4] ?? 0) * span,
        );
        const grow = 0.6 + 1.8 * life;
        this.scale.set(grow, grow, grow);
        // Fades from light grey to a darker grey, rather than using per-instance alpha.
        const shade = 0.95 - 0.55 * life;
        this.colour.setRGB(shade, shade, shade);
        this.object.setColorAt(i, this.colour);
      }
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.object.setMatrixAt(i, this.matrix);
    }
    this.live = live;
    this.object.userData.liveParticles = live; // Read by the DEV read-out. Plain number, no allocation.
    this.object.count = this.capacity;
    this.object.instanceMatrix.needsUpdate = true;
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
  }

  /** Particles alive this frame, counted during the last update. For tests and the DEV read-out. */
  liveParticles(): number {
    return this.live;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object.dispose();
  }
}
