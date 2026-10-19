import { describe, expect, it } from 'vitest';
import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import { buildRoadBoundary, signedDistance, type RoadBoundary } from '../../simulation/roadBoundary';
import type { BlockInstance } from '../roadMeshData';
import { ROAD_TEST_BLOCKS } from '../roadMeshData';
import { buildCityNetwork, buildLoopCityNetwork } from './cityNetwork';
import { CITY_PROP_BLOCKS } from './cityProps';
import { buildCityScenery, landmarkReservations, type CityScenery, type Footprint } from './cityScenery';
import { buildLoopScenery } from './loopScenery';

/*
 * No city prop may stand on the drivable road. The car has no collider for scenery, so a prop on the road is driven
 * through. The check samples every point of each footprint on a 1 m grid, not only its corners, because a long
 * building can cross the road with every corner clear of it.
 */

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;

/** Smallest signed distance over the rectangle. Negative means some point of it is inside the drivable road. */
function minDistance(boundary: RoadBoundary, x0: number, x1: number, z0: number, z1: number, step: number): number {
  let min = Infinity;
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    for (let z = z0; z <= z1 + 1e-9; z += step) {
      const d = signedDistance(boundary, x, z).distance;
      if (d < min) min = d;
    }
  }
  return min;
}

function blockRect(block: BlockInstance): Footprint {
  const hx = block.widthMeters / 2;
  const hz = block.depthMeters / 2;
  return { x0: block.centre.x - hx, x1: block.centre.x + hx, z0: block.centre.z - hz, z1: block.centre.z + hz };
}

/** The footprint of every landmark part, from its centre and its extent. */
function partRects(scenery: CityScenery): Footprint[] {
  return scenery.landmarkParts.map((part) => {
    const hx = part.shape === 'box' ? part.sx / 2 : part.radius;
    const hz = part.shape === 'box' ? part.sz / 2 : part.radius;
    return { x0: part.x - hx, x1: part.x + hx, z0: part.z - hz, z1: part.z + hz };
  });
}

const worlds = [
  { label: 'finite', network: buildCityNetwork(), scenery: buildCityScenery() },
  { label: 'loop', network: buildLoopCityNetwork(), scenery: buildLoopScenery(PERIOD) },
] as const;

describe.each(worlds)('city props clear the road ($label)', ({ network, scenery }) => {
  const boundary = buildRoadBoundary(network);

  it('keeps every building footprint off the drivable road, at every grid point', () => {
    for (const building of scenery.buildings) {
      const f = building.footprint;
      const d = minDistance(boundary, f.x0, f.x1, f.z0, f.z1, 1);
      expect(d, `${building.id} (${building.kind})`).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it('keeps every landmark footprint and landmark part off the drivable road', () => {
    for (const f of landmarkReservations()) {
      expect(minDistance(boundary, f.x0, f.x1, f.z0, f.z1, 1), 'landmark footprint').toBeGreaterThanOrEqual(0);
    }
    for (const f of partRects(scenery)) {
      expect(minDistance(boundary, f.x0, f.x1, f.z0, f.z1, 0.5), 'landmark part').toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it('renders no block that overlaps the drivable road', () => {
    for (const block of CITY_PROP_BLOCKS) {
      const r = blockRect(block);
      expect(minDistance(boundary, r.x0, r.x1, r.z0, r.z1, 0.5), `block at ${block.centre.x},${block.centre.z}`).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);
});

describe('the validation fixtures', () => {
  it('four of the road-stage fixtures overlap the road, which is why the city does not render them', () => {
    // A fixture that stops overlapping the road is allowed. This pins the reason the city renders none of them.
    const boundary = buildRoadBoundary(buildCityNetwork());
    const overlapping = ROAD_TEST_BLOCKS.filter((block) => {
      const r = blockRect(block);
      return minDistance(boundary, r.x0, r.x1, r.z0, r.z1, 1) < 0;
    });
    expect(overlapping.length).toBe(4);
    expect(CITY_PROP_BLOCKS).toHaveLength(0);
  }, 60_000);
});
