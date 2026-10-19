/*
 * Uniform grid broad phase (Part 4). Maps points in the ground plane to cells, and returns candidate ids near a point.
 * Cells are reused between rebuilds, so the hash does not allocate after it has warmed up.
 * Candidates are a superset: the caller still runs the exact test on each one.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly cells = new Map<number, number[]>();
  private readonly usedKeys: number[] = [];

  constructor(cellSizeMeters: number) {
    if (!(cellSizeMeters > 0)) throw new Error('SpatialHash cell size must be positive');
    this.cellSize = cellSizeMeters;
  }

  /** Empties the grid. Lists are kept and emptied, not freed. */
  clear(): void {
    for (const key of this.usedKeys) {
      const list = this.cells.get(key);
      if (list) list.length = 0;
    }
    this.usedKeys.length = 0;
  }

  insert(id: number, x: number, z: number): void {
    const key = this.keyOf(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    if (list.length === 0) this.usedKeys.push(key);
    list.push(id);
  }

  /** Writes the ids in every cell that a square of half size `radius` around (x, z) touches into `out`. */
  query(x: number, z: number, radius: number, out: number[]): void {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    for (let ix = minX; ix <= maxX; ix += 1) {
      for (let iz = minZ; iz <= maxZ; iz += 1) {
        const list = this.cells.get(this.keyOf(ix, iz));
        if (!list) continue;
        for (const id of list) out.push(id);
      }
    }
  }

  private keyOf(ix: number, iz: number): number {
    // Cell indices are small integers on this road (|index| well under 10^5), so this packing is collision-free.
    return (ix + 1048576) * 2097152 + (iz + 1048576);
  }
}
