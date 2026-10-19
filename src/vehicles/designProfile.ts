/**
 * Procedural design profile for one catalogue car. Pure data types and checks: no React, no three.js.
 *
 * A profile describes the body in normalised length units (t = 0 at the rear face, t = 1 at the nose), and heights in
 * metres above the ground. The geometry module (render/vehicleModel) turns a profile into meshes. Every profile must
 * fit inside the shared collision hull (VEHICLE_CONFIG footprint), because traffic and pursuit read that hull.
 */

export type HeadlightStyle = 'round' | 'strip' | 'angular' | 'quad' | 'bar';
export type TaillightStyle = 'round' | 'strip' | 'bar' | 'split';
export type GrilleStyle = 'none' | 'slim' | 'wide' | 'mesh';
export type IntakeStyle = 'none' | 'side' | 'front';
export type SpoilerStyle = 'none' | 'lip' | 'ducktail' | 'wing' | 'gt';
export type ExhaustStyle = 'none' | 'single' | 'dual' | 'quad';
export type RoofStyle = 'paint' | 'trim' | 'glass' | 'open';
export type MirrorStyle = 'round' | 'flat';
export type RimStyle = 'five' | 'multi' | 'turbine' | 'mesh' | 'deep';

/** One body station: [t, bottom, top, halfWidth]. t runs from 0 (rear face) to 1 (nose). Heights are absolute, metres. */
export type BodyStation = readonly [number, number, number, number];
/** One cabin station: [t, top, halfWidth]. The glass bottom is the belt line taken from the body at the same t. */
export type CabinStation = readonly [number, number, number];

export interface VehicleDesignProfile {
  /** Body stations, rear to nose. t must be strictly increasing from 0 to 1. */
  readonly body: readonly BodyStation[];
  /** Superellipse exponent for the body cross-section. 2 is an ellipse. Larger is boxier. Range 2..4. */
  readonly bodySection: number;
  /** Greenhouse stations, rear to nose, t within 0.05..0.95. */
  readonly cabin: readonly CabinStation[];
  /** Superellipse exponent for the greenhouse. Range 2..4. */
  readonly cabinSection: number;
  readonly roof: RoofStyle;
  readonly headlights: HeadlightStyle;
  readonly taillights: TaillightStyle;
  readonly grille: GrilleStyle;
  readonly intakes: IntakeStyle;
  readonly splitter: boolean;
  readonly skirts: boolean;
  /** Dark lower-body band along both sides. */
  readonly cladding: boolean;
  /** Wheel-arch lips over each wheel, in body paint. */
  readonly flares: boolean;
  readonly spoiler: SpoilerStyle;
  readonly diffuser: boolean;
  readonly exhaust: ExhaustStyle;
  readonly roofScoop: boolean;
  readonly hoodVents: boolean;
  /** Racing stripes on the centre line of the body top, in the accent colour. */
  readonly stripes: boolean;
  readonly mirrors: MirrorStyle;
  readonly rim: RimStyle;
  /** Metal colour of the rim disc and spokes. */
  readonly rimColor: string;
  /** Tyre width, metres. Must keep the wheel inside the collision hull (0.19..0.25). */
  readonly tireWidth: number;
  /** Accent colour for grille slats, stripes, and rim trim. Never the paint colour. */
  readonly accent: string;
  /**
   * Per-design collision hull, metres from the rear-axle reference point. Optional: a design without it uses the shared
   * hull (VEHICLE_CONFIG). Used by deriveEffectiveSpecs, so physics, road boundaries and the visual all read the same
   * numbers. Wheel track and wheelbase stay shared.
   */
  readonly hull?: DesignHullOverride;
  /** Exposed wheels: the body is narrow at the axles, with suspension arms and wings (open-wheel cars). */
  readonly openWheels?: boolean;
  /** Roll hoops at the cockpit ends (open cars). */
  readonly rollHoops?: boolean;
  /** Open cargo bed behind the cabin (pickups). Walls and tailgate are drawn as boxes. */
  readonly bed?: boolean;
  /** Roof rack: rails and a rack frame on the roof. */
  readonly roofRack?: boolean;
  /** Spare wheel carried on the rear face. */
  readonly spareWheel?: boolean;
  /** Dark skid plate under the front of the body. */
  readonly skidPlate?: boolean;
}

/** Per-design collision hull, metres. The front and rear overhangs are measured from the rear-axle point. */
export interface DesignHullOverride {
  readonly rearMeters: number;
  readonly frontMeters: number;
  readonly halfWidthMeters: number;
}

