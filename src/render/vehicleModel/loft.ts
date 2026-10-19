/**
 * Pure loft geometry for the procedural car body. No three.js: the output is plain arrays, so the unit tests can check
 * it without a GPU. VehicleVisual turns the arrays into a BufferGeometry.
 *
 * A loft is a closed surface built from stations along Z. Each station is a superellipse cross-section (a rounded
 * rectangle when the exponent is large). Stations are linearly interpolated, so the silhouette follows the stations.
 */

export interface LoftStation {
  /** Position along the car, metres (sim space, nose at +Z). */
  readonly z: number;
  /** Bottom of the section, metres above the ground. */
  readonly bottom: number;
  /** Top of the section, metres above the ground. */
  readonly top: number;
  /** Half the width of the section, metres. */
  readonly halfWidth: number;
}

export interface LoftMesh {
  /** Flat x, y, z triples. */
  readonly positions: number[];
  /** Triangle indices into positions. Outward-facing (counter-clockwise seen from outside). */
  readonly indices: number[];
}

/** Points per ring. Enough for a smooth edge at car scale, cheap enough to build for every car. */
export const LOFT_SEGMENTS = 20;

/** Superellipse coordinate for an angle: |cos|^(2/n) keeps the shape rounded for n near 2 and boxy for n near 4. */
function superCos(angle: number, exponent: number): number {
  const c = Math.cos(angle);
  return Math.sign(c) * Math.abs(c) ** (2 / exponent);
}

function superSin(angle: number, exponent: number): number {
  const s = Math.sin(angle);
  return Math.sign(s) * Math.abs(s) ** (2 / exponent);
}

/**
 * Builds the closed loft. Stations must be strictly increasing in z, with positive height and width. The caps are
 * flat fans. Winding is fixed by the signed volume, so the faces always point outward.
 */
export function buildLoft(stations: readonly LoftStation[], exponent: number, segments: number = LOFT_SEGMENTS): LoftMesh {
  if (stations.length < 2) throw new Error('loft: needs at least two stations');
  if (!(exponent >= 2 && exponent <= 4)) throw new Error('loft: exponent must be 2..4');
  const positions: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];

  for (const station of stations) {
    if (![station.z, station.bottom, station.top, station.halfWidth].every(Number.isFinite)) throw new Error('loft: non-finite station');
    if (!(station.top > station.bottom) || !(station.halfWidth > 0)) throw new Error('loft: station needs top > bottom and width > 0');
    ringStart.push(positions.length / 3);
    const cy = (station.top + station.bottom) / 2;
    const hh = (station.top - station.bottom) / 2;
    for (let k = 0; k < segments; k += 1) {
      const angle = (2 * Math.PI * k) / segments;
      positions.push(station.halfWidth * superCos(angle, exponent), cy + hh * superSin(angle, exponent), station.z);
    }
  }

  for (let r = 0; r + 1 < stations.length; r += 1) {
    const a = ringStart[r] ?? 0;
    const b = ringStart[r + 1] ?? 0;
    for (let k = 0; k < segments; k += 1) {
      const k1 = (k + 1) % segments;
      indices.push(a + k, a + k1, b + k1, a + k, b + k1, b + k);
    }
  }

  // Caps: a centre vertex per end, fanned to the ring.
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (!first || !last) throw new Error('loft: missing end station');
  const rearCentre = positions.length / 3;
  positions.push(0, (first.top + first.bottom) / 2, first.z);
  const frontCentre = positions.length / 3;
  positions.push(0, (last.top + last.bottom) / 2, last.z);
  const rearRing = ringStart[0] ?? 0;
  const frontRing = ringStart[ringStart.length - 1] ?? 0;
  for (let k = 0; k < segments; k += 1) {
    const k1 = (k + 1) % segments;
    indices.push(rearCentre, rearRing + k1, rearRing + k);
    indices.push(frontCentre, frontRing + k, frontRing + k1);
  }

  const mesh: LoftMesh = { positions, indices };
  if (signedVolume(mesh) < 0) {
    // Flip winding so the surface faces outward. Every triangle is reversed, which keeps the same vertices.
    for (let i = 0; i < indices.length; i += 3) {
      const tmp = indices[i + 1] ?? 0;
      indices[i + 1] = indices[i + 2] ?? 0;
      indices[i + 2] = tmp;
    }
  }
  return mesh;
}

/** Signed volume of a closed triangle mesh (positive when faces point outward). Divergence theorem. */
export function signedVolume(mesh: LoftMesh): number {
  const p = mesh.positions;
  let volume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = (mesh.indices[i] ?? 0) * 3;
    const b = (mesh.indices[i + 1] ?? 0) * 3;
    const c = (mesh.indices[i + 2] ?? 0) * 3;
    const ax = p[a] ?? 0;
    const ay = p[a + 1] ?? 0;
    const az = p[a + 2] ?? 0;
    const bx = p[b] ?? 0;
    const by = p[b + 1] ?? 0;
    const bz = p[b + 2] ?? 0;
    const cx = p[c] ?? 0;
    const cy = p[c + 1] ?? 0;
    const cz = p[c + 2] ?? 0;
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

/** Interpolated station at z, or null outside the loft. */
function stationAt(stations: readonly LoftStation[], z: number): LoftStation | null {
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (!first || !last || z < first.z || z > last.z) return null;
  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1];
    const b = stations[i];
    if (!a || !b) continue;
    if (z <= b.z) {
      const f = (z - a.z) / (b.z - a.z);
      return {
        z,
        bottom: a.bottom + (b.bottom - a.bottom) * f,
        top: a.top + (b.top - a.top) * f,
        halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * f,
      };
    }
  }
  return last;
}

/**
 * Where the loft surface lies over a point (x, y) seen from the front or the back. Scans every station span and
 * returns the nearest z that is inside the cross-section, or null when the point misses the loft. Used to put lights,
 * grilles, and aero on the curved body without letting them float or sink.
 *
 * side 'max' returns the front-most inside z (nose side), 'min' the rear-most.
 */
export function loftSurfaceZ(
  stations: readonly LoftStation[],
  exponent: number,
  x: number,
  y: number,
  side: 'max' | 'min',
): number | null {
  const first = stations[0];
  const last = stations[stations.length - 1];
  if (!first || !last) return null;
  const samples = 96;
  let best: number | null = null;
  const span = last.z - first.z;
  for (let i = 0; i <= samples; i += 1) {
    const z = first.z + (span * i) / samples;
    const s = stationAt(stations, z);
    if (!s || !(s.halfWidth > 0)) continue;
    const cy = (s.top + s.bottom) / 2;
    const hh = (s.top - s.bottom) / 2;
    const u = Math.abs(x) / s.halfWidth;
    const v = Math.abs(y - cy) / hh;
    if (u ** exponent + v ** exponent > 1) continue;
    if (best === null || (side === 'max' ? z > best : z < best)) best = z;
  }
  return best;
}
