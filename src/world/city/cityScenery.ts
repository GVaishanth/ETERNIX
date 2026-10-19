import { pickFrom, seededRandom } from '../../core/random';
import { FLAT_GROUND, GROUND_REACH_METERS, type HillsideGround } from '../hillsideGround';
import {
  CITY_CELL_INDEX_MAX,
  CITY_CELL_INDEX_MIN,
  CITY_HIGHWAY_COLUMN,
  CITY_LANDMARKS,
  CITY_NODE_INDEX_MAX,
  CITY_NODE_INDEX_MIN,
  CITY_NODE_SPACING_METERS,
  cellCentre,
  districtOfCell,
  isMountainCentreCell,
  nodeX,
  nodeZ,
  type DistrictId,
} from './cityLayout';

/*
 * Deterministic city scenery (Part 5). Pure data: footprints, heights, and colours. The renderer turns this into
 * instanced meshes (CityScenery.tsx). Nothing is random: a fixed seed drives every choice, and placement is checked
 * against the other footprints and the roadside clearance, so no prop overlaps another or sits on a road.
 *
 * Visual only. Buildings sit outside the drivable boundary with a clearance margin and have no collider, because no
 * drivable point can reach them. The roadside boundary is what the car collides with. This is recorded as a limitation.
 */

const CITY_SCENERY_SEED = 0x5eed;
/** Interior of a cell kept free of scenery next to the roads, metres from the cell edge. */
export const CELL_EDGE_CLEARANCE_M = 16;
/** Minimum gap between two footprints, and between a footprint and the road, metres. */
export const SCENERY_GAP_M = 3;
const STREET_LAMP_SPACING_M = 40;
/** Lamps sit this far from the centreline, outside the 10.2 m boundary and inside the cell. */
const STREET_LAMP_OFFSET_M = 11.6;
/** Distance from a node centre to the first lamp, so no lamp stands in a junction pad. */
const LAMP_NODE_CLEARANCE_M = 16;

