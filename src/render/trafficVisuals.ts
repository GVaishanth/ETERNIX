import { Group } from 'three';
import type { TrafficTypeId } from '../traffic/trafficTypes';
import { createTrafficModelFactory, type TrafficModelFactory } from './trafficModel';
import { imageNear } from '../world/wrap/worldWrap';

/*
 * Traffic visual pool (Part 4). One slot per pooled vehicle. Each slot holds at most one model per type, built on
 * first use and then reused. Transforms are written absolutely each frame, and never accumulated. Inactive slots are
 * hidden. Nothing is created per frame after a type has been seen once in a slot.
 *
 * Read-only with respect to the simulation: sync() only reads the traffic system.
 */

/** What the visual needs from a vehicle. Traffic vehicles and opponents both provide it. Read only. */
export interface VisualVehicle {
  id: number;
  active: boolean;
  typeId: TrafficTypeId | null;
  x: number;
  /** Height of the road under the vehicle, metres. */
  y: number;
  z: number;
  heading: number;
}

interface SlotVisual {
  models: Map<TrafficTypeId, Group>;
  current: Group | null;
}

/** Optional per-model decoration, run once when a model is built. Used by the police to add livery and lights. */
export interface TrafficVisualPoolOptions {
  decorate?: (model: Group, slotId: number, typeId: TrafficTypeId) => void;
}

/** Where the driven car is, and the loop period (null when finite). Vehicles are drawn in the image nearest this point. */
export interface VisualView {
  readonly x: number;
  readonly z: number;
  readonly period: number | null;
}

export class TrafficVisualPool {
  readonly root = new Group();
  private factory: TrafficModelFactory | null = null;
  private slots: SlotVisual[];
  private readonly decorate: TrafficVisualPoolOptions['decorate'];

  /** Per slot: the frame number that last wrote it. Lets sync() hide slots that were not written, without allocating. */
  private readonly stamp: Uint32Array;
  private frame = 0;

  constructor(capacity: number, options: TrafficVisualPoolOptions = {}) {
    this.root.name = 'TrafficVisuals';
    this.slots = Array.from({ length: capacity }, () => ({ models: new Map(), current: null }));
    this.stamp = new Uint32Array(capacity);
    this.decorate = options.decorate;
  }

  /** The model currently shown in a slot, or null. Read only: the caller may adjust its extra parts, never its transform. */
  modelInSlot(slotId: number): Group | null {
    return this.slots[slotId]?.current ?? null;
  }

  /**
   * Copies the vehicle state to the visual objects. Called once per render frame. Slot i shows the vehicle with id i.
   * Fewer vehicles than slots is valid (a race has 2 or 3 opponents in a 3-slot pool): every slot not written this
   * frame is hidden. More vehicles than slots is a configuration error.
   */
  sync(vehicles: readonly VisualVehicle[], view?: VisualView): void {
    if (vehicles.length > this.slots.length) {
      throw new Error(`Visual pool capacity ${this.slots.length} is smaller than the vehicle count ${vehicles.length}`);
    }
    this.frame += 1;
    for (const vehicle of vehicles) {
      const slot = this.slots[vehicle.id];
      if (!slot) continue;
      this.stamp[vehicle.id] = this.frame;
      if (!vehicle.active || !vehicle.typeId) {
        if (slot.current) slot.current.visible = false;
        slot.current = null;
        continue;
      }
      const model = this.modelFor(slot, vehicle.typeId, vehicle.id);
      if (slot.current !== model) {
        if (slot.current) slot.current.visible = false;
        slot.current = model;
        model.visible = true;
      }
      // Same convention as the player's rig: the root is placed in simulation space, and yaw is about +Y. On a loop the
      // vehicle is drawn in the image nearest the view (the driven car), so a car across a seam is drawn beside it.
      const x = view ? imageNear(view.x, vehicle.x, view.period) : vehicle.x;
      const z = view ? imageNear(view.z, vehicle.z, view.period) : vehicle.z;
      model.position.set(x, vehicle.y, z);
      model.rotation.set(0, vehicle.heading, 0);
    }
    for (let i = 0; i < this.slots.length; i += 1) {
      if (this.stamp[i] === this.frame) continue;
      const slot = this.slots[i];
      if (slot?.current) slot.current.visible = false;
      if (slot) slot.current = null;
    }
  }

  /** Disposes the shared GPU resources and removes every model. A later sync() rebuilds what it needs (StrictMode-safe). */
  dispose(): void {
    for (const slot of this.slots) {
      for (const model of slot.models.values()) this.root.remove(model);
      slot.models.clear();
      slot.current = null;
    }
    this.factory?.dispose();
    this.factory = null;
  }

  /** Development and test counters only. */
  get counts(): { models: number; geometries: number; materials: number } {
    let models = 0;
    for (const slot of this.slots) models += slot.models.size;
    const resources = this.factory?.resourceCounts ?? { geometries: 0, materials: 0 };
    return { models, geometries: resources.geometries, materials: resources.materials };
  }

  private modelFor(slot: SlotVisual, typeId: TrafficTypeId, slotId: number): Group {
    const existing = slot.models.get(typeId);
    if (existing) return existing;
    this.factory ??= createTrafficModelFactory();
    const built = this.factory.build(typeId, slotId);
    this.decorate?.(built, slotId, typeId);
    this.root.add(built);
    built.visible = false;
    slot.models.set(typeId, built);
    return built;
  }
}
