import { laneSample, twinLaneId, type LaneGraph } from '../traffic/laneGraph';
import { RACE_CONFIG, RACE_GRID_LANES } from '../config/raceConfig';
import type { RaceRoute } from './raceRoute';

/*
 * Starting grid (Part 6). Pure. The grid has RACE_GRID_LANES columns, one per forward lane of the route's road, so the
 * cars stand side by side. Row 0 sits on the grid anchor (the start line for a circuit, the start for a sprint). Each
 * later row is `gridRowSpacingMeters` further back along the lanes. Slot i is row floor(i / lanes) in column i % lanes:
 * slot 0 is the front-left car, slot 1 the front-right car, slot 2 the second row, and so on. Slots are placed by lane
 * pose, not by moving a transform, so the countdown hold never teleports anything.
 */

/** Rows needed to seat `count` cars across the grid lanes. */
export function gridRowCount(count: number): number {
  return Math.max(1, Math.ceil(Math.max(0, Math.floor(count)) / RACE_GRID_LANES));
}

/** The lane id of a grid column. Column 0 is the route's first lane; the other columns are its twins on higher lane indices. */
export function gridColumnLaneId(route: RaceRoute, column: number): string {
  return column === 0 ? route.grid.laneId : twinLaneId(route.grid.laneId, column);
}

export interface GridSlot {
  row: number;
  laneId: string;
  /** Lane coordinate, meters. */
  s: number;
  /** Rear-axle position and heading, simulation space. */
  x: number;
  z: number;
  yawRadians: number;
  /** Route distance of this slot, meters. Used to seed the racer's progress. */
  routeD: number;
}

/**
 * The first `count` grid slots, in grid order. A slot's `row` is its grid row, so slots 2k and 2k+1 share row k. A
 * count that leaves a row half full is fine: the last row has one car in the first column.
 */
export function buildGridSlots(route: RaceRoute, graph: LaneGraph, count: number): GridSlot[] {
  const slots: GridSlot[] = [];
  const cars = Math.max(1, Math.floor(count));
  const L = route.totalMeters;
  for (let index = 0; index < cars; index += 1) {
    const row = Math.floor(index / RACE_GRID_LANES);
    const column = index % RACE_GRID_LANES;
    const laneId = gridColumnLaneId(route, column);
    const lane = graph.byId.get(laneId);
    if (!lane) throw new Error(`Grid lane ${laneId} is missing from the road graph`);
    const rowS = route.grid.s - row * RACE_CONFIG.gridRowSpacingMeters;
    const s = Math.min(Math.max(rowS, 0), lane.lengthMeters);
    const pose = laneSample(lane, s);
    const routeD = route.cyclic ? ((((rowS - route.originMeters) % L) + L) % L) : rowS;
    slots.push({ row, laneId: lane.id, s, x: pose.x, z: pose.z, yawRadians: pose.heading, routeD });
  }
  return slots;
}

/**
 * Overlap check for a set of slots. Each slot is treated as a box of `lengthMeters` along its heading, `widthMeters`
 * across. Returns the pairs that overlap, by row. An empty result means the grid is clear.
 */
export function gridOverlaps(slots: readonly GridSlot[], lengthMeters: number, widthMeters: number): Array<[number, number]> {
  const overlaps: Array<[number, number]> = [];
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const a = slots[i];
      const b = slots[j];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      // Project the offset onto both headings. Boxes overlap when both axes overlap.
      const alongA = Math.abs(dx * Math.sin(a.yawRadians) + dz * Math.cos(a.yawRadians));
      const acrossA = Math.abs(dx * Math.cos(a.yawRadians) - dz * Math.sin(a.yawRadians));
      if (alongA < lengthMeters && acrossA < widthMeters) overlaps.push([a.row, b.row]);
    }
  }
  return overlaps;
}