export interface Footprint {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

type BuildingKind = 'tower' | 'block' | 'house' | 'warehouse' | 'mall' | 'slab' | 'landmark';

export interface CityBuilding {
  id: string;
  kind: BuildingKind;
  district: DistrictId;
  footprint: Footprint;
  heightMeters: number;
  colour: number;
  /** Pitched roof (cone) on top of the box, houses only. */
  pitchedRoof: boolean;
}

interface CityTree {
  id: string;
  x: number;
  z: number;
  /** Round broadleaf crown, or a pine: a cone on a short trunk. */
  kind: 'round' | 'pine';
  /** Ground height under the trunk, metres. Zero on the flat city; the hillside ground elsewhere. */
  baseY: number;
  trunkHeight: number;
  crownRadius: number;
  colour: number;
}

interface CityLamp {
  id: string;
  x: number;
  z: number;
  /** Ground height under the pole, metres. The pole stands on it and the head is heightMeters above it. */
  baseY: number;
  heightMeters: number;
}

interface CitySignPost {
  id: string;
  x: number;
  z: number;
  label: string;
}

/**
 * Visual parts of a landmark that are not a footprint box: spires, legs, tanks, crane arms. Each part lies inside its
 * landmark's reserved footprint, so the clearance rules still hold. Positions are the part's base centre.
 */
export type LandmarkPart =
  | { landmarkId: string; shape: 'box'; x: number; z: number; baseY: number; sx: number; sy: number; sz: number; colour: number }
  | { landmarkId: string; shape: 'cylinder'; x: number; z: number; baseY: number; radius: number; height: number; colour: number }
  | { landmarkId: string; shape: 'cone'; x: number; z: number; baseY: number; radius: number; height: number; colour: number };

export interface CityScenery {
  buildings: CityBuilding[];
  landmarkParts: LandmarkPart[];
  trees: CityTree[];
  lamps: CityLamp[];
  signs: CitySignPost[];
  /** Interior cell rectangles, for clearance and containment checks. */
  cells: { i: number; j: number; footprint: Footprint; district: DistrictId }[];
}

/** Original palette, not copied from any reference. */
const PALETTE = {
  glass: [0x4f6d8f, 0x5d7a99, 0x3f5873, 0x6e8aa3],
  concrete: [0xbfb9ad, 0xa9a396, 0xc9c3b6, 0x9d978a],
  brick: [0x9a5b43, 0x8a4f3a, 0xb0705a],
  warehouse: [0x8d9699, 0x7a8288, 0x9aa3a6],
  house: [0xe3d5b8, 0xd8c7a3, 0xc9d6dc, 0xe9e1cf],
  roof: [0x5c4a40, 0x4f5561, 0x6b3f36],
  mall: [0xd9cdb6, 0xcbbfa6],
  slab: [0x5b5f63, 0x8b9094],
  pine: [0x2c5a3a, 0x33613f, 0x274f35],
  tree: [0x3f7d46, 0x4d8b4f, 0x2f6b3c],
  trunk: [0x6b4f36],
  pole: [0x3d4246],
  lamp: [0xfff1c4],
  sign: [0x2e7d52],
} as const;

export const SIGN_COLOUR = PALETTE.sign[0];
export const POLE_COLOUR = PALETTE.pole[0];
export const LAMP_COLOUR = PALETTE.lamp[0];
export const TRUNK_COLOUR = PALETTE.trunk[0];

function footprintAround(x: number, z: number, sx: number, sz: number): Footprint {
  return { x0: x - sx / 2, x1: x + sx / 2, z0: z - sz / 2, z1: z + sz / 2 };
}

export function footprintsOverlap(a: Footprint, b: Footprint, gap: number): boolean {
  return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.z0 < b.z1 + gap && b.z0 < a.z1 + gap;
}

function cellInterior(i: number, j: number): Footprint {
  const c = cellCentre(i, j);
  const half = CITY_NODE_SPACING_METERS / 2 - CELL_EDGE_CLEARANCE_M;
  return { x0: c.x - half, x1: c.x + half, z0: c.z - half, z1: c.z + half };
}

function contains(outer: Footprint, inner: Footprint): boolean {
  return inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.z0 >= outer.z0 && inner.z1 <= outer.z1;
}

/** Places a building only if it lies inside the cell and clears every footprint already placed, by the scenery gap. */
class Placer {
  readonly placed: Footprint[] = [];
  constructor(private readonly interior: Footprint, reserved: Footprint[]) {
    this.placed.push(...reserved);
  }
  tryPlace(footprint: Footprint): boolean {
    if (!contains(this.interior, footprint)) return false;
    for (const other of this.placed) {
      if (footprintsOverlap(footprint, other, SCENERY_GAP_M)) return false;
    }
    this.placed.push(footprint);
    return true;
  }
}

function landmarkFootprint(kind: 'tower' | 'crane' | 'water-tower' | 'mall', x: number, z: number): Footprint {
  switch (kind) {
    case 'tower':
      return footprintAround(x, z, 30, 30);
    case 'crane':
      return footprintAround(x, z, 50, 20);
    case 'water-tower':
      return footprintAround(x, z, 16, 16);
    case 'mall':
      return footprintAround(x, z, 80, 50);
  }
}

export function landmarkReservations(): Footprint[] {
  return CITY_LANDMARKS.map((landmark) => landmarkFootprint(landmark.kind, landmark.position.x, landmark.position.z));
}

function buildLandmarkBuildings(): CityBuilding[] {
  return CITY_LANDMARKS.map((landmark) => {
    const { x, z } = landmark.position;
    const footprint = landmarkFootprint(landmark.kind, x, z);
    const heights: Record<typeof landmark.kind, number> = { tower: 120, crane: 2, 'water-tower': 1, mall: 18 };
    const colours: Record<typeof landmark.kind, number> = { tower: 0x7f9bb8, crane: 0x8a8f94, 'water-tower': 0xb9c2c8, mall: PALETTE.mall[0] };
    return {
      id: landmark.id,
      kind: 'landmark' as const,
      district: landmark.district,
      footprint,
      heightMeters: heights[landmark.kind],
      colour: colours[landmark.kind],
      pitchedRoof: false,
    };
  });
}

/** Visual parts for each landmark, placed inside its footprint. */
function buildLandmarkParts(): LandmarkPart[] {
  const parts: LandmarkPart[] = [];
  for (const landmark of CITY_LANDMARKS) {
    const { x, z } = landmark.position;
    const id = landmark.id;
    if (landmark.kind === 'tower') {
      parts.push({ landmarkId: id, shape: 'cone', x, z, baseY: 120, radius: 9, height: 30, colour: 0xd9e2ea });
    } else if (landmark.kind === 'crane') {
      // Tower on the west side, jib running east, inside the 50 x 20 footprint.
      parts.push({ landmarkId: id, shape: 'box', x: x - 18, z, baseY: 2, sx: 4, sy: 40, sz: 4, colour: 0xd0a33a });
      parts.push({ landmarkId: id, shape: 'box', x: x + 2, z, baseY: 38, sx: 44, sy: 1.5, sz: 1.5, colour: 0xd0a33a });
    } else if (landmark.kind === 'water-tower') {
      for (const dx of [-5, 5]) {
        for (const dz of [-5, 5]) {
          parts.push({ landmarkId: id, shape: 'cylinder', x: x + dx, z: z + dz, baseY: 0, radius: 0.5, height: 16, colour: 0x6f7880 });
        }
      }
      parts.push({ landmarkId: id, shape: 'cylinder', x, z, baseY: 16, radius: 6, height: 6, colour: 0xb9c2c8 });
    }
  }
  return parts;
}

/** Fills one cell. Candidate positions are fixed, so the result depends only on the seed and the cell index. */
function buildCellBuildings(i: number, j: number, reserved: Footprint[]): CityBuilding[] {
  const district = districtOfCell(i, j);
  const c = cellCentre(i, j);
  const random = seededRandom(CITY_SCENERY_SEED ^ Math.imul(i + 1, 73856093) ^ Math.imul(j + 1, 19349663));
  const placer = new Placer(cellInterior(i, j), reserved);
  const out: CityBuilding[] = [];
  const add = (kind: BuildingKind, footprint: Footprint, heightMeters: number, colour: number, pitchedRoof: boolean): void => {
    if (!placer.tryPlace(footprint)) return;
    out.push({ id: `B-${i}-${j}-${out.length}`, kind, district, footprint, heightMeters, colour, pitchedRoof });
  };

  if (district === 'downtown') {
    // Nine candidate towers on a 40 m lattice. Each is kept with probability 0.75, then checked for clearance.
    for (const dz of [-40, 0, 40]) {
      for (const dx of [-40, 0, 40]) {
        if (random() > 0.75) continue;
        const sx = 22 + Math.floor(random() * 5) * 2;
        const sz = 22 + Math.floor(random() * 5) * 2;
        add('tower', footprintAround(c.x + dx, c.z + dz, sx, sz), 40 + Math.floor(random() * 9) * 5, pickFrom(random, PALETTE.glass), false);
      }
    }
  } else if (district === 'commercial') {
    for (const dz of [-30, 30]) {
      for (const dx of [-30, 30]) {
        add('block', footprintAround(c.x + dx, c.z + dz, 44, 28), 12 + Math.floor(random() * 4) * 3, pickFrom(random, PALETTE.mall), false);
      }
    }
    // A parking slab in the open corner, if it fits.
    add('slab', footprintAround(c.x, c.z, 40, 14), 0.2, pickFrom(random, PALETTE.slab), false);
  } else if (district === 'industrial') {
    add('warehouse', footprintAround(c.x, c.z - 38, 70, 34), 11 + Math.floor(random() * 3) * 2, pickFrom(random, PALETTE.warehouse), false);
    add('warehouse', footprintAround(c.x, c.z + 38, 70, 34), 11 + Math.floor(random() * 3) * 2, pickFrom(random, PALETTE.warehouse), false);
    add('slab', footprintAround(c.x, c.z, 70, 14), 0.2, pickFrom(random, PALETTE.slab), false);
  } else if (district === 'hillside') {
    // The hillside holds no buildings: a building on a slope would float or sink. Its trees are pines (buildPineTrees).
  } else if (district === 'countryside') {
    // Countryside: a few scattered farmhouses and one barn at most. Open land, so the cell is mostly empty.
    if (random() < 0.6) {
      add('house', footprintAround(c.x - 40, c.z + 36, 14, 11), 6 + Math.floor(random() * 3), pickFrom(random, PALETTE.house), true);
    }
    if (random() < 0.45) {
      add('warehouse', footprintAround(c.x + 42, c.z - 40, 22, 14), 7 + Math.floor(random() * 2), pickFrom(random, PALETTE.warehouse), false);
    }
  } else {
    // Residential: a 3 x 3 lattice of houses with some gaps, plus a few trees (see buildCellTrees).
    for (const dz of [-26, 0, 26]) {
      for (const dx of [-26, 0, 26]) {
        if (random() < 0.25) continue;
        add('house', footprintAround(c.x + dx, c.z + dz, 12, 10), 6 + Math.floor(random() * 4), pickFrom(random, PALETTE.house), true);
      }
    }
  }
  return out;
}

function buildCellTrees(i: number, j: number, reserved: Footprint[]): CityTree[] {
  const district = districtOfCell(i, j);
  const c = cellCentre(i, j);
  const random = seededRandom(CITY_SCENERY_SEED ^ Math.imul(i + 7, 83492791) ^ Math.imul(j + 3, 2654435761));
  const count = district === 'residential' ? 8 : district === 'downtown' ? 2 : district === 'countryside' ? 14 : 0;
  const trees: CityTree[] = [];
  // The first eight candidates are the original ones, so the core keeps its trees. Countryside uses all of them.
  const candidates: { x: number; z: number }[] = [
    { x: c.x - 76, z: c.z - 70 }, { x: c.x + 76, z: c.z - 70 }, { x: c.x - 76, z: c.z }, { x: c.x + 76, z: c.z },
    { x: c.x - 76, z: c.z + 70 }, { x: c.x + 76, z: c.z + 70 }, { x: c.x, z: c.z - 76 }, { x: c.x, z: c.z + 76 },
    { x: c.x - 40, z: c.z - 40 }, { x: c.x + 40, z: c.z - 40 }, { x: c.x - 40, z: c.z + 40 }, { x: c.x + 40, z: c.z + 40 },
    { x: c.x - 20, z: c.z - 76 }, { x: c.x + 20, z: c.z + 76 },
  ];
  for (let k = 0; k < count; k += 1) {
    const candidate = candidates[k];
    if (!candidate) break;
    const footprint = footprintAround(candidate.x, candidate.z, 4, 4);
    if (reserved.some((other) => footprintsOverlap(footprint, other, SCENERY_GAP_M))) continue;
    trees.push({
      id: `T-${i}-${j}-${k}`,
      x: candidate.x,
      z: candidate.z,
      kind: 'round',
      baseY: 0,
      trunkHeight: 3 + random() * 1.5,
      crownRadius: 2.6 + random() * 0.8,
      colour: pickFrom(random, PALETTE.tree),
    });
  }
  return trees;
}


/**
 * Whole-city scenery, built cell by cell. The streamed world does not call this: it builds each chunk's share with
 * buildCellScenery, buildStreetLamps, and buildStreetSign, which give the same output for the same cell or street.
 */
export function buildCityScenery(
  streetNodes: { min: number; max: number } = { min: CITY_NODE_INDEX_MIN, max: CITY_NODE_INDEX_MAX },
  ground: HillsideGround = FLAT_GROUND,
): CityScenery {
  const reserved = landmarkReservations();
  const buildings: CityBuilding[] = [...buildLandmarkBuildings()];
  const trees: CityTree[] = [];
  const cells: CityScenery['cells'] = [];
  const lamps: CityLamp[] = [];
  const signs: CitySignPost[] = [];
  for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
    for (let i = CITY_CELL_INDEX_MIN; i <= CITY_CELL_INDEX_MAX; i += 1) {
      const part = buildCellScenery(i, j, reserved, ground);
      buildings.push(...part.buildings);
      trees.push(...part.trees);
      cells.push({ i, j, footprint: cellInterior(i, j), district: districtOfCell(i, j) });
    }
  }
  // Streets run over the node range given by the caller. The loop passes its own period, so its far row is not built.
  for (let j = streetNodes.min; j <= streetNodes.max; j += 1) {
    for (let i = CITY_CELL_INDEX_MIN; i <= CITY_CELL_INDEX_MAX; i += 1) {
      lamps.push(...buildStreetLamps('H', i, j, ground));
    }
  }
  for (let i = streetNodes.min; i <= streetNodes.max; i += 1) {
    for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
      lamps.push(...buildStreetLamps('V', i, j, ground));
      const sign = buildStreetSign(i, j);
      if (sign) signs.push(sign);
    }
  }
  return { buildings, landmarkParts: buildLandmarkParts(), trees, lamps, signs, cells };
}

