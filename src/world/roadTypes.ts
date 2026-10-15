import type { Vec3 } from '../core/types';

/*
 * Logical road model (Part 3). Describes the drivable world independently of any mesh.
 * Navigation, traffic AI, race routes, pursuit, and minimap generation read this model. Meshes are derived from it.
 *
 * Coordinate system: simulation space. +X right, +Y up, +Z forward, meters. Headings are yaw radians: 0 faces +Z,
 * positive turns right (see src/core/coordinates.ts). Every road is flat, with elevation 0.
 *
 * Connection contract (checked by roadValidation.ts). A port is a point where a segment ends, or where a junction
 * opens. Two ports connect when:
 *   - their positions coincide,
 *   - their outward directions are opposite (the tangents agree, so traffic continues smoothly),
 *   - their widths match, and
 *   - their elevations match.
 * `outward` points from the segment toward the connection. A straight or arc start port points backward; its end
 * port points forward along the travel direction.
 */

export type SegmentKind = 'straight' | 'arc' | 'junction';

/** circuit: part of the loop. spur: dead-end branch. junction: intersection box. */
export type RoadType = 'circuit' | 'spur' | 'junction';

export type SurfaceType = 'asphalt';

export type BoundaryKind = 'guardrail' | 'none';

export interface RoadPort {
  /** Unique within its segment: 'start' or 'end' for straights and arcs; 'north', 'east', 'south', 'west' for junctions. */
  id: string;
  position: Vec3;
  /** Unit horizontal direction, pointing out of the segment into the connection. */
  outward: Vec3;
  widthMeters: number;
  elevationMeters: number;
  /** True when the port is an open dead end by design. Open ports that are not terminal are reported. */
  terminal: boolean;
}

/** Sampled centerline. Stored with the segment so every consumer (surface, markings, boundary) uses the same samples. */
export interface CenterlineSample {
  /** Arc length from the start, meters. Strictly increasing. */
  s: number[];
  points: Vec3[];
  /** Travel heading at each sample, radians. */
  headings: number[];
}

export interface ArcGeometry {
  centre: Vec3;
  radiusMeters: number;
  /** Signed sweep: positive for a right turn, negative for a left turn. */
  turnRadians: number;
}

export interface JunctionFootprint {
  centre: Vec3;
  /** Half of the square footprint, measured to the outer shoulder edge. */
  halfSizeMeters: number;
}

export interface RoadSegment {
  id: string;
  kind: SegmentKind;
  roadType: RoadType;
  /** Straights and arcs have 'start' and 'end'. Junctions have four compass ports. */
  ports: RoadPort[];
  /** Centerline samples. Null for junctions, which have no single centerline. */
  centerline: CenterlineSample | null;
  lengthMeters: number;
  /** Centerline radius for arcs. Null for straights and junctions. Future AI uses this for curvature. */
  curvatureRadiusMeters: number | null;
  arc: ArcGeometry | null;
  junction: JunctionFootprint | null;
  laneCount: number;
  laneWidthMeters: number;
  roadWidthMeters: number;
  shoulderWidthMeters: number;
  /** Half of the total width, to the outer shoulder edge. */
  boundaryHalfWidthMeters: number;
  elevationMeters: number;
  surface: SurfaceType;
  /** Two-way roads carry traffic in both directions. The centerline direction is the primary (forward) direction. */
  drivingDirection: 'twoWay';
  leftBoundary: BoundaryKind;
  rightBoundary: BoundaryKind;
  /** Metadata for future AI and navigation. Not enforced by the vehicle yet. */
  speedLimitMps: number;
}

export interface RoadEndpoint {
  segmentId: string;
  portId: string;
}

export interface RoadConnection {
  id: string;
  a: RoadEndpoint;
  b: RoadEndpoint;
}

export interface RoadNetwork {
  id: string;
  name: string;
  segments: RoadSegment[];
  /** Explicit connections. Every port is either in one connection or marked terminal. */
  connections: RoadConnection[];
  spawn: { position: Vec3; yawRadians: number };
}

/** Looks up a segment by id. Returns undefined when the id is unknown. */
export function findSegment(network: RoadNetwork, id: string): RoadSegment | undefined {
  return network.segments.find((segment) => segment.id === id);
}
