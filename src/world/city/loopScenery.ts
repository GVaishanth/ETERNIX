import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import { wrapToBase } from '../wrap/worldWrap';
import { FLAT_GROUND, type HillsideGround } from '../hillsideGround';
import { buildCityScenery, type CityScenery } from './cityScenery';

/*
 * The looping city's scenery. Built from the loop's own node range, so the far row and column of the finite layout (node
 * index 10) are never generated: they are the same places as the near row and column (node index -4). Positions that the
 * generator places just outside the base domain (street furniture on the -4 row sits about 12 m beyond -1200) are then
 * wrapped into the base domain [origin, origin + period), so every object has one canonical chunk.
 */

/** Lowest and highest node index of the loop's lattice, inclusive. */
export const LOOP_NODE_RANGE = {
  min: WORLD_WRAP_CONFIG.firstNodeIndex,
  max: WORLD_WRAP_CONFIG.firstNodeIndex + WORLD_WRAP_CONFIG.periodNodes - 1,
} as const;

export function buildLoopScenery(periodMeters: number, ground: HillsideGround = FLAT_GROUND): CityScenery {
  return wrapSceneryToBase(buildCityScenery(LOOP_NODE_RANGE, ground), periodMeters);
}

/** Moves each object by a whole number of periods so that its anchor lies in the base domain [origin, origin + period). */
export function wrapSceneryToBase(scenery: CityScenery, periodMeters: number): CityScenery {
  const wrap = (value: number): number => wrapToBase(value, periodMeters);
  const shift = (value: number): number => wrap(value) - value;
  return {
    buildings: scenery.buildings.map((building) => {
      const dx = shift((building.footprint.x0 + building.footprint.x1) / 2);
      const dz = shift((building.footprint.z0 + building.footprint.z1) / 2);
      if (dx === 0 && dz === 0) return building;
      const { footprint } = building;
      return { ...building, footprint: { x0: footprint.x0 + dx, x1: footprint.x1 + dx, z0: footprint.z0 + dz, z1: footprint.z1 + dz } };
    }),
    landmarkParts: scenery.landmarkParts.map((part) => {
      const dx = shift(part.x);
      const dz = shift(part.z);
      return dx === 0 && dz === 0 ? part : { ...part, x: part.x + dx, z: part.z + dz };
    }),
    trees: scenery.trees.map((tree) => ({ ...tree, x: wrap(tree.x), z: wrap(tree.z) })),
    lamps: scenery.lamps.map((lamp) => ({ ...lamp, x: wrap(lamp.x), z: wrap(lamp.z) })),
    signs: scenery.signs.map((sign) => ({ ...sign, x: wrap(sign.x), z: wrap(sign.z) })),
    cells: scenery.cells,
  };
}