/** Buildings and trees of one cell. Pure: depends only on the cell index and the landmark reservations. */
function buildCellScenery(
  i: number,
  j: number,
  reserved: Footprint[] = landmarkReservations(),
  ground: HillsideGround = FLAT_GROUND,
): { buildings: CityBuilding[]; trees: CityTree[] } {
  const buildings = buildCellBuildings(i, j, reserved);
  const trees = [
    ...buildCellTrees(i, j, [...reserved, ...buildings.map((b) => b.footprint)]),
    ...buildPineTrees(i, j, ground),
  ].map((tree) => ({ ...tree, baseY: ground.heightAt(tree.x, tree.z) }));
  return { buildings, trees };
}

/** Pines per hillside cell, and the minimum gap between two of them, metres. */
/** Pines per hillside cell away from the mountain's centre. */
const PINES_PER_CELL = 40;
/** Pines per cell in the mountain's centre (see isMountainCentreCell). About 100 to 150 each: a dense forest on the ridge. */
const CENTRE_PINES_PER_CELL = 120;
/** Placement attempts per wanted pine. The spacing and road clearance reject many candidate points. */
const PINE_ATTEMPTS_PER_TREE = 10;
const PINE_SPACING_M = 6;
/** Pines stay this far from every road centreline: the carve's reach, plus a margin, so no tree stands in a cut. */
const PINE_ROAD_CLEARANCE_M = GROUND_REACH_METERS + 2;

