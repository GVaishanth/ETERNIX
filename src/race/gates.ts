import { forwardFromYaw, rightFromYaw } from '../core/coordinates';
import type { RaceGateDef } from './raceTypes';

/*
 * Gate crossing (Part 6). A gate is a line across the road centre, perpendicular to the lane heading, with a half width.
 * A crossing is tested on the swept segment of the centre point between two fixed steps, so a fast car cannot tunnel
 * through a gate. Only forward crossings count (the centre moves from behind the line to in front of it).
 */

/** The swept-segment crossing test. Pure: no allocation. */
export function crossesGate(
  gate: Pick<RaceGateDef, 'x' | 'z' | 'headingRadians'>,
  prevX: number,
  prevZ: number,
  curX: number,
  curZ: number,
  halfWidthMeters: number,
): boolean {
  const fx = Math.sin(gate.headingRadians);
  const fz = Math.cos(gate.headingRadians);
  const a = (prevX - gate.x) * fx + (prevZ - gate.z) * fz;
  const b = (curX - gate.x) * fx + (curZ - gate.z) * fz;
  // Forward only: the segment starts behind the line (a < 0) and ends at or in front of it (b >= 0).
  if (!(a < 0 && b >= 0)) return false;
  const t = -a / (b - a);
  const px = prevX + (curX - prevX) * t;
  const pz = prevZ + (curZ - prevZ) * t;
  // Lateral offset from the gate centre, along the gate's right-hand direction.
  const right = rightFromYaw(gate.headingRadians);
  const lateral = (px - gate.x) * right.x + (pz - gate.z) * right.z;
  return Math.abs(lateral) <= halfWidthMeters;
}

/** A gate's forward unit vector, for tests and debug drawing. */
export function gateForward(gate: Pick<RaceGateDef, 'headingRadians'>): { x: number; z: number } {
  const f = forwardFromYaw(gate.headingRadians);
  return { x: f.x, z: f.z };
}
