/**
 * Builds the body, greenhouse, lights, and every design detail for one car. Pure: input is the shared config and one
 * design profile, output is absolute simulation-space parts. Wheels are added by vehicleLayout.ts.
 *
 * Placement rules:
 * - Everything sits inside the shared collision hull (rear overhang, nose, and half-width from VEHICLE_CONFIG).
 *   Small tailpipe and splitter overhangs (under 0.05 m) are accepted and tested.
 * - Lights and grilles are projected onto the body surface with loftSurfaceZ, so they follow the nose curve.
 */
import type { VehicleConfig } from '../../config/vehicleConfig';
import {
  bodyBottomAt,
  bodyHalfWidthAt,
  bodyTopAt,
  type CabinStation,
  type VehicleDesignProfile,
} from '../../vehicles/designProfile';
import { buildLoft, loftSurfaceZ, type LoftStation } from './loft';
import type { VehiclePart, VehiclePartRole } from './partTypes';

/** How far a light or grille stands off the body surface, metres. */
const OUT = 0.012;
/** The belt line sits this far below the glass bottom, so the greenhouse meets the body. */
const BELT_SINK = 0.04;
/** Roof panel thickness, metres. The glass stops this far under the roof top. */
const ROOF_THICKNESS = 0.05;

export interface BodyFrame {
  readonly rearZ: number;
  readonly frontZ: number;
  readonly length: number;
  readonly halfWidth: number;
  readonly wheelRadius: number;
  readonly trackHalf: number;
  readonly wheelbase: number;
}

export function bodyFrameFromConfig(config: VehicleConfig): BodyFrame {
  const rearZ = -config.footprintRearMeters;
  return {
    rearZ,
    frontZ: rearZ + config.bodyLengthMeters,
    length: config.bodyLengthMeters,
    halfWidth: config.footprintHalfWidthMeters,
    wheelRadius: config.wheelRadiusMeters,
    trackHalf: config.trackWidthMeters / 2,
    wheelbase: config.wheelbaseMeters,
  };
}

function zAt(frame: BodyFrame, t: number): number {
  return frame.rearZ + t * frame.length;
}

/** Linear interpolation over cabin stations in t. */
function cabinValue(cabin: readonly CabinStation[], t: number, column: 1 | 2): number {
  const first = cabin[0];
  const last = cabin[cabin.length - 1];
  if (!first || !last) throw new Error('design: empty cabin');
  if (t <= first[0]) return first[column];
  if (t >= last[0]) return last[column];
  for (let i = 1; i < cabin.length; i += 1) {
    const a = cabin[i - 1];
    const b = cabin[i];
    if (!a || !b) continue;
    if (t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return a[column] + (b[column] - a[column]) * f;
    }
  }
  return last[column];
}