/**
 * Pine trees on one hillside cell. Placed at seeded positions inside the cell, away from the roads. Other districts get
 * none here: the flat cells keep their own trees (buildCellTrees).
 */
function buildPineTrees(i: number, j: number, ground: HillsideGround): CityTree[] {
  if (districtOfCell(i, j) !== 'hillside') return [];
  const c = cellCentre(i, j);
  const random = seededRandom(CITY_SCENERY_SEED ^ Math.imul(i + 13, 1103515245) ^ Math.imul(j + 17, 2246822519));
  const reach = CITY_NODE_SPACING_METERS / 2 - PINE_ROAD_CLEARANCE_M;
  const wanted = isMountainCentreCell(i, j) ? CENTRE_PINES_PER_CELL : PINES_PER_CELL;
  const attempts = wanted * PINE_ATTEMPTS_PER_TREE;
  const trees: CityTree[] = [];
  for (let attempt = 0; attempt < attempts && trees.length < wanted; attempt += 1) {
    const x = c.x + (random() * 2 - 1) * reach;
    const z = c.z + (random() * 2 - 1) * reach;
    if (ground.roadDistanceAt(x, z) < PINE_ROAD_CLEARANCE_M) continue;
    if (trees.some((other) => Math.hypot(other.x - x, other.z - z) < PINE_SPACING_M)) continue;
    trees.push({
      id: `P-${i}-${j}-${trees.length}`,
      x,
      z,
      kind: 'pine',
      baseY: 0,
      trunkHeight: 2.2 + random() * 0.8,
      crownRadius: 2.4 + random() * 0.8,
      colour: pickFrom(random, PALETTE.pine),
    });
  }
  return trees;
}

