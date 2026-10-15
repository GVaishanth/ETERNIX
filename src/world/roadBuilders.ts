import { forwardFromYaw } from '../core/coordinates';
import type { Vec3 } from '../core/types';
import { ROAD_NETWORK_CONFIG, NETWORK_BOUNDARY_HALF_WIDTH_METERS, NETWORK_LANE_COUNT } from '../config/roadConfig';
import { arcCenterline, straightCenterline, type Pose } from './roadGeometry';
import type { BoundaryKind, RoadPort, RoadSegment, RoadType } from './roadTypes';

/*
 * Modular road segment builders. Each function returns a complete RoadSegment with explicit ports, so a network is
 * composed by naming ports, never by placing meshes by eye. Pure: no Three.js.
 */

/** Cross-section shared by every segment of a network. */
export interface RoadProfile {
  laneCount: number;
  laneWidthMeters: number;
  shoulderWidthMeters: number;
  roadWidthMeters: number;
  boundaryHalfWidthMeters: number;
  maxSampleSpacingMeters: number;
}

export const NETWORK_PROFILE: RoadProfile = {
  laneCount: NETWORK_LANE_COUNT,
  laneWidthMeters: ROAD_NETWORK_CONFIG.laneWidthMeters,
  shoulderWidthMeters: ROAD_NETWORK_CONFIG.shoulderWidthMeters,
  roadWidthMeters: NETWORK_LANE_COUNT * ROAD_NETWORK_CONFIG.laneWidthMeters,
  boundaryHalfWidthMeters: NETWORK_BOUNDARY_HALF_WIDTH_METERS,
  maxSampleSpacingMeters: ROAD_NETWORK_CONFIG.maxSampleSpacingMeters,
};

export interface StraightOptions {
  id: string;
  roadType: RoadType;
  start: Pose;
  lengthMeters: number;
  speedLimitMps: number;
  startTerminal?: boolean;
  endTerminal?: boolean;
  profile?: RoadProfile;
}

export interface ArcOptions {
  id: string;
  roadType: RoadType;
  start: Pose;
  radiusMeters: number;
  /** Signed sweep: positive right, negative left. */
  turnRadians: number;
  speedLimitMps: number;
  profile?: RoadProfile;
}

export interface JunctionOptions {
  id: string;
  centre: Vec3;
  profile?: RoadProfile;
}

function headingOfEndPoint(centerlineHeadings: number[]): number {
  return centerlineHeadings[centerlineHeadings.length - 1] ?? 0;
}

function sharedFields(profile: RoadProfile, boundary: BoundaryKind) {
  return {
    laneCount: profile.laneCount,
    laneWidthMeters: profile.laneWidthMeters,
    roadWidthMeters: profile.roadWidthMeters,
    shoulderWidthMeters: profile.shoulderWidthMeters,
    boundaryHalfWidthMeters: profile.boundaryHalfWidthMeters,
    elevationMeters: 0,
    surface: 'asphalt' as const,
    drivingDirection: 'twoWay' as const,
    leftBoundary: boundary,
    rightBoundary: boundary,
  };
}

export function buildStraight(options: StraightOptions): RoadSegment {
  const profile = options.profile ?? NETWORK_PROFILE;
  const centerline = straightCenterline(options.start, options.lengthMeters, profile.maxSampleSpacingMeters);
  const last = centerline.points[centerline.points.length - 1];
  const endHeading = headingOfEndPoint(centerline.headings);
  const forward = forwardFromYaw(options.start.heading);
  const back = { x: -forward.x, y: 0, z: -forward.z };
  const endForward = forwardFromYaw(endHeading);

  const ports: RoadPort[] = [
    {
      id: 'start',
      position: { ...options.start.position },
      outward: back,
      widthMeters: profile.roadWidthMeters,
      elevationMeters: 0,
      terminal: options.startTerminal === true,
    },
    {
      id: 'end',
      position: { x: last?.x ?? 0, y: 0, z: last?.z ?? 0 },
      outward: endForward,
      widthMeters: profile.roadWidthMeters,
      elevationMeters: 0,
      terminal: options.endTerminal === true,
    },
  ];

  return {
    id: options.id,
    kind: 'straight',
    roadType: options.roadType,
    ports,
    centerline,
    lengthMeters: options.lengthMeters,
    curvatureRadiusMeters: null,
    arc: null,
    junction: null,
    speedLimitMps: options.speedLimitMps,
    ...sharedFields(profile, 'guardrail'),
  };
}

