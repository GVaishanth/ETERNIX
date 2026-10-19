import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry, type BufferGeometry } from 'three';
import { RACE_CONFIG } from '../config/raceConfig';
import type { RaceState } from '../race/raceTypes';
import type { RaceRoute } from '../race/raceRoute';
import { setRaceActiveMarks, setRaceEventMarkers, setRaceEventVisibility } from '../ui/minimapRaceMarks';
import type { RoadElevation } from '../world/roadElevation';
import { imageNear } from '../world/wrap/worldWrap';

/** The part of the race controller the markers read. A controller satisfies it, and a test can pass a plain object. */
export interface RaceMarkSource {
  readonly phase: RaceState;
  activeIndex(): number;
  nextGatePose(out: { x: number; z: number; yaw: number }): boolean;
  /** Whether the route at this index is shown. Optional: a source without it shows every event. */
  routeVisible?(index: number): boolean;
}

/** Where the view is: the player's logical position, and the loop period (null in a finite world). */
export interface RaceView {
  x: number;
  z: number;
  period: number | null;
}

const PILLAR_HEIGHT_METERS = 9;
const RING_RADIUS_METERS = 3.5;
/**
 * Frames between visibility checks. A race unlocks or retires only when a race result is settled, so a check about
 * three times a second is plenty and keeps the per-frame cost flat.
 */
const VISIBILITY_REFRESH_FRAMES = 20;

/**
 * Race markers and the next-gate bar (Part 6). One beacon per event (a pillar and a ground ring on the verge) and one
 * shared gate bar that moves to the next gate. Geometry and materials are created once and shared by every beacon. Each
 * frame only transforms and visibility change. Visual only: there are no colliders here.
 */
export class RaceVisualPool {
  readonly root = new Group();
  private readonly markers: Group[] = [];
  private readonly gateBar: Mesh;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly gateScratch = { x: 0, z: 0, yaw: 0 };
  /** Base-domain marker positions, so each frame can place a marker at the image nearest the view. */
  private readonly markerBase: Array<{ x: number; z: number; yaw: number }> = [];
  /** Road height under the markers and the gate. Null (a flat or empty city) keeps them at height zero. */
  private readonly elevation: RoadElevation | null;
  /** Last visibility per event, in route order. Starts shown. Applied to the marker and to the minimap point. */
  private readonly eventVisible: boolean[] = [];
  private frame = 0;

  constructor(routes: readonly RaceRoute[], elevation: RoadElevation | null = null) {
    this.root.name = 'RaceVisuals';
    this.elevation = elevation;
    setRaceEventMarkers(routes.map((route) => ({ x: route.marker.x, z: route.marker.z })));
    const pillarGeometry = new CylinderGeometry(0.3, 0.3, PILLAR_HEIGHT_METERS, 8);
    pillarGeometry.translate(0, PILLAR_HEIGHT_METERS / 2, 0);
    const ringGeometry = new TorusGeometry(RING_RADIUS_METERS, 0.2, 6, 28);
    ringGeometry.rotateX(Math.PI / 2);
    ringGeometry.translate(0, 0.2, 0);
    const gateGeometry = new BoxGeometry(2 * RACE_CONFIG.gateHalfWidthMeters, 0.25, 0.5);
    gateGeometry.translate(0, 0.125, 0);
    this.geometries.push(pillarGeometry, ringGeometry, gateGeometry);

    const beaconMaterial = new MeshStandardMaterial({ color: '#ffb703', emissive: '#ffb703', emissiveIntensity: 0.5 });
    const ringMaterial = new MeshStandardMaterial({ color: '#ffd166', emissive: '#ffd166', emissiveIntensity: 0.8 });
    const gateMaterial = new MeshStandardMaterial({ color: '#ffd166', emissive: '#ffb703', emissiveIntensity: 0.6, transparent: true, opacity: 0.85 });
    this.materials.push(beaconMaterial, ringMaterial, gateMaterial);

    for (const route of routes) {
      const marker = new Group();
      marker.name = `RaceMarker-${route.eventId}`;
      marker.position.set(route.marker.x, this.groundY(route.marker.x, route.marker.z, route.marker.yawRadians), route.marker.z);
      marker.rotation.set(0, route.marker.yawRadians, 0);
      marker.add(new Mesh(pillarGeometry, beaconMaterial));
      marker.add(new Mesh(ringGeometry, ringMaterial));
      this.markers.push(marker);
      this.markerBase.push({ x: route.marker.x, z: route.marker.z, yaw: route.marker.yawRadians });
      this.eventVisible.push(true);
      this.root.add(marker);
    }

    this.gateBar = new Mesh(gateGeometry, gateMaterial);
    this.gateBar.name = 'RaceNextGate';
    this.gateBar.visible = false;
    this.root.add(this.gateBar);
  }

  /** Per frame: shows the next gate of the race in progress, and hides the marker of an event that has started. */
  sync(controller: RaceMarkSource, view: RaceView): void {
    if (this.frame % VISIBILITY_REFRESH_FRAMES === 0) this.refreshVisibility(controller);
    this.frame += 1;
    const phase = controller.phase;
    const started = phase !== 'FREE_ROAM' && phase !== 'EVENT_APPROACH';
    const active = controller.activeIndex();
    for (let i = 0; i < this.markers.length; i += 1) {
      const marker = this.markers[i];
      const base = this.markerBase[i];
      if (!marker || !base) continue;
      marker.visible = this.eventVisible[i] === true && !(started && i === active);
      // The marker is drawn at the image nearest the view, so a view one period away still shows it.
      const mx = imageNear(view.x, base.x, view.period);
      const mz = imageNear(view.z, base.z, view.period);
      marker.position.set(mx, this.groundY(mx, mz, base.yaw), mz);
    }
    const hasGate = controller.nextGatePose(this.gateScratch);
    this.gateBar.visible = hasGate;
    setRaceActiveMarks(started ? active : null, hasGate ? this.gateScratch : null);
    if (hasGate) {
      // Heading is the lane's travel direction, so a bar rotated by it lies across the road.
      const gx = imageNear(view.x, this.gateScratch.x, view.period);
      const gz = imageNear(view.z, this.gateScratch.z, view.period);
      this.gateBar.position.set(gx, this.groundY(gx, gz, this.gateScratch.yaw), gz);
      this.gateBar.rotation.set(0, this.gateScratch.yaw, 0);
    }
  }

  /** Height of the road at (x, z) for a car with this yaw. Zero when there is no road in reach. */
  private groundY(x: number, z: number, yaw: number): number {
    return this.elevation?.surfaceAt(x, z, yaw)?.heightMeters ?? 0;
  }

  /**
   * Reads each event's visibility and writes it only where it changed, to the marker and to the minimap point. A
   * hidden event keeps its index, so the active index still points at the right marker.
   */
  private refreshVisibility(controller: RaceMarkSource): void {
    for (let i = 0; i < this.markers.length; i += 1) {
      const visible = controller.routeVisible ? controller.routeVisible(i) : true;
      if (visible === this.eventVisible[i]) continue;
      this.eventVisible[i] = visible;
      setRaceEventVisibility(i, visible);
    }
  }

  /** Releases the shared GPU resources. Called by RaceLayer on unmount. */
  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    setRaceEventMarkers([]);
    setRaceActiveMarks(null, null);
  }
}