/** Street lamps along one street, both sides. 'H' is the east-west street H-i-j, 'V' the north-south street V-i-j. */
export function buildStreetLamps(orientation: 'H' | 'V', i: number, j: number, ground: HillsideGround = FLAT_GROUND): CityLamp[] {
  const lamps: CityLamp[] = [];
  if (orientation === 'H') {
    const x0 = nodeX(i) + LAMP_NODE_CLEARANCE_M;
    const x1 = nodeX(i + 1) - LAMP_NODE_CLEARANCE_M;
    for (let x = x0, k = 0; x <= x1 + 1e-6; x += STREET_LAMP_SPACING_M, k += 1) {
      for (const side of [-1, 1]) {
        lamps.push({ id: `L-H-${i}-${j}-${k}-${side > 0 ? 'n' : 's'}`, x, z: nodeZ(j) + side * STREET_LAMP_OFFSET_M, baseY: 0, heightMeters: 8 });
      }
    }
  } else {
    const z0 = nodeZ(j) + LAMP_NODE_CLEARANCE_M;
    const z1 = nodeZ(j + 1) - LAMP_NODE_CLEARANCE_M;
    for (let z = z0, k = 0; z <= z1 + 1e-6; z += STREET_LAMP_SPACING_M, k += 1) {
      for (const side of [-1, 1]) {
        lamps.push({ id: `L-V-${i}-${j}-${k}-${side > 0 ? 'e' : 'w'}`, x: nodeX(i) + side * STREET_LAMP_OFFSET_M, z, baseY: 0, heightMeters: 8 });
      }
    }
  }
  // Each pole stands on the ground under it. The loop's wrap keeps baseY: it moves the pole and its height together.
  return lamps.map((lamp) => ({ ...lamp, baseY: ground.heightAt(lamp.x, lamp.z) }));
}

/** The highway sign on the verge of V-i-j, or null when the street is not on the highway column. */
function buildStreetSign(i: number, j: number): CitySignPost | null {
  if (i !== CITY_HIGHWAY_COLUMN) return null;
  const z = (nodeZ(j) + nodeZ(j + 1)) / 2;
  return { id: `S-highway-${j}`, x: nodeX(CITY_HIGHWAY_COLUMN) + STREET_LAMP_OFFSET_M, z, label: 'Highway' };
}

