import type { BlockInstance } from '../roadMeshData';

/*
 * Solid blocks the city renders as props. Every entry must clear the drivable road by the scenery gap, because the car
 * has no collider for a block and drives straight through one that sits on the road. ROAD_TEST_BLOCKS are validation
 * fixtures from the road-only stage. Four of them overlap the road, so they are not rendered in a city. They are still
 * exported for the tests that use them.
 */
export const CITY_PROP_BLOCKS: readonly BlockInstance[] = [];
