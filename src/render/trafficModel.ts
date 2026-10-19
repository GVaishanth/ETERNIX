import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
} from 'three';
import { trafficDimensions, TRAFFIC_ROSTER, type TrafficTypeId, type TrafficVehicleType } from '../traffic/trafficTypes';
import { HEADLIGHT_EMISSIVE, headlightEmissive, registerNightLight } from './nightLights';

/*
 * Procedural traffic models (Part 4). Built from boxes and cylinders. Geometry is shared per type, and materials are
 * shared per colour and finish. Nothing is loaded from a file, and no model is created per frame.
 *
 * Local frame, matching the player's model: origin at the rear-axle centre on the ground, nose +Z, right +X.
 * SimRoot applies the render-space mirror, so this file uses simulation axes only.
 */

const CHASSIS_BOTTOM_METERS = 0.22;
const WHEEL_WIDTH_METERS = 0.22;
const LAMP_HEIGHT_METERS = 0.12;
const LAMP_WIDTH_METERS = 0.3;
const LAMP_DEPTH_METERS = 0.02;
const TRIM_DEPTH_METERS = 0.08;
const TRIM_HEIGHT_METERS = 0.2;
const ROOF_THICKNESS_METERS = 0.06;
const GLASS_COLOUR = '#26323c';
const TYRE_COLOUR = '#17181a';
const TRIM_COLOUR = '#2a2c30';
const HEAD_LAMP_COLOUR = '#fff4d6';
const TAIL_LAMP_COLOUR = '#b3121c';

interface TypeGeometry {
  lowerBody: BufferGeometry;
  cabin: BufferGeometry;
  roof: BufferGeometry;
  trimRear: BufferGeometry;
  trimNose: BufferGeometry;
  wheel: BufferGeometry;
  lamp: BufferGeometry;
}

const GEOMETRY_KEYS: ReadonlyArray<keyof TypeGeometry> = ['lowerBody', 'cabin', 'roof', 'trimRear', 'trimNose', 'wheel', 'lamp'];

export interface TrafficModelFactory {
  /** Builds a new Group that shares geometry and materials with every other model of the same type and colour. */
  build(typeId: TrafficTypeId, colourIndex: number): Group;
  /** Disposes every shared geometry and material. Built groups must already be removed from the scene. */
  dispose(): void;
  /** Number of GPU geometries and materials created so far. Diagnostics and tests only. */
  readonly resourceCounts: { geometries: number; materials: number };
}

function requireType(typeId: TrafficTypeId): TrafficVehicleType {
  const type = TRAFFIC_ROSTER.find((candidate) => candidate.id === typeId);
  if (!type) throw new Error(`Unknown traffic type: ${typeId}`);
  return type;
}

/** A box spanning [z0, z1] along the length, centred on the given x and y. */
function boxGeometry(width: number, height: number, z0: number, z1: number, centreX: number, centreY: number): BufferGeometry {
  const geometry = new BoxGeometry(width, height, z1 - z0);
  geometry.translate(centreX, centreY, (z0 + z1) / 2);
  return geometry;
}

/** Builds the shared geometry for one type. Every dimension comes from the type, so the model matches its collision box. */
function buildTypeGeometry(type: TrafficVehicleType): TypeGeometry {
  const dims = trafficDimensions(type);
  const bodyRear = -type.rearOverhangMeters;
  const bodyNose = dims.noseMeters;
  const bodyLength = bodyNose - bodyRear;
  const model = type.model;

  const lowerTop = model.lowerBodyTopMeters;
  const lowerBody = boxGeometry(
    type.widthMeters,
    lowerTop - CHASSIS_BOTTOM_METERS,
    bodyRear,
    bodyNose,
    0,
    (lowerTop + CHASSIS_BOTTOM_METERS) / 2,
  );

  // Cabin: set back from the body's rear edge, with a length fraction of the body. The glass is the cabin box,
  // and the roof is a thin paint slab on top.
  const cabinRear = bodyRear + model.cabinSetbackMeters;
  const cabinFront = Math.min(cabinRear + bodyLength * model.cabinLengthFraction, bodyNose - 0.15);
  const cabinWidth = type.widthMeters * model.cabinWidthFraction;
  const cabinHeight = type.heightMeters - lowerTop - ROOF_THICKNESS_METERS;
  const cabin = boxGeometry(cabinWidth, cabinHeight, cabinRear, cabinFront, 0, lowerTop + cabinHeight / 2);
  const roof = boxGeometry(
    cabinWidth * 1.02,
    ROOF_THICKNESS_METERS,
    cabinRear - 0.02,
    cabinFront + 0.02,
    0,
    type.heightMeters - ROOF_THICKNESS_METERS / 2,
  );

  // Bumper trim at the rear and the nose, dark, so both ends read clearly.
  const trimY = CHASSIS_BOTTOM_METERS + TRIM_HEIGHT_METERS / 2 + 0.02;
  const trimWidth = type.widthMeters * 0.98;
  const trimRear = boxGeometry(trimWidth, TRIM_HEIGHT_METERS, bodyRear, bodyRear + TRIM_DEPTH_METERS, 0, trimY);
  const trimNose = boxGeometry(trimWidth, TRIM_HEIGHT_METERS, bodyNose - TRIM_DEPTH_METERS, bodyNose, 0, trimY);

  // Wheels are cylinders with the axle along X, so they roll forward along +Z.
  const wheel = new CylinderGeometry(model.wheelRadiusMeters, model.wheelRadiusMeters, WHEEL_WIDTH_METERS, 16);
  wheel.rotateZ(Math.PI / 2);

  const lamp = new BoxGeometry(LAMP_WIDTH_METERS, LAMP_HEIGHT_METERS, LAMP_DEPTH_METERS);

  return { lowerBody, cabin, roof, trimRear, trimNose, wheel, lamp };
}

