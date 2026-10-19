import { trafficDimensions, findTrafficType } from './trafficTypes';
import type { TrafficVehicle } from './trafficVehicle';
import { groundBoxFromPose, groundBoxOverlap, type GroundBox, type OverlapResult } from '../simulation/obb';
import type { SpatialHash } from '../simulation/spatialHash';
import type { PlayerFootprint, PlayerPose } from './trafficSystem';
import { TRAFFIC_CONFIG } from '../config/trafficConfig';

/*
 * Traffic collision helpers (Part 4). Pure functions over traffic state: boxes, broad-phase pairs, and the deepest
 * contact. The response (which body moves) is decided by TrafficSystem, so there is exactly one place that changes
 * state. There are no forces here, and no physics engine.
 */

export function vehicleBox(vehicle: TrafficVehicle): GroundBox | null {
  if (!vehicle.typeId) return null;
  const dims = trafficDimensions(findTrafficType(vehicle.typeId));
  return groundBoxFromPose(vehicle.x, vehicle.z, vehicle.heading, dims.rearMeters, dims.noseMeters, dims.halfWidthMeters);
}

export function playerBox(player: PlayerPose, footprint: PlayerFootprint): GroundBox {
  return groundBoxFromPose(player.x, player.z, player.yaw, footprint.rearMeters, footprint.noseMeters, footprint.halfWidthMeters);
}

export interface TrafficPair {
  a: TrafficVehicle;
  b: TrafficVehicle;
  overlap: OverlapResult;
}

/**
 * Offsets that bring a box to each of its images on a loop: nine when the world is periodic, the box itself otherwise.
 * The period is far larger than the search radius, so a pair is near in exactly one image and is found once.
 */
export function imageShifts(period: number | null): ReadonlyArray<readonly [number, number]> {
  if (period === null) return [[0, 0]];
  const out: Array<readonly [number, number]> = [];
  for (const i of [-1, 0, 1]) {
    for (const j of [-1, 0, 1]) out.push([i * period, j * period]);
  }
  return out;
}

/** The box moved by (dx, dz). Only the centre moves; the axes and extents are the same. */
export function shiftBox(box: GroundBox, dx: number, dz: number): GroundBox {
  return dx === 0 && dz === 0 ? box : { ...box, cx: box.cx + dx, cz: box.cz + dz };
}

/**
 * Finds every overlapping pair of active traffic vehicles, each pair once. The spatial hash gives the candidates, and
 * the box test confirms them. `hash` must already hold every active vehicle. On a loop, a pair across a seam is found
 * by querying the hash at the image of the box that lies beside the other vehicle.
 */
export function findTrafficPairs(
  vehicles: readonly TrafficVehicle[],
  boxes: readonly (GroundBox | null)[],
  hash: SpatialHash,
  out: TrafficPair[],
  scratch: number[],
  period: number | null,
): void {
  out.length = 0;
  const shifts = imageShifts(period);
  for (const vehicle of vehicles) {
    const box = boxes[vehicle.id];
    if (!vehicle.active || !box) continue;
    for (const [sx, sz] of shifts) {
      scratch.length = 0;
      hash.query(box.cx + sx, box.cz + sz, TRAFFIC_CONFIG.collision.pairSearchRadiusMeters, scratch);
      for (const otherId of scratch) {
        if (otherId <= vehicle.id) continue; // each unordered pair once
        const other = vehicles[otherId];
        const otherBox = boxes[otherId];
        if (!other || !other.active || !otherBox) continue;
        // The other box in the frame of this vehicle: the image that sits next to it.
        const overlap = groundBoxOverlap(box, shiftBox(otherBox, -sx, -sz));
        if (overlap.overlapping) out.push({ a: vehicle, b: other, overlap });
      }
    }
  }
}

export interface PlayerContact {
  vehicle: TrafficVehicle;
  overlap: OverlapResult;
}

/** The deepest overlap between the player and any active traffic vehicle, or null. Ties go to the lower id. */
export function findPlayerContact(
  vehicles: readonly TrafficVehicle[],
  boxes: readonly (GroundBox | null)[],
  player: GroundBox,
  hash: SpatialHash,
  scratch: number[],
  period: number | null,
): PlayerContact | null {
  let best: PlayerContact | null = null;
  for (const [sx, sz] of imageShifts(period)) {
    const image = shiftBox(player, sx, sz);
    scratch.length = 0;
    hash.query(image.cx, image.cz, TRAFFIC_CONFIG.collision.pairSearchRadiusMeters, scratch);
    for (const id of scratch) {
      const vehicle = vehicles[id];
      const box = boxes[id];
      if (!vehicle || !vehicle.active || !box) continue;
      const overlap = groundBoxOverlap(image, box);
      if (!overlap.overlapping) continue;
      if (!best || overlap.depthMeters > best.overlap.depthMeters) best = { vehicle, overlap };
    }
  }
  return best;
}
