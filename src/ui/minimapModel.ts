import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import type { RoadNetwork } from '../world/roadTypes';
import {
  CITY_CELL_INDEX_MAX,
  CITY_CELL_INDEX_MIN,
  CITY_LANDMARKS,
  CITY_NODE_SPACING_METERS,
  cellCentre,
  DISTRICT_LABELS,
  DISTRICT_TINTS,
  districtOfCell,
  type DistrictId,
} from '../world/city/cityLayout';
import { baseImage, imageNear } from '../world/wrap/worldWrap';

/*
 * Minimap model (Part 5, extended in the streaming phase). Built from the logical road network and the city layout, so
 * the minimap shows the same graph the vehicle and traffic use. Pure data: no canvas, no React.
 *
 * The scale is fixed at MINIMAP_PIXELS_PER_METER. The view is 220 px square and follows the player: the static layer
 * covers the whole populated map once, and the view is centred on the player each frame. North is up (+Z).
 */

export const MINIMAP_SIZE_PX = 220;
/** Fixed scale, pixels per metre. 220 px at this scale shows about 880 m around the player. */
export const MINIMAP_PIXELS_PER_METER = 0.25;

export interface MinimapPoint {
  x: number;
  z: number;
}

export interface MinimapStreet {
  id: string;
  points: MinimapPoint[];
  widthMeters: number;
  highway: boolean;
}

export interface MinimapJunction {
  id: string;
  centre: MinimapPoint;
  halfSizeMeters: number;
}