export function buildBodyParts(config: VehicleConfig, design: VehicleDesignProfile): VehiclePart[] {
  const frame = bodyFrameFromConfig(config);
  const parts: VehiclePart[] = [];
  const add = (part: VehiclePart): void => {
    parts.push(part);
  };

  // ---- Body loft and surface helpers --------------------------------------------------------------------------
  const bodyStations: LoftStation[] = design.body.map(([t, bottom, top, halfWidth]) => ({
    z: zAt(frame, t),
    bottom,
    top,
    halfWidth,
  }));
  add({ kind: 'loft', name: 'VehicleBody', role: 'body', mesh: buildLoft(bodyStations, design.bodySection) });

  const frontSurface = (x: number, y: number): number =>
    loftSurfaceZ(bodyStations, design.bodySection, x, y, 'max') ?? frame.frontZ - 0.02;
  const rearSurface = (x: number, y: number): number =>
    loftSurfaceZ(bodyStations, design.bodySection, x, y, 'min') ?? frame.rearZ + 0.02;
  const hwAt = (t: number): number => bodyHalfWidthAt(design.body, t);
  const bottomAt = (t: number): number => bodyBottomAt(design.body, t);
  const topAt = (t: number): number => bodyTopAt(design.body, t);
  const sides = [-1, 1] as const;
  const sideName = (sign: number): string => (sign < 0 ? 'Left' : 'Right');

  // ---- Greenhouse --------------------------------------------------------------------------------------------
  const glassTop = design.roof === 'glass' ? 0 : ROOF_THICKNESS;
  // An open car has no closed greenhouse: a low windscreen over the front of the cockpit, and roll hoops at its ends.
  const open = design.roof === 'open';
  const glassStations: LoftStation[] = design.cabin.map(([t, top, halfWidth]) => ({
    z: zAt(frame, t),
    bottom: topAt(t) - BELT_SINK,
    top: open ? Math.min(top, topAt(t) + 0.32) : top - glassTop,
    halfWidth: halfWidth * 0.985,
  }));
  add({ kind: 'loft', name: 'Greenhouse', role: 'glass', mesh: buildLoft(open ? glassStations.slice(0, 2) : glassStations, design.cabinSection) });
  if (open || design.rollHoops) {
    const first = design.cabin[0];
    const last = design.cabin[design.cabin.length - 1];
    for (const [label, station] of [['Front', first], ['Rear', last]] as const) {
      if (!station) continue;
      const [t, top, halfWidth] = station;
      const base = topAt(t);
      const height = top - base;
      for (const sign of sides) {
        add({
          kind: 'cylinder',
          name: `RollHoop${label}${sideName(sign)}`,
          role: 'metal',
          center: { x: sign * (halfWidth * 0.9), y: base + height / 2, z: zAt(frame, t) },
          radius: 0.03,
          length: height,
          axis: 'y',
        });
      }
    }
  }
  if (design.roof !== 'glass' && !open) {
    const roofStations: LoftStation[] = design.cabin.map(([t, top, halfWidth]) => ({
      z: zAt(frame, t),
      bottom: top - ROOF_THICKNESS,
      top: top + 0.012,
      halfWidth: halfWidth * 0.99,
    }));
    add({
      kind: 'loft',
      name: 'Roof',
      role: design.roof === 'paint' ? 'body' : 'trim',
      mesh: buildLoft(roofStations, design.cabinSection),
    });
  }

  // ---- Lights ------------------------------------------------------------------------------------------------
  const frontT = 0.92;
  const frontMidY = (bottomAt(frontT) + topAt(frontT)) / 2;
  const frontHalf = hwAt(frontT);
  add({ kind: 'box', name: 'IndicatorFrontLeft', role: 'indicator', center: { x: -(frontHalf - 0.08), y: bottomAt(frontT) + 0.1, z: frontSurface(-(frontHalf - 0.08), bottomAt(frontT) + 0.1) + OUT }, size: { x: 0.06, y: 0.05, z: 0.02 }, rotationY: 0 });
  add({ kind: 'box', name: 'IndicatorFrontRight', role: 'indicator', center: { x: frontHalf - 0.08, y: bottomAt(frontT) + 0.1, z: frontSurface(frontHalf - 0.08, bottomAt(frontT) + 0.1) + OUT }, size: { x: 0.06, y: 0.05, z: 0.02 }, rotationY: 0 });

  switch (design.headlights) {
    case 'round':
    case 'quad': {
      const inset = frontHalf - 0.2;
      const radius = design.headlights === 'round' ? 0.075 : 0.04;
      const rows = design.headlights === 'round' ? [0] : [-0.05, 0.05];
      for (const sign of sides) {
        for (const dy of rows) {
          const x = sign * inset;
          const y = frontMidY + dy;
          add({ kind: 'cylinder', name: `Headlight${sideName(sign)}${dy < 0 ? 'Low' : dy > 0 ? 'High' : ''}`, role: 'headlight', center: { x, y, z: frontSurface(x, y) + OUT }, radius, length: 0.03, axis: 'z' });
        }
      }
      break;
    }
    case 'strip':
      for (const sign of sides) {
        const x = sign * 0.5;
        add({ kind: 'box', name: `Headlight${sideName(sign)}`, role: 'headlight', center: { x, y: frontMidY, z: frontSurface(x, frontMidY) + OUT }, size: { x: 0.42, y: 0.045, z: 0.02 }, rotationY: 0 });
      }
      break;
    case 'angular':
      for (const sign of sides) {
        const x = sign * 0.55;
        add({ kind: 'box', name: `Headlight${sideName(sign)}`, role: 'headlight', center: { x, y: frontMidY, z: frontSurface(x, frontMidY) + OUT }, size: { x: 0.34, y: 0.09, z: 0.03 }, rotationY: sign * -0.3 });
      }
      break;
    case 'bar':
      add({ kind: 'box', name: 'HeadlightBar', role: 'headlight', center: { x: 0, y: frontMidY, z: frontSurface(0, frontMidY) + OUT }, size: { x: 1.5, y: 0.05, z: 0.02 }, rotationY: 0 });
      break;
  }

  // ---- Tail lights -------------------------------------------------------------------------------------------
  const rearT = 0.08;
  const rearMidY = (bottomAt(rearT) + topAt(rearT)) / 2;
  const rearHalf = hwAt(rearT);
  /** A tail light: a round lamp when radius is given, otherwise a box of the given size. */
  const tail = (name: string, x: number, y: number, size: { x: number; y: number; z: number } | null, radius?: number): void => {
    const z = rearSurface(x, y) - OUT;
    if (size === null) {
      add({ kind: 'cylinder', name, role: 'taillight', center: { x, y, z }, radius: radius ?? 0.05, length: 0.03, axis: 'z' });
    } else {
      add({ kind: 'box', name, role: 'taillight', center: { x, y, z }, size, rotationY: 0 });
    }
  };
  switch (design.taillights) {
    case 'round':
      for (const sign of sides) tail(`Taillight${sideName(sign)}`, sign * (rearHalf - 0.2), rearMidY, null, 0.05);
      break;
    case 'strip':
      for (const sign of sides) tail(`Taillight${sideName(sign)}`, sign * 0.5, rearMidY, { x: 0.38, y: 0.05, z: 0.02 });
      break;
    case 'bar':
      tail('TaillightBar', 0, rearMidY, { x: 1.4, y: 0.06, z: 0.02 });
      break;
    case 'split':
      for (const sign of sides) tail(`Taillight${sideName(sign)}`, sign * 0.6, rearMidY, { x: 0.3, y: 0.05, z: 0.02 });
      break;
  }
  for (const sign of sides) {
    const x = sign * (rearHalf - 0.08);
    const y = bottomAt(rearT) + 0.1;
    add({ kind: 'box', name: `IndicatorRear${sideName(sign)}`, role: 'indicator', center: { x, y, z: rearSurface(x, y) - OUT }, size: { x: 0.06, y: 0.05, z: 0.02 }, rotationY: 0 });
  }

  // ---- Front fascia ------------------------------------------------------------------------------------------
  const gy = bottomAt(0.93) + 0.35 * (topAt(0.93) - bottomAt(0.93));
  const frontBox = (name: string, role: VehiclePartRole, x: number, y: number, size: { x: number; y: number; z: number }): void => {
    add({ kind: 'box', name, role, center: { x, y, z: frontSurface(x, y) + OUT }, size, rotationY: 0 });
  };
  if (design.grille !== 'none') {
    const size = design.grille === 'slim' ? { x: 0.8, y: 0.06, z: 0.02 } : design.grille === 'wide' ? { x: 1.15, y: 0.12, z: 0.02 } : { x: 0.95, y: 0.2, z: 0.02 };
    frontBox('Grille', 'trim', 0, gy, size);
    if (design.grille === 'mesh') {
      for (const dy of [-0.06, 0, 0.06]) frontBox(`GrilleSlat${dy}`, 'accent', 0, gy + dy, { x: 0.95, y: 0.012, z: 0.022 });
    }
  }
  if (design.intakes === 'front') {
    for (const sign of sides) frontBox(`IntakeFront${sideName(sign)}`, 'trim', sign * 0.42, bottomAt(0.93) + 0.1, { x: 0.3, y: 0.12, z: 0.03 });
  }
  if (design.intakes === 'side') {
    for (const sign of sides) {
      const t = 0.35;
      add({ kind: 'box', name: `IntakeSide${sideName(sign)}`, role: 'trim', center: { x: sign * (hwAt(t) + 0.005), y: bottomAt(t) + 0.25, z: zAt(frame, t) }, size: { x: 0.03, y: 0.2, z: 0.36 }, rotationY: 0 });
    }
  }
  if (design.splitter) {
    const y = bottomAt(0.97) + 0.02;
    add({ kind: 'box', name: 'Splitter', role: 'trim', center: { x: 0, y, z: frontSurface(0, y) + 0.02 }, size: { x: 1.66, y: 0.03, z: 0.14 }, rotationY: 0 });
  }

  // ---- Sides -------------------------------------------------------------------------------------------------
  if (design.cladding) {
    for (const sign of sides) {
      add({ kind: 'box', name: `Cladding${sideName(sign)}`, role: 'trim', center: { x: sign * (hwAt(0.5) + 0.008), y: bottomAt(0.5) + 0.05, z: zAt(frame, 0.5) }, size: { x: 0.02, y: 0.1, z: 0.8 * frame.length }, rotationY: 0 });
    }
  }
  if (design.skirts) {
    for (const sign of sides) {
      add({ kind: 'box', name: `Skirt${sideName(sign)}`, role: 'trim', center: { x: sign * (hwAt(0.5) + 0.005), y: bottomAt(0.5) + 0.02, z: zAt(frame, 0.5) }, size: { x: 0.03, y: 0.06, z: 0.7 * frame.length }, rotationY: 0 });
    }
  }
  if (design.flares) {
    const axles: Array<{ label: string; z: number }> = [
      { label: 'Rear', z: 0 },
      { label: 'Front', z: frame.wheelbase },
    ];
    for (const axle of axles) {
      const t = (axle.z - frame.rearZ) / frame.length;
      for (const sign of sides) {
        add({
          kind: 'arch',
          name: `Flare${axle.label}${sideName(sign)}`,
          role: 'body',
          center: { x: sign * (hwAt(t) + 0.01), y: frame.wheelRadius, z: axle.z },
          radius: frame.wheelRadius + 0.05,
          tube: 0.03,
        });
      }
    }
  }
  {
    const tm = design.cabin[design.cabin.length - 1]?.[0] ?? 0.7;
    const cabinHalf = cabinValue(design.cabin, tm - 0.04, 2);
    const y = topAt(tm - 0.04) + 0.02;
    for (const sign of sides) {
      const x = sign * (cabinHalf + 0.07);
      const z = zAt(frame, tm - 0.04);
      if (design.mirrors === 'round') {
        add({ kind: 'cylinder', name: `Mirror${sideName(sign)}`, role: 'body', center: { x, y, z }, radius: 0.045, length: 0.1, axis: 'x' });
      } else {
        add({ kind: 'box', name: `Mirror${sideName(sign)}`, role: 'body', center: { x, y, z }, size: { x: 0.1, y: 0.07, z: 0.12 }, rotationY: 0 });
      }
    }
  }

  // ---- Rear --------------------------------------------------------------------------------------------------
  const deckY = topAt(0.04);
  if (design.spoiler !== 'none') {
    const rz = frame.rearZ;
    const deckMid = deckY;
    switch (design.spoiler) {
      case 'lip':
        add({ kind: 'box', name: 'SpoilerLip', role: 'body', center: { x: 0, y: deckMid + 0.01, z: rz + 0.1 }, size: { x: 1.5, y: 0.025, z: 0.14 }, rotationY: 0 });
        break;
      case 'ducktail':
        add({ kind: 'box', name: 'Ducktail', role: 'body', center: { x: 0, y: deckMid + 0.03, z: rz + 0.16 }, size: { x: 1.35, y: 0.1, z: 0.3 }, rotationY: 0 });
        break;
      case 'wing':
        for (const sign of sides) add({ kind: 'cylinder', name: `WingPost${sideName(sign)}`, role: 'trim', center: { x: sign * 0.5, y: deckMid + 0.1, z: rz + 0.22 }, radius: 0.022, length: 0.2, axis: 'y' });
        add({ kind: 'box', name: 'Wing', role: 'body', center: { x: 0, y: deckMid + 0.22, z: rz + 0.22 }, size: { x: 1.5, y: 0.03, z: 0.3 }, rotationY: 0 });
        break;
      case 'gt':
        for (const sign of sides) {
          add({ kind: 'cylinder', name: `WingPost${sideName(sign)}`, role: 'trim', center: { x: sign * 0.6, y: deckMid + 0.15, z: rz + 0.26 }, radius: 0.025, length: 0.3, axis: 'y' });
          add({ kind: 'box', name: `WingEndplate${sideName(sign)}`, role: 'trim', center: { x: sign * 0.86, y: deckMid + 0.25, z: rz + 0.26 }, size: { x: 0.02, y: 0.24, z: 0.4 }, rotationY: 0 });
        }
        add({ kind: 'box', name: 'Wing', role: 'body', center: { x: 0, y: deckMid + 0.33, z: rz + 0.26 }, size: { x: 1.72, y: 0.04, z: 0.4 }, rotationY: 0 });
        break;
    }
  }
  if (design.diffuser) {
    const rz = frame.rearZ;
    const y = bottomAt(0.04) + 0.02;
    add({ kind: 'box', name: 'Diffuser', role: 'trim', center: { x: 0, y, z: rz + 0.1 }, size: { x: 1.5, y: 0.1, z: 0.2 }, rotationY: 0 });
    for (const x of [-0.5, 0, 0.5]) add({ kind: 'box', name: `DiffuserFin${x}`, role: 'trim', center: { x, y, z: rz + 0.1 }, size: { x: 0.012, y: 0.09, z: 0.18 }, rotationY: 0 });
  }
  if (design.exhaust !== 'none') {
    const y = bottomAt(0.04) + 0.12;
    const xs = design.exhaust === 'single' ? [0.36] : design.exhaust === 'dual' ? [-0.3, 0.3] : [-0.25, -0.38, 0.25, 0.38];
    xs.forEach((x, index) => {
      add({ kind: 'cylinder', name: `Exhaust${index}`, role: 'metal', center: { x, y, z: frame.rearZ }, radius: 0.035, length: 0.08, axis: 'z' });
    });
  }

  // ---- Roof and deck --------------------------------------------------------------------------------------------
  if (design.roofScoop) {
    const t = 0.55;
    add({ kind: 'box', name: 'RoofScoop', role: 'trim', center: { x: 0, y: cabinValue(design.cabin, t, 1) + 0.03, z: zAt(frame, t) }, size: { x: 0.36, y: 0.1, z: 0.42 }, rotationY: 0 });
  }
  if (design.hoodVents) {
    for (const t of [0.62, 0.68, 0.74]) {
      add({ kind: 'box', name: `HoodVent${t}`, role: 'trim', center: { x: 0, y: topAt(t) + 0.004, z: zAt(frame, t) }, size: { x: 0.34, y: 0.012, z: 0.04 }, rotationY: 0 });
    }
  }
  if (design.stripes) {
    for (const t of [0.3, 0.45, 0.6, 0.75]) {
      for (const sign of sides) {
        add({ kind: 'box', name: `Stripe${sideName(sign)}${t}`, role: 'accent', center: { x: sign * 0.08, y: cabinValue(design.cabin, t, 1) + 0.014, z: zAt(frame, t) }, size: { x: 0.14, y: 0.006, z: 0.17 }, rotationY: 0 });
      }
    }
  }

  // ---- Utility and off-road parts ----------------------------------------------------------------------------
  if (design.roofRack) {
    const top = cabinValue(design.cabin, 0.55, 1) + 0.02;
    const half = cabinValue(design.cabin, 0.55, 2) * 0.82;
    for (const sign of sides) {
      add({ kind: 'box', name: `RoofRail${sideName(sign)}`, role: 'trim', center: { x: sign * half, y: top + 0.03, z: zAt(frame, 0.5) }, size: { x: 0.05, y: 0.05, z: 1.7 }, rotationY: 0 });
    }
    for (const t of [0.3, 0.7]) {
      add({ kind: 'box', name: `RoofBar${t}`, role: 'trim', center: { x: 0, y: top + 0.03, z: zAt(frame, t) }, size: { x: half * 2, y: 0.045, z: 0.05 }, rotationY: 0 });
    }
  }
  if (design.spareWheel) {
    add({ kind: 'cylinder', name: 'SpareWheel', role: 'wheel', center: { x: 0, y: 0.7, z: frame.rearZ - 0.1 }, radius: 0.31, length: 0.16, axis: 'z' });
  }
  if (design.bed) {
    // The body is lowered over the bed (see the design), so the floor sits at the body top there, and the walls and
    // tailgate stand above it.
    const bedFloorY = topAt(0.2);
    const bedLength = zAt(frame, 0.4) - frame.rearZ;
    const bedWidth = hwAt(0.2) * 2 - 0.12;
    add({ kind: 'box', name: 'BedFloor', role: 'trim', center: { x: 0, y: bedFloorY + 0.01, z: frame.rearZ + bedLength / 2 }, size: { x: bedWidth, y: 0.02, z: bedLength }, rotationY: 0 });
    for (const sign of sides) {
      add({ kind: 'box', name: `BedWall${sideName(sign)}`, role: 'body', center: { x: sign * (hwAt(0.2) - 0.03), y: bedFloorY + 0.2, z: frame.rearZ + bedLength / 2 }, size: { x: 0.06, y: 0.4, z: bedLength }, rotationY: 0 });
    }
    add({ kind: 'box', name: 'Tailgate', role: 'body', center: { x: 0, y: bedFloorY + 0.2, z: frame.rearZ + 0.03 }, size: { x: bedWidth, y: 0.4, z: 0.06 }, rotationY: 0 });
  }
  if (design.skidPlate) {
    const y = bottomAt(0.9) - 0.03;
    add({ kind: 'box', name: 'SkidPlate', role: 'trim', center: { x: 0, y, z: frontSurface(0, y) - 0.25 }, size: { x: 0.9, y: 0.05, z: 0.9 }, rotationY: 0 });
  }

  // ---- Open-wheel parts: exposed wheels on visible suspension, with sidepods and a front wing ------------------
  if (design.openWheels) {
    const hub = 0.8;
    const wheelY = frame.wheelRadius;
    for (const axle of [0, frame.wheelbase] as const) {
      for (const sign of sides) {
        const inner = 0.25;
        const outer = hub - 0.1;
        const centreX = sign * (inner + outer) / 2;
        add({ kind: 'box', name: `WishboneUpper${sideName(sign)}${axle}`, role: 'metal', center: { x: centreX, y: wheelY + 0.14, z: axle }, size: { x: outer - inner, y: 0.025, z: 0.05 }, rotationY: 0 });
        add({ kind: 'box', name: `WishboneLower${sideName(sign)}${axle}`, role: 'metal', center: { x: centreX, y: wheelY - 0.1, z: axle }, size: { x: outer - inner, y: 0.025, z: 0.05 }, rotationY: 0 });
        add({ kind: 'box', name: `Upright${sideName(sign)}${axle}`, role: 'metal', center: { x: sign * hub, y: wheelY, z: axle }, size: { x: 0.04, y: 0.36, z: 0.06 }, rotationY: 0 });
      }
    }
    for (const sign of sides) {
      add({ kind: 'box', name: `Sidepod${sideName(sign)}`, role: 'body', center: { x: sign * (hwAt(0.5) + 0.12), y: bottomAt(0.5) + 0.14, z: zAt(frame, 0.5) }, size: { x: 0.36, y: 0.22, z: 1.4 }, rotationY: 0 });
    }
    add({ kind: 'box', name: 'FrontWing', role: 'body', center: { x: 0, y: 0.2, z: frame.frontZ + 0.05 }, size: { x: 1.8, y: 0.03, z: 0.2 }, rotationY: 0 });
    for (const sign of sides) {
      add({ kind: 'box', name: `FrontWingEndplate${sideName(sign)}`, role: 'trim', center: { x: sign * 0.9, y: 0.25, z: frame.frontZ + 0.05 }, size: { x: 0.02, y: 0.22, z: 0.26 }, rotationY: 0 });
    }
  }

  return parts;
}
