import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
  LAMP_COLOUR,
  POLE_COLOUR,
  SIGN_COLOUR,
  TRUNK_COLOUR,
  type CityScenery,
  type LandmarkPart,
} from '../world/city/cityScenery';

/*
 * Pure instance data for the city scenery (Part 5). Converts the scenery description into matrices and colours for four
 * shared unit meshes: box, cylinder, cone, and sphere. Every unit mesh has its base on y = 0 (or its centre, for the
 * sphere), so an instance's matrix places it directly in world space. No geometry is created per instance.
 */

export interface CityInstance {
  /** Column-major 4 x 4, as Matrix4.elements. */
  matrix: number[];
  colour: number;
}

export interface CityInstanceSet {
  boxes: CityInstance[];
  cylinders: CityInstance[];
  cones: CityInstance[];
  crowns: CityInstance[];
  /** Lamp heads, in their own set so their emissive glow can change at night without touching other boxes. */
  lampHeads: CityInstance[];
  /** One flat light pool per lamp, drawn on the ground under it. Used at night only. */
  lampPools: CityInstance[];
}

/** Diameter of the light pool under a street lamp, metres. */
export const LAMP_POOL_DIAMETER_M = 14;
/** Height of the light pool above the ground, metres. Above the road surface, so it does not z-fight. */
const LAMP_POOL_HEIGHT_M = 0.06;

const QUARTER_TURN = new Euler(0, Math.PI / 4, 0);
const SIGN_POST_HEIGHT_M = 5;
const SIGN_PANEL_BASE_M = 4.4;
const LAMP_RADIUS_M = 0.12;
const SIGN_POST_RADIUS_M = 0.1;
const TRUNK_RADIUS_M = 0.25;
/** Height of a pine's crown per metre of its radius. */
const PINE_HEIGHT_RATIO = 3.2;

function instance(x: number, y: number, z: number, sx: number, sy: number, sz: number, colour: number, rotationY = 0): CityInstance {
  const position = new Vector3(x, y, z);
  const quaternion = new Quaternion().setFromEuler(new Euler(0, rotationY, 0));
  const scale = new Vector3(sx, sy, sz);
  const matrix = new Matrix4().compose(position, quaternion, scale);
  return { matrix: matrix.toArray(), colour };
}

function partInstance(part: LandmarkPart, into: CityInstanceSet): void {
  if (part.shape === 'box') {
    into.boxes.push(instance(part.x, part.baseY, part.z, part.sx, part.sy, part.sz, part.colour));
  } else if (part.shape === 'cylinder') {
    into.cylinders.push(instance(part.x, part.baseY, part.z, part.radius, part.height, part.radius, part.colour));
  } else {
    into.cones.push(instance(part.x, part.baseY, part.z, part.radius, part.height, part.radius, part.colour, QUARTER_TURN.y));
  }
}

export function buildCityInstances(scenery: CityScenery): CityInstanceSet {
  const set: CityInstanceSet = { boxes: [], cylinders: [], cones: [], crowns: [], lampHeads: [], lampPools: [] };

  for (const building of scenery.buildings) {
    const { footprint } = building;
    const cx = (footprint.x0 + footprint.x1) / 2;
    const cz = (footprint.z0 + footprint.z1) / 2;
    const sx = footprint.x1 - footprint.x0;
    const sz = footprint.z1 - footprint.z0;
    set.boxes.push(instance(cx, 0, cz, sx, building.heightMeters, sz, building.colour));
    if (building.pitchedRoof) {
      // Square pyramid roof. A four-sided cone rotated a quarter turn has its corners on the footprint diagonals.
      const radius = Math.SQRT2 * Math.max(sx, sz) / 2;
      set.cones.push(instance(cx, building.heightMeters, cz, radius, 3, radius, 0x5c4a40, QUARTER_TURN.y));
    }
  }

  for (const part of scenery.landmarkParts) partInstance(part, set);

  // Lamps stand on the ground under them (baseY), so a pole on the hillside is not sunk into the slope or left in the air.
  for (const lamp of scenery.lamps) {
    set.cylinders.push(instance(lamp.x, lamp.baseY, lamp.z, LAMP_RADIUS_M, lamp.heightMeters, LAMP_RADIUS_M, POLE_COLOUR));
    set.lampHeads.push(instance(lamp.x, lamp.baseY + lamp.heightMeters, lamp.z, 0.7, 0.25, 0.5, LAMP_COLOUR));
    set.lampPools.push(instance(lamp.x, lamp.baseY + LAMP_POOL_HEIGHT_M, lamp.z, LAMP_POOL_DIAMETER_M, 1, LAMP_POOL_DIAMETER_M, 0xffffff));
  }

  for (const sign of scenery.signs) {
    set.cylinders.push(instance(sign.x, 0, sign.z, SIGN_POST_RADIUS_M, SIGN_POST_HEIGHT_M, SIGN_POST_RADIUS_M, POLE_COLOUR));
    set.boxes.push(instance(sign.x, SIGN_PANEL_BASE_M, sign.z, 0.15, 1.2, 4, SIGN_COLOUR));
  }

  for (const tree of scenery.trees) {
    set.cylinders.push(instance(tree.x, tree.baseY, tree.z, TRUNK_RADIUS_M, tree.trunkHeight, TRUNK_RADIUS_M, TRUNK_COLOUR));
    if (tree.kind === 'pine') {
      // A pine is a cone on the trunk: its base sits at the top of the trunk, and it is taller than it is wide.
      set.cones.push(instance(tree.x, tree.baseY + tree.trunkHeight, tree.z, tree.crownRadius, tree.crownRadius * PINE_HEIGHT_RATIO, tree.crownRadius, tree.colour));
      continue;
    }
    const crownY = tree.baseY + tree.trunkHeight + tree.crownRadius * 0.6;
    const crown = new Matrix4().compose(
      new Vector3(tree.x, crownY, tree.z),
      new Quaternion(),
      new Vector3(tree.crownRadius, tree.crownRadius, tree.crownRadius),
    );
    set.crowns.push({ matrix: crown.toArray(), colour: tree.colour });
  }

  return set;
}
