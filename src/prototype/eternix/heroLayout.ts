/*
 * Layout of the hero's street: kerbs, pavements, lane markings, lamps, two rows of buildings with their lit windows,
 * and the light trails in each lane, as plain boxes. Pure: no three.js and no React, so the rules can be tested in
 * node. A seed fixes the layout, so the scene is the same on every load. The renderer draws each kind of box as one
 * instanced mesh.
 */

export interface BoxSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  /** 0..1. Each box picks its own brightness from this, so the street is not uniform. */
  readonly tone: number;
}

export interface HeroScenery {
  readonly kerbs: readonly BoxSpec[];
  readonly pavements: readonly BoxSpec[];
  readonly markings: readonly BoxSpec[];
  readonly centreMarkings: readonly BoxSpec[];
  readonly dashes: readonly BoxSpec[];
  readonly lampPosts: readonly BoxSpec[];
  readonly lampHeads: readonly BoxSpec[];
  /** The near row of buildings, close to the pavement. */
  readonly buildings: readonly BoxSpec[];
  readonly windows: readonly BoxSpec[];
  /** The far skyline, behind the near row. Its windows are denser so the city reads as lit at a distance. */
  readonly farBuildings: readonly BoxSpec[];
  readonly farWindows: readonly BoxSpec[];
  /** Light trails along the lanes. Red on the left of the road (cars heading away), white on the right (oncoming). */
  readonly trailsRed: readonly BoxSpec[];
  readonly trailsWhite: readonly BoxSpec[];
}

export interface HeroSceneryOptions {
  readonly seed: number;
  readonly lengthMeters: number;
  readonly roadWidthMeters: number;
  readonly kerbWidthMeters: number;
  readonly kerbHeightMeters: number;
  readonly lineWidthMeters: number;
  readonly edgeInsetMeters: number;
  readonly centreGapMeters: number;
  readonly dashLengthMeters: number;
  readonly dashPeriodMeters: number;
  readonly buildingSetbackMeters: number;
  readonly buildingSpacingMeters: number;
  readonly buildingMinHeightMeters: number;
  readonly buildingMaxHeightMeters: number;
  readonly buildingMinDepthMeters: number;
  readonly buildingMaxDepthMeters: number;
  readonly windowRowMeters: number;
  readonly windowColumnMeters: number;
  readonly windowLitChance: number;
  readonly farSetbackMeters: number;
  readonly farSpacingMeters: number;
  readonly farMinHeightMeters: number;
  readonly farMaxHeightMeters: number;
  readonly farLitChance: number;
  readonly lampSpacingMeters: number;
  readonly lampHeightMeters: number;
  readonly lampSetbackMeters: number;
  readonly trailSpacingMeters: number;
  readonly trailMinLengthMeters: number;
  readonly trailMaxLengthMeters: number;
  readonly trailHeightMeters: number;
  readonly trailWidthMeters: number;
  /** Trails are placed only between these z values, so none sits under the camera. */
  readonly trailZMinMeters: number;
  readonly trailZMaxMeters: number;
  /** The lane centres from the road's centre line, in metres, for one side. Trails use these. */
  readonly laneOffsetsMeters: readonly number[];
}

/** Width of the pavement strip beyond the kerb, metres. */
const PAVEMENT_WIDTH_METERS = 6;
/** Windows sit just proud of the building face, so they read as lit glass rather than a texture. */
const WINDOW_DEPTH_METERS = 0.04;
const WINDOW_HEIGHT_METERS = 1.1;
const WINDOW_WIDTH_METERS = 1.4;
/** Empty band at the bottom of each facade, and above the top window row. */
const FACADE_BASE_METERS = 3.5;
const FACADE_TOP_MARGIN_METERS = 1.5;
/** The gap between a window and the corner of its building, along the facade. */
const FACADE_EDGE_METERS = 1.6;

