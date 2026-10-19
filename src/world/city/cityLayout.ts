import type { Vec3 } from '../../core/types';
import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';

/*
 * City layout. Pure data: the city is described here, and cityNetwork.ts builds the logical road network from it with
 * the same builders as the test circuit. Nothing is random.
 *
 * Index space. Nodes N(i, j) sit at x = (i - 2) * 200, z = (j - 2) * 200. The original 5 x 5 core uses i, j in 0..4,
 * so every original id (J-2-2, H-0-0:F:0, ...) keeps its meaning. The populated grid extends the same lattice to
 * i, j in [CITY_NODE_INDEX_MIN, CITY_NODE_INDEX_MAX] = [-4, 10]: 15 x 15 nodes, 14 x 14 cells, 2.8 km square. The
 * last row and column duplicate the first after wrapping (node 10 is node -4).
 * Negative indices appear only in ids outside the original core (for example J--2-3).
 *
 *   Streets   H-i-j runs east from N(i, j) to N(i + 1, j). V-i-j runs north from N(i, j) to N(i, j + 1).
 *   Highways  The north-south highway is column V-HIGHWAY_COLUMN-*, the full length of the grid. The east-west highway
 *             is row H-*-HIGHWAY_ROW, the full width. They meet at the interchange J-HIGHWAY_COLUMN-HIGHWAY_ROW.
 *   Cells     Cell C(i, j) is the block between nodes (i..i+1, j..j+1).
 *   Edges     Nodes on the grid edge lack the arms that would leave the grid, so the edge is a closed barrier.
 *   Chunks    World streaming uses 400 m chunks (2 x 2 cells). Chunk (kx, kz) owns cells i in [2kx, 2kx + 1]. See
 *             src/world/streaming/chunkGrid.ts.
 */

export const CITY_ID = 'city';
export const CITY_NODE_SPACING_METERS = 200;
/** Original core: nodes 0..4, cells 0..3. The populated grid extends beyond it. */
const CITY_CORE_NODE_MAX = 4;
/** Populated grid, inclusive node index range. */
export const CITY_NODE_INDEX_MIN: number = WORLD_WRAP_CONFIG.firstNodeIndex;
export const CITY_NODE_INDEX_MAX: number = WORLD_WRAP_CONFIG.firstNodeIndex + WORLD_WRAP_CONFIG.periodNodes;
/** Cell index range, inclusive. A cell's lower-left node is (i, j). */
export const CITY_CELL_INDEX_MIN = CITY_NODE_INDEX_MIN;
export const CITY_CELL_INDEX_MAX = CITY_NODE_INDEX_MAX - 1;
/** Highway column index: streets V-HIGHWAY_COLUMN-j are the north-south highway. */
export const CITY_HIGHWAY_COLUMN = 4;
/** Highway row index: streets H-i-HIGHWAY_ROW are the east-west highway. */
export const CITY_HIGHWAY_ROW = 6;
export const CITY_STREET_SPEED_MPS = 14;
export const CITY_HIGHWAY_SPEED_MPS = 30;

export type DistrictId = 'downtown' | 'industrial' | 'residential' | 'commercial' | 'countryside' | 'hillside';

export const DISTRICT_LABELS: Record<DistrictId, string> = {
  downtown: 'Downtown',
  industrial: 'Industrial',
  residential: 'Residential',
  commercial: 'Commercial',
  countryside: 'Countryside',
  hillside: 'Hillside',
};

/** Tint used by the minimap and the district ground. Original palette. Not tied to any real place. */
export const DISTRICT_TINTS: Record<DistrictId, string> = {
  downtown: '#5b7cfa',
  industrial: '#b07c4a',
  residential: '#4fae6b',
  commercial: '#c85fb6',
  countryside: '#8fb35a',
  hillside: '#a08c5c',
};

/**
 * District of each core cell. Indexed [j][i] with i, j in 0..3 (the original core), j from the south. Column 3 is next
 * to the highway.
 */
export const CITY_CELL_DISTRICTS: readonly (readonly DistrictId[])[] = [
  ['residential', 'industrial', 'industrial', 'industrial'],
  ['residential', 'downtown', 'downtown', 'industrial'],
  ['residential', 'downtown', 'downtown', 'commercial'],
  ['residential', 'commercial', 'commercial', 'commercial'],
];

