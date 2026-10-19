import { BoxGeometry, Group, Material, Mesh, MeshStandardMaterial } from 'three';
import { findTrafficType } from '../traffic/trafficTypes';
import type { PoliceVisualUnit } from '../pursuit/pursuitController';
import { TrafficVisualPool, type VisualView } from './trafficVisuals';

/*
 * Police visuals (Part 7). Police cars are sedans in a police livery, with a roof light bar. The pool is the traffic
 * visual pool, with a decoration hook that runs once per built model. Lights are emissive, not light sources, so the
 * cost is fixed: no point lights, and no allocation per frame. Lights flash only for pursuing units.
 *
 * Procedural geometry and materials only. Nothing is loaded from a file. Read-only with respect to the simulation.
 */

const POLICE_BODY_COLOUR = '#f2f2ef';
const POLICE_BASE_COLOUR = '#1d2530';
const RED_COLOUR = '#ff2b2b';
const BLUE_COLOUR = '#2f6bff';
/** Emissive intensity of a lit lamp, and of a dark one. */
const LAMP_LIT = 2.8;
const LAMP_DARK = 0.05;
/** Light bar flashes per second. Alternates red and blue. */
const FLASH_HZ = 3;

interface LampMaterials {
  red: MeshStandardMaterial;
  blue: MeshStandardMaterial;
}

export class PoliceVisualPool {
  readonly root: Group;
  private readonly pool: TrafficVisualPool;
  private readonly lampsByModel = new Map<Group, LampMaterials>();
  private readonly owned: Material[] = [];
  private paint: MeshStandardMaterial | null = null;
  private base: MeshStandardMaterial | null = null;
  private lampGeometry: BoxGeometry | null = null;

  constructor(capacity: number) {
    this.pool = new TrafficVisualPool(capacity, { decorate: (model) => this.decorate(model) });
    this.root = this.pool.root;
  }

  /**
   * Copies unit state to the visuals, then sets the light bar for the frame. `nowSeconds` drives the flash. Called once
   * per render frame, after the simulation update.
   */
  sync(units: readonly PoliceVisualUnit[], nowSeconds: number, view?: VisualView): void {
    this.pool.sync(units, view);
    const redFirst = Math.floor(nowSeconds * FLASH_HZ) % 2 === 0;
    for (const unit of units) {
      const model = this.pool.modelInSlot(unit.id);
      const lamps = model ? this.lampsByModel.get(model) : undefined;
      if (!lamps) continue;
      const lit = unit.lightsOn && unit.active;
      lamps.red.emissiveIntensity = lit && redFirst ? LAMP_LIT : LAMP_DARK;
      lamps.blue.emissiveIntensity = lit && !redFirst ? LAMP_LIT : LAMP_DARK;
    }
  }

  /** Development and test counters. */
  get counts(): { models: number; geometries: number; materials: number } {
    return this.pool.counts;
  }

  /** Disposes the pool, its lamp and livery resources. A later sync() rebuilds what it needs (StrictMode-safe). */
  dispose(): void {
    this.pool.dispose();
    for (const material of this.owned) material.dispose();
    this.owned.length = 0;
    this.lampsByModel.clear();
    this.lampGeometry?.dispose();
    this.lampGeometry = null;
    this.paint = null;
    this.base = null;
  }

  /** Adds the police livery and the light bar to a freshly built sedan. Runs once per model. */
  private decorate(model: Group): void {
    const type = findTrafficType('sedan');
    this.paint ??= this.track(new MeshStandardMaterial({ color: POLICE_BODY_COLOUR, roughness: 0.4, metalness: 0.15 }));
    this.base ??= this.track(new MeshStandardMaterial({ color: POLICE_BASE_COLOUR, roughness: 0.6, metalness: 0.2 }));
    model.traverse((child) => {
      if (child instanceof Mesh && (child.name === 'Body' || child.name === 'Roof')) child.material = this.paint!;
    });
    this.lampGeometry ??= new BoxGeometry(0.34, 0.12, 0.24);
    const red = this.track(new MeshStandardMaterial({ color: RED_COLOUR, emissive: RED_COLOUR, emissiveIntensity: LAMP_DARK }));
    const blue = this.track(new MeshStandardMaterial({ color: BLUE_COLOUR, emissive: BLUE_COLOUR, emissiveIntensity: LAMP_DARK }));
    const bar = new Group();
    bar.name = 'LightBar';
    const y = type.heightMeters + 0.06;
    const z = type.wheelbaseMeters * 0.45;
    const addLamp = (material: MeshStandardMaterial, x: number, name: string): void => {
      const lamp = new Mesh(this.lampGeometry!, material);
      lamp.name = name;
      lamp.position.set(x, 0, 0);
      bar.add(lamp);
    };
    const base = new Mesh(this.lampGeometry!, this.base);
    base.name = 'LightBarBase';
    base.scale.set(2.2, 0.6, 1.2);
    base.position.set(0, -0.04, 0);
    bar.add(base);
    addLamp(red, -0.2, 'LightRed');
    addLamp(blue, 0.2, 'LightBlue');
    bar.position.set(0, y, z);
    model.add(bar);
    this.lampsByModel.set(model, { red, blue });
  }

  private track<T extends Material>(material: T): T {
    this.owned.push(material);
    return material;
  }
}