/** A small seeded random number generator (mulberry32). Returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function box(x: number, y: number, z: number, sx: number, sy: number, sz: number, tone: number): BoxSpec {
  return { x, y, z, sx, sy, sz, tone };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

interface BuildingRow {
  readonly setbackMeters: number;
  readonly spacingMeters: number;
  readonly minHeightMeters: number;
  readonly maxHeightMeters: number;
  readonly minDepthMeters: number;
  readonly maxDepthMeters: number;
  readonly windowRowMeters: number;
  readonly windowColumnMeters: number;
  readonly litChance: number;
}

/** Adds one row of buildings on one side, and the lit windows on their faces. Consumes the seeded random stream. */
function addBuildingRow(
  side: number,
  row: BuildingRow,
  lengthMeters: number,
  halfRoad: number,
  random: () => number,
  buildings: BoxSpec[],
  windows: BoxSpec[],
): void {
  const slotCount = Math.floor(lengthMeters / row.spacingMeters);
  const faceX = side * (halfRoad + row.setbackMeters);
  for (let slot = 0; slot < slotCount; slot += 1) {
    const slotStart = -lengthMeters / 2 + slot * row.spacingMeters;
    const centreZ = slotStart + row.spacingMeters / 2;
    const slotLength = row.spacingMeters * (0.72 + random() * 0.2);
    const depth = lerp(row.minDepthMeters, row.maxDepthMeters, random());
    const height = lerp(row.minHeightMeters, row.maxHeightMeters, random());
    buildings.push(box(faceX + (side * depth) / 2, height / 2, centreZ, depth, height, slotLength, random()));

    for (let y = FACADE_BASE_METERS; y <= height - FACADE_TOP_MARGIN_METERS; y += row.windowRowMeters) {
      for (let z = centreZ - slotLength / 2 + FACADE_EDGE_METERS; z <= centreZ + slotLength / 2 - FACADE_EDGE_METERS; z += row.windowColumnMeters) {
        if (random() < row.litChance) {
          windows.push(box(faceX - (side * WINDOW_DEPTH_METERS) / 2, y, z, WINDOW_DEPTH_METERS, WINDOW_HEIGHT_METERS, WINDOW_WIDTH_METERS, random()));
        }
      }
    }
  }
}

/** Adds light trails in each lane. Each trail is a thin box lying on the asphalt, with a random length and place. */
function addTrails(
  options: HeroSceneryOptions,
  random: () => number,
  red: BoxSpec[],
  white: BoxSpec[],
): void {
  const band = options.trailZMaxMeters - options.trailZMinMeters;
  const count = Math.floor(band / options.trailSpacingMeters);
  for (const offset of options.laneOffsetsMeters) {
    for (let i = 0; i < count; i += 1) {
      const length = lerp(options.trailMinLengthMeters, options.trailMaxLengthMeters, random());
      // The centre is kept so the whole trail lies inside its band, and inside the road.
      const minZ = Math.max(options.trailZMinMeters + length / 2, -options.lengthMeters / 2 + length / 2);
      const maxZ = Math.min(options.trailZMaxMeters - length / 2, options.lengthMeters / 2 - length / 2);
      const z = Math.min(maxZ, Math.max(minZ, options.trailZMinMeters + options.trailSpacingMeters * (i + random())));
      const trail = box(offset, options.trailHeightMeters / 2, z, options.trailWidthMeters, options.trailHeightMeters, length, random());
      // Negative x is the left of the road: red for cars heading away. Positive x is the right: white for oncoming.
      if (offset < 0) red.push(trail);
      else white.push(trail);
    }
  }
}