/**
 * The hillside district: six cell columns, -4, -3, 6, 7, 8, 9. They are contiguous across the loop's seam (cell 9 is
 * next to cell -4). It replaces countryside cells only. The residential ring (-2..5) and the core are unchanged.
 * Each hillside cell i spans nodes i and i + 1. Cell -4 spans nodes -4 and -3 (the wrap of 10 and 11).
 */
export const HILLSIDE_CELL_COLUMNS: readonly number[] = [-4, -3, 6, 7, 8, 9];
/**
 * The hillside's first node, along x. Its six cells cover the nodes from this one to this one plus the width. The two
 * ends of that arc are flat: they sit next to the residential ring (node 6 by cell 5, node -2 by cell -2), so the
 * ring's houses stand on flat ground. Node indices along the arc wrap, so the seam falls inside the mountain.
 */
export const HILLSIDE_FIRST_NODE = 6;
export const HILLSIDE_WIDTH_CELLS = 6;
/** Height of the mountain's peak, metres. A street is 179.6 m long between junction pads, so each side climbs about 3 percent. */
export const HILLSIDE_PEAK_METERS = 12;
/** The row (j index) where the mountain peaks. Its along-strip profile repeats every period. */
export const HILLSIDE_PEAK_ROW = 2;

/**
 * Height of node (i, j) in metres. The mountain is a product of two profiles. Across the strip (the node index along the
 * arc, from HILLSIDE_FIRST_NODE to HILLSIDE_FIRST_NODE + HILLSIDE_WIDTH_CELLS) a half sine rises from zero to a crest in
 * the middle and falls to zero at the far end. Along the strip (the row j) a cosine peaks at HILLSIDE_PEAK_ROW and falls
 * to zero half a period away. Both profiles repeat with the period, so node -4 and node 10 are the same height.
 */
export function nodeHeightMeters(i: number, j: number): number {
  const period = WORLD_WRAP_CONFIG.periodNodes;
  // Position of node i along the hillside arc, wrapped so that the arc is continuous across the seam.
  const along = (((i - HILLSIDE_FIRST_NODE) % period) + period) % period;
  // The two ends of the arc are exactly flat. sin(pi) is not exactly zero in floating point, so test the ends directly.
  if (along <= 0 || along >= HILLSIDE_WIDTH_CELLS) return 0;
  const across = Math.sin((Math.PI * along) / HILLSIDE_WIDTH_CELLS);
  const k = (((j - HILLSIDE_PEAK_ROW) % period) + period) % period;
  const down = (1 + Math.cos((2 * Math.PI * k) / period)) / 2;
  return HILLSIDE_PEAK_METERS * across * down;
}

/** A hillside cell is in the mountain's centre when its average height is at least this share of the peak. */
const MOUNTAIN_CENTRE_HEIGHT_FRACTION = 0.65;

/**
 * True for a hillside cell in the mountain's centre: the ridge where the forest is densest. Heights come from the same
 * function as the terrain, so the centre follows the layout data, not a hard-coded list of cells.
 */
export function isMountainCentreCell(i: number, j: number): boolean {
  if (districtOfCell(i, j) !== 'hillside') return false;
  const average = (nodeHeightMeters(i, j) + nodeHeightMeters(i + 1, j) + nodeHeightMeters(i, j + 1) + nodeHeightMeters(i + 1, j + 1)) / 4;
  return average >= MOUNTAIN_CENTRE_HEIGHT_FRACTION * HILLSIDE_PEAK_METERS;
}

/**
 * Dirt roads (Division 2). On the mountain, every second street row is dirt: a street in a hillside column with an even
 * row index. The highway row stays asphalt. Used for both the east-west street H-i-j and the north-south street V-i-j.
 */
export function isDirtStreet(i: number, j: number): boolean {
  return HILLSIDE_CELL_COLUMNS.includes(i) && j % 2 === 0 && j !== CITY_HIGHWAY_ROW;
}

/** Width, in cells, of the residential ring around the core. Cells beyond it are countryside. */
const CITY_RESIDENTIAL_RING_CELLS = 2;