export function buildArc(options: ArcOptions): RoadSegment {
  const profile = options.profile ?? NETWORK_PROFILE;
  if (!(options.radiusMeters > profile.boundaryHalfWidthMeters)) {
    throw new Error(
      `Arc ${options.id}: radius ${options.radiusMeters} m must exceed the boundary half-width ${profile.boundaryHalfWidthMeters} m, or the surface folds over itself.`,
    );
  }
  if (options.turnRadians === 0) throw new Error(`Arc ${options.id}: turn must be non-zero.`);

  const { centerline, centre } = arcCenterline(options.start, options.radiusMeters, options.turnRadians, profile.maxSampleSpacingMeters);
  const last = centerline.points[centerline.points.length - 1];
  const endHeading = headingOfEndPoint(centerline.headings);
  const forward = forwardFromYaw(options.start.heading);
  const endForward = forwardFromYaw(endHeading);

  const ports: RoadPort[] = [
    {
      id: 'start',
      position: { ...options.start.position },
      outward: { x: -forward.x, y: 0, z: -forward.z },
      widthMeters: profile.roadWidthMeters,
      elevationMeters: 0,
      terminal: false,
    },
    {
      id: 'end',
      position: { x: last?.x ?? 0, y: 0, z: last?.z ?? 0 },
      outward: endForward,
      widthMeters: profile.roadWidthMeters,
      elevationMeters: 0,
      terminal: false,
    },
  ];

  return {
    id: options.id,
    kind: 'arc',
    roadType: options.roadType,
    ports,
    centerline,
    lengthMeters: Math.abs(options.turnRadians) * options.radiusMeters,
    curvatureRadiusMeters: options.radiusMeters,
    arc: { centre, radiusMeters: options.radiusMeters, turnRadians: options.turnRadians },
    junction: null,
    speedLimitMps: options.speedLimitMps,
    ...sharedFields(profile, 'guardrail'),
  };
}

/**
 * A square four-way junction. Its footprint extends to the outer shoulder edge, so each arm's shoulder ends exactly at
 * the footprint boundary. The footprint has no walls: every side is an open mouth onto an arm.
 */
export function buildJunction(options: JunctionOptions): RoadSegment {
  const profile = options.profile ?? NETWORK_PROFILE;
  const h = profile.boundaryHalfWidthMeters;
  const c = options.centre;
  const ports: RoadPort[] = [
    { id: 'north', position: { x: c.x, y: 0, z: c.z + h }, outward: { x: 0, y: 0, z: 1 }, widthMeters: profile.roadWidthMeters, elevationMeters: 0, terminal: false },
    { id: 'east', position: { x: c.x + h, y: 0, z: c.z }, outward: { x: 1, y: 0, z: 0 }, widthMeters: profile.roadWidthMeters, elevationMeters: 0, terminal: false },
    { id: 'south', position: { x: c.x, y: 0, z: c.z - h }, outward: { x: 0, y: 0, z: -1 }, widthMeters: profile.roadWidthMeters, elevationMeters: 0, terminal: false },
    { id: 'west', position: { x: c.x - h, y: 0, z: c.z }, outward: { x: -1, y: 0, z: 0 }, widthMeters: profile.roadWidthMeters, elevationMeters: 0, terminal: false },
  ];
  return {
    id: options.id,
    kind: 'junction',
    roadType: 'junction',
    ports,
    centerline: null,
    lengthMeters: 2 * h,
    curvatureRadiusMeters: null,
    arc: null,
    junction: { centre: { x: c.x, y: 0, z: c.z }, halfSizeMeters: h },
    speedLimitMps: 11,
    ...sharedFields(profile, 'none'),
  };
}

/** Returns the port with the given id, or throws. Builders and tests use this, never a positional index. */
export function requirePort(segment: RoadSegment, portId: string): RoadPort {
  const port = segment.ports.find((candidate) => candidate.id === portId);
  if (!port) throw new Error(`Segment ${segment.id} has no port ${portId}.`);
  return port;
}

/**
 * Pose for chaining a new segment onto a port. The port's outward direction is exactly the travel heading of the
 * segment that starts there, so the heading is atan2(x, z) of that vector (yaw 0 faces +Z).
 */
export function portPose(segment: RoadSegment, portId: string): Pose {
  const port = requirePort(segment, portId);
  return {
    position: { ...port.position },
    heading: Math.atan2(port.outward.x, port.outward.z),
  };
}