export interface MinimapDistrict {
  id: string;
  district: DistrictId;
  label: string;
  tint: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface MinimapLandmark {
  id: string;
  label: string;
  x: number;
  z: number;
}

export interface MinimapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MinimapModel {
  /** Extent of the road network, with a margin, in metres. The static layer covers exactly this rectangle. */
  bounds: MinimapBounds;
  centre: MinimapPoint;
  streets: MinimapStreet[];
  junctions: MinimapJunction[];
  districts: MinimapDistrict[];
  landmarks: MinimapLandmark[];
}

/** Derives the map from the logical network: segment centrelines and junction footprints, not from meshes. */
export function buildMinimapModel(network: RoadNetwork): MinimapModel {
  const streets: MinimapStreet[] = [];
  const junctions: MinimapJunction[] = [];
  for (const segment of network.segments) {
    if (segment.kind === 'junction' && segment.junction) {
      junctions.push({ id: segment.id, centre: { x: segment.junction.centre.x, z: segment.junction.centre.z }, halfSizeMeters: segment.junction.halfSizeMeters });
    } else if (segment.centerline) {
      streets.push({
        id: segment.id,
        points: segment.centerline.points.map((point) => ({ x: point.x, z: point.z })),
        widthMeters: segment.roadWidthMeters + 2 * segment.shoulderWidthMeters,
        highway: segment.roadType === 'highway',
      });
    }
  }

  const districts: MinimapDistrict[] = [];
  const half = CITY_NODE_SPACING_METERS / 2;
  for (let j = CITY_CELL_INDEX_MIN; j <= CITY_CELL_INDEX_MAX; j += 1) {
    for (let i = CITY_CELL_INDEX_MIN; i <= CITY_CELL_INDEX_MAX; i += 1) {
      const district = districtOfCell(i, j);
      const c = cellCentre(i, j);
      districts.push({
        id: `C-${i}-${j}`,
        district,
        label: DISTRICT_LABELS[district],
        tint: DISTRICT_TINTS[district],
        x0: c.x - half,
        x1: c.x + half,
        z0: c.z - half,
        z1: c.z + half,
      });
    }
  }

  const landmarks = CITY_LANDMARKS.map((landmark) => ({ id: landmark.id, label: landmark.label, x: landmark.position.x, z: landmark.position.z }));
  return { bounds: minimapBounds(network), centre: { x: 0, z: 0 }, streets, junctions, districts, landmarks };
}

/**
 * The rectangle the static layer covers. A finite network uses its extent with a margin. A looping network uses exactly
 * one period, centred on the origin, so copies of the layer abut without overlapping. A margin would overlap the next copy
 * by 2 * margin, and the two copies' backgrounds would then hide each other in that strip.
 */
export function minimapBounds(network: RoadNetwork): MinimapBounds {
  const period = network.periodMeters;
  if (period === undefined) return networkBounds(network);
  // The base domain, [origin, origin + period): the lattice's own extent, so the copies abut and the roads sit inside.
  const origin = WORLD_WRAP_CONFIG.baseOriginMeters;
  return { minX: origin, maxX: origin + period, minZ: origin, maxZ: origin + period };
}

/** Bounding rectangle of every segment point, plus a margin so verges and barriers are not clipped. */
export function networkBounds(network: RoadNetwork, marginMeters = 20): MinimapBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const segment of network.segments) {
    if (segment.kind === 'junction' && segment.junction) {
      const c = segment.junction.centre;
      const h = segment.junction.halfSizeMeters;
      minX = Math.min(minX, c.x - h);
      maxX = Math.max(maxX, c.x + h);
      minZ = Math.min(minZ, c.z - h);
      maxZ = Math.max(maxZ, c.z + h);
    } else if (segment.centerline) {
      for (const point of segment.centerline.points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return { minX: minX - marginMeters, maxX: maxX + marginMeters, minZ: minZ - marginMeters, maxZ: maxZ + marginMeters };
}

/** Pixel position in the static layer, whose top-left corner is (minX, maxZ). Not centred on anything. */
export function toStaticPixels(bounds: MinimapBounds, x: number, z: number): { px: number; py: number } {
  return {
    px: (x - bounds.minX) * MINIMAP_PIXELS_PER_METER,
    py: (bounds.maxZ - z) * MINIMAP_PIXELS_PER_METER,
  };
}

/** Size, in pixels, of the static layer for the given bounds. */
export function staticLayerSize(bounds: MinimapBounds): { width: number; height: number } {
  return {
    width: Math.ceil((bounds.maxX - bounds.minX) * MINIMAP_PIXELS_PER_METER),
    height: Math.ceil((bounds.maxZ - bounds.minZ) * MINIMAP_PIXELS_PER_METER),
  };
}

/** Converts simulation metres to minimap pixels. North (+Z) is up. */
export function toMinimapPixels(model: MinimapModel, x: number, z: number, sizePx: number = MINIMAP_SIZE_PX): { px: number; py: number } {
  return {
    px: sizePx / 2 + (x - model.centre.x) * MINIMAP_PIXELS_PER_METER,
    py: sizePx / 2 - (z - model.centre.z) * MINIMAP_PIXELS_PER_METER,
  };
}

/** Top-left pixel of one copy of the static layer inside the view. */
export interface StaticTile {
  px: number;
  py: number;
  widthPx: number;
  heightPx: number;
}

/**
 * Where each copy of the static layer goes in the view, for a view centred on (cx, cz). A finite world has one copy at
 * its own place. A loop world repeats the layer every period, so the copies at -P, 0 and +P (on each axis) are drawn. Only
 * the copies that overlap the view are returned. The centre is taken in the base domain, and the result depends only on
 * that (a centre one period away gives the same tiles), so the view does not jump at a seam.
 */
export function staticTileDraws(bounds: MinimapBounds, period: number | null, cx: number, cz: number, sizePx: number = MINIMAP_SIZE_PX): StaticTile[] {
  const baseX = baseImage(cx, period);
  const baseZ = baseImage(cz, period);
  const widthPx = (bounds.maxX - bounds.minX) * MINIMAP_PIXELS_PER_METER;
  const heightPx = (bounds.maxZ - bounds.minZ) * MINIMAP_PIXELS_PER_METER;
  const offsets = period === null ? [0] : [-1, 0, 1];
  const shift = period ?? 0;
  const out: StaticTile[] = [];
  for (const i of offsets) {
    for (const j of offsets) {
      const left = sizePx / 2 + (bounds.minX + i * shift - baseX) * MINIMAP_PIXELS_PER_METER;
      const top = sizePx / 2 - (bounds.maxZ + j * shift - baseZ) * MINIMAP_PIXELS_PER_METER;
      const overlaps = left < sizePx && left + widthPx > 0 && top < sizePx && top + heightPx > 0;
      if (overlaps) out.push({ px: left, py: top, widthPx, heightPx });
    }
  }
  return out;
}

/**
 * Pixel position in a view centred on (cx, cz), for a point given in any image. On a loop the point is drawn at the image
 * nearest the centre, so a marker across a seam is drawn beside the car. Identity when the period is null.
 */
export function wrappedViewPixels(x: number, z: number, cx: number, cz: number, period: number | null, sizePx: number = MINIMAP_SIZE_PX): { px: number; py: number } {
  return {
    px: sizePx / 2 + (imageNear(cx, x, period) - cx) * MINIMAP_PIXELS_PER_METER,
    py: sizePx / 2 - (imageNear(cz, z, period) - cz) * MINIMAP_PIXELS_PER_METER,
  };
}