interface CityLandmark {
  id: string;
  label: string;
  district: DistrictId;
  position: Vec3;
  kind: 'tower' | 'crane' | 'water-tower' | 'mall';
}

/** Landmarks sit at cell centres. Buildings in the same cell are placed around them, never on them. */
export const CITY_LANDMARKS: readonly CityLandmark[] = [
  { id: 'veldmoor-tower', label: 'Veldmoor Tower', district: 'downtown', position: { x: 100, y: 0, z: 100 }, kind: 'tower' },
  { id: 'quay-cranes', label: 'Quay Cranes', district: 'industrial', position: { x: 100, y: 0, z: -300 }, kind: 'crane' },
  { id: 'hillside-water-tower', label: 'Hillside Water Tower', district: 'residential', position: { x: -300, y: 0, z: -100 }, kind: 'water-tower' },
  { id: 'northgate-mall', label: 'Northgate Mall', district: 'commercial', position: { x: 300, y: 0, z: 300 }, kind: 'mall' },
];

/** Spawn: inner right lane of the eastbound street H-1-2 (in the downtown), facing east (yaw +90 degrees). */
export const CITY_SPAWN = { position: { x: -100, y: 0, z: -1.8 }, yawRadians: Math.PI / 2 } as const;

/**
 * Explicit DEV reset pose (Part 5). The eastbound inner lane of H-2-2, the centre street between the centre junction
 * J-2-2 and J-3-2. Used only by the DEV reset action. It is not used by normal reset (R), which returns to CITY_SPAWN.
 */
export const CITY_DEV_RESET = { position: { x: 100, y: 0, z: -1.8 }, yawRadians: Math.PI / 2 } as const;

export function nodeX(i: number): number {
  return (i - 2) * CITY_NODE_SPACING_METERS;
}

export function nodeZ(j: number): number {
  return (j - 2) * CITY_NODE_SPACING_METERS;
}

/** Centre of cell (i, j), between nodes (i, j) and (i + 1, j + 1). */
export function cellCentre(i: number, j: number): { x: number; z: number } {
  return { x: (i - 1.5) * CITY_NODE_SPACING_METERS, z: (j - 1.5) * CITY_NODE_SPACING_METERS };
}

/** Whether a cell lies in the original 4 x 4 core (cells 0..3). */
function isCoreCell(i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i <= CITY_CORE_NODE_MAX - 1 && j <= CITY_CORE_NODE_MAX - 1;
}

/**
 * District of cell (i, j). Core cells use the table. Ring cells within CITY_RESIDENTIAL_RING_CELLS of the core are
 * residential. All other populated cells are countryside.
 */
export function districtOfCell(i: number, j: number): DistrictId {
  if (HILLSIDE_CELL_COLUMNS.includes(i) && isPopulatedCell(i, j)) return 'hillside';
  if (isCoreCell(i, j)) {
    const row = CITY_CELL_DISTRICTS[j];
    const district = row?.[i];
    if (!district) throw new Error(`No district for cell ${i},${j}`);
    return district;
  }
  const ring = CITY_RESIDENTIAL_RING_CELLS;
  const inside =
    i >= -ring && j >= -ring && i <= CITY_CORE_NODE_MAX - 1 + ring && j <= CITY_CORE_NODE_MAX - 1 + ring;
  const inPopulated = i >= CITY_CELL_INDEX_MIN && i <= CITY_CELL_INDEX_MAX && j >= CITY_CELL_INDEX_MIN && j <= CITY_CELL_INDEX_MAX;
  if (!inPopulated) throw new Error(`Cell ${i},${j} is outside the populated grid`);
  return inside ? 'residential' : 'countryside';
}

/** Whether a cell lies in the populated grid. */
function isPopulatedCell(i: number, j: number): boolean {
  return i >= CITY_CELL_INDEX_MIN && i <= CITY_CELL_INDEX_MAX && j >= CITY_CELL_INDEX_MIN && j <= CITY_CELL_INDEX_MAX;
}

/** Whether a node exists on the populated grid. */
export function nodeExists(i: number, j: number): boolean {
  return i >= CITY_NODE_INDEX_MIN && j >= CITY_NODE_INDEX_MIN && i <= CITY_NODE_INDEX_MAX && j <= CITY_NODE_INDEX_MAX;
}