/** Builds the whole street. Pure and deterministic for a given seed and options. */
export function buildHeroScenery(options: HeroSceneryOptions): HeroScenery {
  const o = options;
  const random = mulberry32(o.seed);
  const half = o.roadWidthMeters / 2;
  const kerbOuter = half + o.kerbWidthMeters;
  const length = o.lengthMeters;
  const lampCount = Math.floor(length / o.lampSpacingMeters);
  const dashCount = Math.floor(length / o.dashPeriodMeters);

  const kerbs: BoxSpec[] = [];
  const pavements: BoxSpec[] = [];
  const markings: BoxSpec[] = [];
  const centreMarkings: BoxSpec[] = [];
  const dashes: BoxSpec[] = [];
  const lampPosts: BoxSpec[] = [];
  const lampHeads: BoxSpec[] = [];
  const buildings: BoxSpec[] = [];
  const windows: BoxSpec[] = [];
  const farBuildings: BoxSpec[] = [];
  const farWindows: BoxSpec[] = [];
  const trailsRed: BoxSpec[] = [];
  const trailsWhite: BoxSpec[] = [];

  const nearRow: BuildingRow = {
    setbackMeters: o.buildingSetbackMeters,
    spacingMeters: o.buildingSpacingMeters,
    minHeightMeters: o.buildingMinHeightMeters,
    maxHeightMeters: o.buildingMaxHeightMeters,
    minDepthMeters: o.buildingMinDepthMeters,
    maxDepthMeters: o.buildingMaxDepthMeters,
    windowRowMeters: o.windowRowMeters,
    windowColumnMeters: o.windowColumnMeters,
    litChance: o.windowLitChance,
  };
  const farRow: BuildingRow = {
    setbackMeters: o.farSetbackMeters,
    spacingMeters: o.farSpacingMeters,
    minHeightMeters: o.farMinHeightMeters,
    maxHeightMeters: o.farMaxHeightMeters,
    minDepthMeters: o.buildingMaxDepthMeters,
    maxDepthMeters: o.buildingMaxDepthMeters * 1.5,
    windowRowMeters: o.windowRowMeters,
    windowColumnMeters: o.windowColumnMeters,
    litChance: o.farLitChance,
  };

  for (const side of [-1, 1]) {
    kerbs.push(box(side * (half + o.kerbWidthMeters / 2), o.kerbHeightMeters / 2, 0, o.kerbWidthMeters, o.kerbHeightMeters, length, 0.5));
    pavements.push(box(side * (kerbOuter + PAVEMENT_WIDTH_METERS / 2), o.kerbHeightMeters / 2, 0, PAVEMENT_WIDTH_METERS, o.kerbHeightMeters, length, 0.5));
    markings.push(box(side * (half - o.edgeInsetMeters), 0.005, 0, o.lineWidthMeters, 0.01, length, 0.5));
    centreMarkings.push(box(side * o.centreGapMeters, 0.005, 0, o.lineWidthMeters * 0.7, 0.01, length, 0.5));

    for (let i = 0; i < dashCount; i += 1) {
      const z = -length / 2 + o.dashPeriodMeters * (i + 0.5);
      dashes.push(box(side * (half / 2), 0.005, z, o.lineWidthMeters * 0.8, 0.01, o.dashLengthMeters, 0.5));
    }

    for (let i = 0; i < lampCount; i += 1) {
      const z = -length / 2 + o.lampSpacingMeters * (i + 0.5);
      const postX = side * (kerbOuter + o.lampSetbackMeters);
      lampPosts.push(box(postX, o.kerbHeightMeters + o.lampHeightMeters / 2, z, 0.2, o.lampHeightMeters, 0.2, 0.5));
      lampHeads.push(
        box(side * (kerbOuter + o.lampSetbackMeters / 2), o.kerbHeightMeters + o.lampHeightMeters - 0.12, z, o.lampSetbackMeters, 0.14, 0.35, 0.5),
      );
    }

    // The order is fixed (far row, then near row), so the layout is the same on every load for the same seed.
    addBuildingRow(side, farRow, length, half, random, farBuildings, farWindows);
    addBuildingRow(side, nearRow, length, half, random, buildings, windows);
  }

  addTrails(o, random, trailsRed, trailsWhite);

  return {
    kerbs,
    pavements,
    markings,
    centreMarkings,
    dashes,
    lampPosts,
    lampHeads,
    buildings,
    windows,
    farBuildings,
    farWindows,
    trailsRed,
    trailsWhite,
  };
}