export function createTrafficModelFactory(): TrafficModelFactory {
  const geometries = new Map<TrafficTypeId, TypeGeometry>();
  const paints = new Map<string, MeshStandardMaterial>();
  const glass = new MeshStandardMaterial({ color: GLASS_COLOUR, roughness: 0.25, metalness: 0.1 });
  const tyre = new MeshStandardMaterial({ color: TYRE_COLOUR, roughness: 0.9 });
  const trim = new MeshStandardMaterial({ color: TRIM_COLOUR, roughness: 0.7 });
  const head = new MeshStandardMaterial({ color: HEAD_LAMP_COLOUR, emissive: HEAD_LAMP_COLOUR, emissiveIntensity: HEADLIGHT_EMISSIVE.day });
  const unregisterHeadlights = registerNightLight((level) => {
    head.emissiveIntensity = headlightEmissive(level);
  });
  const tail = new MeshStandardMaterial({ color: TAIL_LAMP_COLOUR, emissive: TAIL_LAMP_COLOUR, emissiveIntensity: 0.4 });

  function geometryFor(type: TrafficVehicleType): TypeGeometry {
    const cached = geometries.get(type.id);
    if (cached) return cached;
    const built = buildTypeGeometry(type);
    geometries.set(type.id, built);
    return built;
  }

  function paintFor(colour: string): MeshStandardMaterial {
    const cached = paints.get(colour);
    if (cached) return cached;
    const created = new MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.2 });
    paints.set(colour, created);
    return created;
  }

  return {
    build(typeId, colourIndex) {
      const type = requireType(typeId);
      const geo = geometryFor(type);
      const colours = type.model.bodyColours;
      const colour = colours[((colourIndex % colours.length) + colours.length) % colours.length] ?? '#888888';
      const paint = paintFor(colour);
      const halfTrack = type.widthMeters / 2 - WHEEL_WIDTH_METERS / 2 - 0.02;

      const group = new Group();
      group.name = `Traffic:${type.id}`;
      group.userData.typeId = type.id;

      const add = (geometry: BufferGeometry, material: MeshStandardMaterial, name: string, x = 0, y = 0, z = 0): void => {
        const mesh = new Mesh(geometry, material);
        mesh.name = name;
        mesh.position.set(x, y, z);
        group.add(mesh);
      };

      add(geo.lowerBody, paint, 'Body');
      add(geo.cabin, glass, 'Cabin');
      add(geo.roof, paint, 'Roof');
      add(geo.trimRear, trim, 'TrimRear');
      add(geo.trimNose, trim, 'TrimNose');

      // Wheels on both axles, both sides. The rear axle is at z=0, and the front axle is at the wheelbase.
      for (const [axle, z] of [['Rear', 0], ['Front', type.wheelbaseMeters]] as const) {
        add(geo.wheel, tyre, `WheelL${axle}`, -halfTrack, type.model.wheelRadiusMeters, z);
        add(geo.wheel, tyre, `WheelR${axle}`, halfTrack, type.model.wheelRadiusMeters, z);
      }

      // Lamps: head lamps at the nose, and tail lamps at the rear.
      const dims = trafficDimensions(type);
      const lampY = type.model.lowerBodyTopMeters - 0.2;
      const lampX = type.widthMeters * 0.32;
      // Lamps are flush: their outer faces sit on the body faces, so the bounds match the collision box exactly.
      const lampInset = LAMP_DEPTH_METERS / 2;
      add(geo.lamp, head, 'HeadLampL', -lampX, lampY, dims.noseMeters - lampInset);
      add(geo.lamp, head, 'HeadLampR', lampX, lampY, dims.noseMeters - lampInset);
      add(geo.lamp, tail, 'TailLampL', -lampX, lampY, -dims.rearMeters + lampInset);
      add(geo.lamp, tail, 'TailLampR', lampX, lampY, -dims.rearMeters + lampInset);

      return group;
    },
    dispose() {
      for (const geo of geometries.values()) {
        for (const key of GEOMETRY_KEYS) geo[key].dispose();
      }
      geometries.clear();
      for (const material of paints.values()) material.dispose();
      paints.clear();
      glass.dispose();
      tyre.dispose();
      trim.dispose();
      unregisterHeadlights();
      head.dispose();
      tail.dispose();
    },
    get resourceCounts() {
      return {
        geometries: geometries.size * GEOMETRY_KEYS.length,
        materials: paints.size + 5,
      };
    },
  };
}
