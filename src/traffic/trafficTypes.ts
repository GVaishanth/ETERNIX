/**
 * Traffic vehicle types (Part 4). Data-driven: a type is a plain object, and the model, collision box, and driving
 * limits all derive from it. Coordinates follow the simulation convention: the reference point is the rear-axle centre
 * on the ground, the nose is +Z, and the right side is +X (see PROJECT_CONTEXT.md section 5).
 */

export type TrafficTypeId = 'compact' | 'sedan' | 'suv' | 'van';

/** The player's pose as traffic sees it. Reference point is the rear axle, meters, yaw in radians. */
export interface PlayerPose {
  x: number;
  z: number;
  yaw: number;
  speed: number;
}

/** Player footprint, from the vehicle config. Used for spawn checks and contacts against the player. */
export interface PlayerFootprint {
  rearMeters: number;
  noseMeters: number;
  halfWidthMeters: number;
}

export interface TrafficModelSpec {
  /** Top of the lower body, above the ground, meters. The cabin sits above it up to the roof (`heightMeters`). */
  lowerBodyTopMeters: number;
  /** Cabin length as a fraction of the body length. */
  cabinLengthFraction: number;
  /** Gap from the body's rear edge to the cabin's rear edge, meters. */
  cabinSetbackMeters: number;
  /** Cabin width as a fraction of the body width. */
  cabinWidthFraction: number;
  /** Body colours. The pool picks one per vehicle, and the materials are shared. */
  bodyColours: readonly string[];
  /** Wheel radius, meters. */
  wheelRadiusMeters: number;
}

export interface TrafficVehicleType {
  id: TrafficTypeId;
  label: string;
  /** Behind the rear axle to the rear of the body, meters. */
  rearOverhangMeters: number;
  /** Rear axle to front axle, meters. */
  wheelbaseMeters: number;
  /** Front axle to the nose, meters. */
  frontOverhangMeters: number;
  widthMeters: number;
  /** Body top above the ground, meters. */
  heightMeters: number;
  /** Cruise speed range chosen when a vehicle is spawned, m/s. The lane speed limit caps it. */
  cruiseSpeedMinMps: number;
  cruiseSpeedMaxMps: number;
  /** Comfortable acceleration and deceleration, m/s^2. */
  comfortAccelMps2: number;
  comfortDecelMps2: number;
  /** Standstill gap to the vehicle ahead, meters. */
  minGapMeters: number;
  /** Desired time headway, seconds. */
  headwaySeconds: number;
  /** Relative chance of spawning this type. */
  spawnWeight: number;
  model: TrafficModelSpec;
}

/** Derived dimensions used by collision and spawn checks. */
export interface TrafficDimensions {
  lengthMeters: number;
  /** Distance from the reference point to the nose. Equals the footprint front. */
  noseMeters: number;
  rearMeters: number;
  halfWidthMeters: number;
}

export function trafficDimensions(type: TrafficVehicleType): TrafficDimensions {
  const nose = type.wheelbaseMeters + type.frontOverhangMeters;
  return {
    lengthMeters: type.rearOverhangMeters + nose,
    noseMeters: nose,
    rearMeters: type.rearOverhangMeters,
    halfWidthMeters: type.widthMeters / 2,
  };
}

const COMPACT: TrafficVehicleType = {
  id: 'compact',
  label: 'Compact',
  rearOverhangMeters: 0.7,
  wheelbaseMeters: 2.4,
  frontOverhangMeters: 0.8,
  widthMeters: 1.7,
  heightMeters: 1.45,
  cruiseSpeedMinMps: 12,
  cruiseSpeedMaxMps: 16,
  comfortAccelMps2: 2.2,
  comfortDecelMps2: 2.8,
  minGapMeters: 1.5,
  headwaySeconds: 1.2,
  spawnWeight: 3,
  model: {
    lowerBodyTopMeters: 0.85,
    cabinLengthFraction: 0.55,
    cabinSetbackMeters: 0.85,
    cabinWidthFraction: 0.88,
    bodyColours: ['#e0a526', '#d9d9d9', '#c8463c'],
    wheelRadiusMeters: 0.3,
  },
};

const SEDAN: TrafficVehicleType = {
  id: 'sedan',
  label: 'Sedan',
  rearOverhangMeters: 0.9,
  wheelbaseMeters: 2.7,
  frontOverhangMeters: 0.95,
  widthMeters: 1.85,
  heightMeters: 1.45,
  cruiseSpeedMinMps: 13,
  cruiseSpeedMaxMps: 17,
  comfortAccelMps2: 2.0,
  comfortDecelMps2: 2.5,
  minGapMeters: 2,
  headwaySeconds: 1.5,
  spawnWeight: 4,
  model: {
    lowerBodyTopMeters: 0.95,
    cabinLengthFraction: 0.5,
    cabinSetbackMeters: 1.0,
    cabinWidthFraction: 0.86,
    bodyColours: ['#3f6f9c', '#8c8f94', '#2f7d4f'],
    wheelRadiusMeters: 0.33,
  },
};

const SUV: TrafficVehicleType = {
  id: 'suv',
  label: 'SUV',
  rearOverhangMeters: 0.95,
  wheelbaseMeters: 2.9,
  frontOverhangMeters: 1.0,
  widthMeters: 1.95,
  heightMeters: 1.8,
  cruiseSpeedMinMps: 11,
  cruiseSpeedMaxMps: 15,
  comfortAccelMps2: 1.8,
  comfortDecelMps2: 2.5,
  minGapMeters: 2.5,
  headwaySeconds: 1.8,
  spawnWeight: 2,
  model: {
    lowerBodyTopMeters: 1.05,
    cabinLengthFraction: 0.62,
    cabinSetbackMeters: 0.7,
    cabinWidthFraction: 0.9,
    bodyColours: ['#2b2f36', '#f2f2f0', '#6b4a2b'],
    wheelRadiusMeters: 0.37,
  },
};

const VAN: TrafficVehicleType = {
  id: 'van',
  label: 'Van',
  rearOverhangMeters: 1.0,
  wheelbaseMeters: 3.6,
  frontOverhangMeters: 1.1,
  widthMeters: 2.05,
  heightMeters: 2.4,
  cruiseSpeedMinMps: 10,
  cruiseSpeedMaxMps: 13,
  comfortAccelMps2: 1.4,
  comfortDecelMps2: 2.0,
  minGapMeters: 3,
  headwaySeconds: 2.0,
  spawnWeight: 1,
  model: {
    lowerBodyTopMeters: 1.6,
    cabinLengthFraction: 0.9,
    cabinSetbackMeters: 0.1,
    cabinWidthFraction: 0.96,
    bodyColours: ['#f0f0f0', '#4a6fa5', '#7a2e2e'],
    wheelRadiusMeters: 0.38,
  },
};

/** The roster. Four types with distinct proportions: compact, sedan, SUV, and van. Local forward is +Z for all. */
export const TRAFFIC_ROSTER: readonly TrafficVehicleType[] = [COMPACT, SEDAN, SUV, VAN];

export function findTrafficType(id: TrafficTypeId): TrafficVehicleType {
  const type = TRAFFIC_ROSTER.find((candidate) => candidate.id === id);
  if (!type) throw new Error(`Unknown traffic type: ${id}`);
  return type;
}
