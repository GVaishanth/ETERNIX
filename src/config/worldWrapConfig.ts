/*
 * World wrap tuning (infinite looping world, Stage A). The wrapped world is the populated city lattice, joined into a
 * torus: the east edge joins the west edge and the north edge joins the south edge.
 *
 * These numbers describe the wrap. They must agree with the city layout (src/world/city/cityLayout.ts) and the chunk
 * size in worldStreamingConfig.ts. src/world/wrap/worldWrap.test.ts fails if they drift apart.
 */
const NODE_SPACING_METERS = 200;
const FIRST_NODE_INDEX = -4;

export const WORLD_WRAP_CONFIG = {
  /** Distance between adjacent lattice nodes, meters. Equal to CITY_NODE_SPACING_METERS. */
  nodeSpacingMeters: NODE_SPACING_METERS,
  /**
   * Lowest node index of the wrapped lattice. Node index firstNodeIndex + periodNodes is the same place as firstNodeIndex,
   * so the wrapped lattice has periodNodes distinct nodes per axis. The city layout currently also builds node
   * CITY_NODE_INDEX_MAX as a separate node; Stage B removes that duplicate.
   */
  firstNodeIndex: FIRST_NODE_INDEX,
  /** Lattice period, in nodes, on each axis. 14 nodes of 200 m is 2800 m. */
  periodNodes: 14,
  /**
   * Lowest position of the base domain, metres: the position of node firstNodeIndex, (firstNodeIndex - 2) * spacing. The
   * base domain is [origin, origin + period). A base centred on zero (-period/2 to period/2) only lines up with the
   * node grid at a period of 2400 m. Aligning to the node grid keeps the chunk grid and the roads in step at any period.
   */
  baseOriginMeters: (FIRST_NODE_INDEX - 2) * NODE_SPACING_METERS,
  /**
   * Side of the looping world's ground plane, in metres. The plane follows the car, so it must cover the streaming reach
   * on every side: at least twice (max load radius + keep margin). worldWrap.test.ts checks this.
   */
  loopGroundSizeMeters: 7200,
} as const;
