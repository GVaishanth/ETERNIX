import { WORLD_STREAMING_CONFIG } from '../../config/worldStreamingConfig';
import { WORLD_WRAP_CONFIG } from '../../config/worldWrapConfig';
import { nodeX } from '../city/cityLayout';
import { validateWrapGeometry, type WrapGeometry } from './worldWrap';

/**
 * The wrap geometry of the populated city, derived from the wrap config, the city layout, and the streaming chunk size.
 * It is the only place these numbers are combined. It throws if they do not form a valid torus, so a bad config fails
 * at start-up and is not silently used.
 */
export function currentWrapGeometry(): WrapGeometry {
  const chunkSizeMeters = WORLD_STREAMING_CONFIG.chunkSizeMeters;
  const periodMeters = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
  // The first lattice node sits on a chunk edge at the populated grid's west (or south) boundary.
  const chunkMin = Math.floor(nodeX(WORLD_WRAP_CONFIG.firstNodeIndex) / chunkSizeMeters);
  const geometry: WrapGeometry = { periodMeters, chunkSizeMeters, chunkMin, chunkCount: periodMeters / chunkSizeMeters };
  const issues = validateWrapGeometry(geometry);
  if (issues.length > 0) throw new Error(`Invalid world wrap geometry: ${issues.join('; ')}`);
  return geometry;
}
