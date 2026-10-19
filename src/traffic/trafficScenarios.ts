import type { OpponentSpec } from '../ai/aiOpponents';
import type { SpawnRequest } from './trafficSystem';

/*
 * Fixed traffic scenarios (Part 4). Deterministic: the same requests give the same spawn sequence.
 * Every request is validated when it is tried, so a request that is unsafe at the moment is postponed, not forced.
 */

/** Circuit traffic. Spread around the loop, across all four types. Requests wait until a spawn is safe. */
export const CIRCUIT_TRAFFIC_SCENARIO: readonly SpawnRequest[] = [
  { typeId: 'sedan', laneId: 'S3:F:0', s: 120, speedMps: 12, cruiseSpeedMps: 15 },
  { typeId: 'compact', laneId: 'T2:F:0', s: 40, speedMps: 10, cruiseSpeedMps: 14 },
  { typeId: 'suv', laneId: 'S4:F:0', s: 100, speedMps: 11, cruiseSpeedMps: 13 },
  { typeId: 'van', laneId: 'S2b:F:0', s: 20, speedMps: 9, cruiseSpeedMps: 11 },
];

/**
 * City traffic. Spread over the grid and the highway, across all four types. Lane ids name the streets of cityLayout.
 * The highway request uses the east column (V-4-1), which has the higher speed limit.
 */
export const CITY_TRAFFIC_SCENARIO: readonly SpawnRequest[] = [
  { typeId: 'sedan', laneId: 'H-0-2:F:0', s: 120, speedMps: 10, cruiseSpeedMps: 13 },
  { typeId: 'compact', laneId: 'V-2-1:R:0', s: 60, speedMps: 9, cruiseSpeedMps: 12 },
  { typeId: 'suv', laneId: 'H-3-0:F:1', s: 40, speedMps: 9, cruiseSpeedMps: 11 },
  { typeId: 'van', laneId: 'V-4-1:F:0', s: 50, speedMps: 20, cruiseSpeedMps: 24 },
  { typeId: 'sedan', laneId: 'H-1-4:R:0', s: 80, speedMps: 10, cruiseSpeedMps: 13 },
  { typeId: 'compact', laneId: 'V-0-3:F:1', s: 90, speedMps: 10, cruiseSpeedMps: 12 },
];

/** Circuit opponent AI cars. One van, driving the loop from S3. */
export const CIRCUIT_OPPONENT_SPECS: readonly OpponentSpec[] = [
  { typeId: 'van', laneId: 'S3:F:0', s: 60, speedMps: 8, colourIndex: 0 },
];