/** Hull limits a design must respect. Taken from the shared footprint in config/vehicleConfig.ts by the caller. */
export interface DesignHull {
  readonly rearZ: number;
  readonly frontZ: number;
  readonly halfWidth: number;
  readonly roofMaxY: number;
  readonly bodyBottomY: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Checks one design. Returns the problems found, empty when valid. Pure, so the unit tests and the catalogue
 * validator can both use it. A design that fails here is never rendered.
 */
export function validateDesign(profile: VehicleDesignProfile, sharedHull: DesignHull, label: string): string[] {
  const issues: string[] = [];
  const bad = (message: string) => issues.push(`${label}: ${message}`);
  // A per-design hull replaces the shared one for every fit check. Its overhangs must stay positive and sensible.
  const hull = profile.hull ? hullWithOverride(sharedHull, profile.hull) : sharedHull;
  if (profile.hull) {
    const { rearMeters, frontMeters, halfWidthMeters } = profile.hull;
    if (!(rearMeters > 0.3 && rearMeters < 1.2)) bad(`hull rear overhang ${rearMeters} is outside 0.3..1.2 m`);
    if (!(frontMeters > 2.5 && frontMeters < 4.2)) bad(`hull front ${frontMeters} is outside 2.5..4.2 m`);
    if (!(halfWidthMeters > 0.8 && halfWidthMeters < 1.2)) bad(`hull half-width ${halfWidthMeters} is outside 0.8..1.2 m`);
  }

  const body = profile.body;
  if (body.length < 4 || body.length > 16) bad(`body needs 4..16 stations (has ${body.length})`);
  if (body[0] && body[0][0] !== 0) bad('body must start at t = 0');
  if (body[body.length - 1] && body[body.length - 1]?.[0] !== 1) bad('body must end at t = 1');
  let previousT = -1;
  for (const [t, bottom, top, halfWidth] of body) {
    if (![t, bottom, top, halfWidth].every(Number.isFinite)) bad('body station has a non-finite value');
    if (t <= previousT) bad('body stations must be strictly increasing in t');
    previousT = t;
    if (!(top > bottom)) bad(`body station at t=${t} has top <= bottom`);
    if (bottom < hull.bodyBottomY - 0.001 || bottom > 0.5) bad(`body bottom ${bottom} is outside 0.2..0.5 m`);
    if (top > hull.roofMaxY) bad(`body top ${top} is above the roof limit`);
    if (!(halfWidth > 0) || halfWidth > hull.halfWidth) bad(`body half-width ${halfWidth} is outside the hull`);
  }

  if (profile.cabin.length < 2 || profile.cabin.length > 12) bad(`cabin needs 3..12 stations (has ${profile.cabin.length})`);
  let previousCabinT = -1;
  for (const [t, top, halfWidth] of profile.cabin) {
    if (![t, top, halfWidth].every(Number.isFinite)) bad('cabin station has a non-finite value');
    if (t < 0.05 || t > 0.95) bad(`cabin station t=${t} is outside 0.05..0.95`);
    if (t <= previousCabinT) bad('cabin stations must be strictly increasing in t');
    previousCabinT = t;
    if (top > hull.roofMaxY) bad(`cabin top ${top} is above the roof limit`);
    if (!(halfWidth > 0) || halfWidth > hull.halfWidth) bad(`cabin half-width ${halfWidth} is outside the hull`);
    if (top <= bodyTopAt(body, t) + 0.1) bad(`cabin top at t=${t} is too low above the body (need 0.1 m)`);
  }

  // Clearance: a spoiler or wing sits behind the glass, so the cabin must start at t >= 0.2 (the rear of the cabin).
  const cabinRearT = profile.cabin[0]?.[0] ?? 0;
  if (profile.spoiler !== 'none' && cabinRearT < 0.2) bad(`spoiler needs the cabin to start at t >= 0.2 (starts at ${cabinRearT})`);

  if (!(profile.bodySection >= 2 && profile.bodySection <= 4)) bad('bodySection must be 2..4');
  if (!(profile.cabinSection >= 2 && profile.cabinSection <= 4)) bad('cabinSection must be 2..4');
  if (!(profile.tireWidth >= 0.19 && profile.tireWidth <= 0.25)) bad('tireWidth must be 0.19..0.25 m');
  if (!HEX.test(profile.rimColor)) bad('rimColor must be #rrggbb');
  if (!HEX.test(profile.accent)) bad('accent must be #rrggbb');
  return issues;
}

/** The shared hull with a design's override applied. The shared hull's wheel track and wheelbase are not changed here. */
export function hullWithOverride(shared: DesignHull, override: DesignHullOverride): DesignHull {
  return {
    rearZ: -override.rearMeters,
    frontZ: override.frontMeters,
    halfWidth: override.halfWidthMeters,
    roofMaxY: shared.roofMaxY,
    bodyBottomY: shared.bodyBottomY,
  };
}

/** Top of the body at a given t, linear between stations. Used for the belt line and for validation. */
export function bodyTopAt(body: readonly BodyStation[], t: number): number {
  return interpolateStation(body, t, 2);
}

/** Half-width of the body at t, linear between stations. */
export function bodyHalfWidthAt(body: readonly BodyStation[], t: number): number {
  return interpolateStation(body, t, 3);
}

/** Bottom of the body at t, linear between stations. */
export function bodyBottomAt(body: readonly BodyStation[], t: number): number {
  return interpolateStation(body, t, 1);
}

function interpolateStation(body: readonly BodyStation[], t: number, column: 1 | 2 | 3): number {
  const first = body[0];
  const last = body[body.length - 1];
  if (!first || !last) throw new Error('design: empty body');
  if (t <= first[0]) return first[column];
  if (t >= last[0]) return last[column];
  for (let i = 1; i < body.length; i += 1) {
    const a = body[i - 1];
    const b = body[i];
    if (!a || !b) break;
    if (t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return a[column] + (b[column] - a[column]) * f;
    }
  }
  return last[column];
}
