import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { GARAGE_CONFIG } from '../config/garageConfig';
import type { NavigationRoute } from '../navigation/navigationPath';
import { imageNear } from '../world/wrap/worldWrap';

/*
 * Navigation visuals inside the mirrored SimRoot: a flat ribbon along the route, and the garage entrance ring. The
 * ribbon is rebuilt only when the route changes. The ring moves to the image nearest the car, so it shows on a loop
 * wherever the car is. Procedural geometry only; no collision, so the road is never blocked.
 */

const ROUTE_HALF_WIDTH_METERS = 0.7;
const ROUTE_Y_METERS = 0.1;
const RING_Y_METERS = 0.04;

export class NavigationVisuals {
  readonly root = new Group();
  private readonly routeMaterial = new MeshBasicMaterial({ color: '#29d3ff', transparent: true, opacity: 0.75, depthWrite: false, side: DoubleSide });
  private routeMesh: Mesh | null = null;
  private readonly garageMaterial = new MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.8, depthWrite: false });
  private readonly garageGeometry: RingGeometry;
  private readonly garageMesh: Mesh | null;

  constructor(
    private readonly garage: { readonly x: number; readonly z: number } | null,
    private readonly period: number | null,
  ) {
    const outer = GARAGE_CONFIG.entranceRadiusMeters;
    this.garageGeometry = new RingGeometry(outer - 0.8, outer, 64);
    if (garage === null) {
      this.garageMesh = null;
    } else {
      this.garageMesh = new Mesh(this.garageGeometry, this.garageMaterial);
      this.garageMesh.rotation.x = -Math.PI / 2;
      this.garageMesh.name = 'GarageEntrance';
      this.root.add(this.garageMesh);
    }
  }

  /** Rebuilds the ribbon for a route, or hides it for null. Called only when the route changes. */
  setRoute(route: NavigationRoute | null): void {
    this.disposeRoute();
    if (route === null || route.points.length < 2) return;
    const positions = ribbonPositions(route);
    if (positions.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.routeMesh = new Mesh(geometry, this.routeMaterial);
    this.routeMesh.name = 'NavigationRoute';
    this.routeMesh.renderOrder = 2;
    this.root.add(this.routeMesh);
  }

  /** Per frame. Moves the garage ring to the image nearest the car (a constant on a finite world). */
  sync(view: { readonly x: number; readonly z: number }): void {
    if (this.garage === null || this.garageMesh === null) return;
    this.garageMesh.position.set(
      imageNear(view.x, this.garage.x, this.period),
      RING_Y_METERS,
      imageNear(view.z, this.garage.z, this.period),
    );
  }

  private disposeRoute(): void {
    if (this.routeMesh === null) return;
    this.root.remove(this.routeMesh);
    this.routeMesh.geometry.dispose();
    this.routeMesh = null;
  }

  dispose(): void {
    this.disposeRoute();
    this.garageGeometry.dispose();
    this.garageMaterial.dispose();
    this.routeMaterial.dispose();
  }
}

/** Two triangles per segment, a strip of width 2 x ROUTE_HALF_WIDTH_METERS on the ground. */
function ribbonPositions(route: NavigationRoute): Float32Array {
  const points = route.points;
  const values: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-6) continue;
    const nx = (-(b.z - a.z) / length) * ROUTE_HALF_WIDTH_METERS;
    const nz = ((b.x - a.x) / length) * ROUTE_HALF_WIDTH_METERS;
    const y = ROUTE_Y_METERS;
    const a1 = [a.x + nx, y, a.z + nz];
    const a2 = [a.x - nx, y, a.z - nz];
    const b1 = [b.x + nx, y, b.z + nz];
    const b2 = [b.x - nx, y, b.z - nz];
    values.push(...a1, ...a2, ...b1, ...a2, ...b2, ...b1);
  }
  return new Float32Array(values);
}
