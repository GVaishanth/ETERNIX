import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import type { Vec3 } from '../core/types';
import type { WorldDefinition } from './worlds';

/*
 * DEV-only start pose for verification runs of the looping world: ?devStart=x,z,yawRadians. The browser test uses it to
 * start a drive near a seam, so the crossing itself is driven with the real car and physics. It is ignored in production
 * builds, in every other world, and when the numbers are not finite or lie outside the base domain. It does not move the
 * car during play.
 */
export function devStartOverride(
  search: string,
  world: WorldDefinition,
  isDev: boolean,
): { position: Vec3; yawRadians: number } | null {
  if (!isDev || world.periodMeters === null) return null;
  const raw = new URLSearchParams(search).get('devStart');
  if (raw === null) return null;
  const parts = raw.split(',').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
  const [x, z, yaw] = parts as [number, number, number];
  // The dev start must be inside the base domain, [origin, origin + period), which is where the lanes are stored.
  const origin = WORLD_WRAP_CONFIG.baseOriginMeters;
  const period = world.periodMeters;
  const inside = (value: number) => value >= origin && value < origin + period;
  if (!inside(x) || !inside(z)) return null;
  return { position: { x, y: 0, z }, yawRadians: yaw };
}
