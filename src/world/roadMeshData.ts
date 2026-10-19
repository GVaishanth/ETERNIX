import type { Vec3 } from '../core/types';
import { ROAD_NETWORK_CONFIG } from '../config/roadConfig';
import { NETWORK_BOUNDARY_HALF_WIDTH_METERS, NETWORK_ROAD_HALF_WIDTH_METERS } from '../config/roadConfig';
import { offsetPoint, sampleAtDistance } from './roadGeometry';
import type { RoadNetwork, RoadSegment } from './roadTypes';

/*
 * Pure mesh data for the road network. No Three.js: the render layer turns these buffers into BufferGeometry once,
 * at load time. Every vertex is derived from the same centreline samples as the boundary (roadBoundary.ts), so the
 * visible road and the drivable region cannot drift apart.
 *
 * Layers (each becomes one merged mesh with one shared material):
 *   asphalt        road surface and junction pads, y = 0
 *   dirt           dirt road surface, y = 0, no markings
 *   shoulders      grass-edge shoulders, y = -0.03 (below the road, so no z-fighting)
 *   markingsWhite  dashed dividers, solid edges, stop lines, start line, arrows (y = 0.012 / 0.02, polygonOffset)
 *   markingsYellow double centre line
 *   guardrails     vertical panels on the outer edge and dead-end caps
 * Plus instance lists: posts and static blocks.
 *
 * Winding: every quad is oriented so its triangles face the declared normal, so no mesh is culled by mistake.
 */

export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface PostInstance {
  position: Vec3;
  /** Yaw of the road the post stands beside. Posts are oriented along it. */
  headingRadians: number;
}

export interface BlockInstance {
  centre: Vec3;
  widthMeters: number;
  depthMeters: number;
  heightMeters: number;
}

export interface RoadMeshData {
  asphalt: MeshBuffers;
  /** Dirt roads (SurfaceType 'dirt'). No markings. */
  dirt: MeshBuffers;
  shoulders: MeshBuffers;
  markingsWhite: MeshBuffers;
  markingsYellow: MeshBuffers;
  guardrails: MeshBuffers;
  posts: PostInstance[];
  blocks: BlockInstance[];
}

/** Static validation props on the infield and beyond the spur ends. Not city content. */
export const ROAD_TEST_BLOCKS: BlockInstance[] = [
  { centre: { x: -180, y: 0, z: 110 }, widthMeters: 40, depthMeters: 30, heightMeters: ROAD_NETWORK_CONFIG.blockHeightMeters },
  { centre: { x: -250, y: 0, z: 60 }, widthMeters: 24, depthMeters: 24, heightMeters: ROAD_NETWORK_CONFIG.blockHeightMeters },
  { centre: { x: -110, y: 0, z: 40 }, widthMeters: 20, depthMeters: 30, heightMeters: ROAD_NETWORK_CONFIG.blockHeightMeters },
  { centre: { x: 60, y: 0, z: 300 }, widthMeters: 40, depthMeters: 40, heightMeters: ROAD_NETWORK_CONFIG.blockHeightMeters },
  { centre: { x: -420, y: 0, z: 300 }, widthMeters: 50, depthMeters: 50, heightMeters: ROAD_NETWORK_CONFIG.blockHeightMeters },
  { centre: { x: -300, y: 0, z: 380 }, widthMeters: 60, depthMeters: 40, heightMeters: ROAD_NETWORK_CONFIG.blockHeightMeters },
  { centre: { x: -180, y: 0, z: 480 }, widthMeters: 40, depthMeters: 40, heightMeters: ROAD_NETWORK_CONFIG.blockHeightMeters },
];

/** Growable vertex and index buffer. Quads are added with a declared normal, and winding follows that normal. */
class MeshAccumulator {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly indices: number[] = [];

  addTriangle(a: Vec3, b: Vec3, c: Vec3, normal: Vec3): void {
    // Orient the triangle so its geometric normal agrees with the declared normal.
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const agrees = nx * normal.x + ny * normal.y + nz * normal.z >= 0;
    const base = this.positions.length / 3;
    const order = agrees ? [a, b, c] : [a, c, b];
    for (const p of order) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
    }
    this.indices.push(base, base + 1, base + 2);
  }

  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal: Vec3): void {
    // a-b-c-d in order around the quad.
    this.addTriangle(a, b, c, normal);
    this.addTriangle(a, c, d, normal);
  }

  build(): MeshBuffers {
    const vertexCount = this.positions.length / 3;
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      indices: new Uint32Array(this.indices),
      vertexCount,
      triangleCount: this.indices.length / 3,
    };
  }
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };

/**
 * A point across the road: `offset` metres to the right of the centreline point, and `y` metres above the centreline's
 * own height at that point. The centreline carries the road's elevation, so a flat road has y equal to its offset.
 */
function at(point: Vec3, heading: number, offset: number, y: number): Vec3 {
  const p = offsetPoint(point, heading, offset);
  return { x: p.x, y: point.y + y, z: p.z };
}

/**
 * A strip across the travel direction, between two lateral offsets, from arc length s0 to s1 along a centreline.
 * Subdivided at maxStep so curves stay smooth.
 */
function ribbon(
  acc: MeshAccumulator,
  segment: RoadSegment,
  s0: number,
  s1: number,
  offsetA: number,
  offsetB: number,
  y: number,
  maxStep: number,
): void {
  const line = segment.centerline;
  if (!line || !(s1 > s0)) return;
  const steps = Math.max(1, Math.ceil((s1 - s0) / maxStep));
  for (let i = 0; i < steps; i += 1) {
    const sa = s0 + ((s1 - s0) * i) / steps;
    const sb = s0 + ((s1 - s0) * (i + 1)) / steps;
    const pa = sampleAtDistance(line, sa);
    const pb = sampleAtDistance(line, sb);
    acc.addQuad(
      at(pa.point, pa.heading, offsetA, y),
      at(pa.point, pa.heading, offsetB, y),
      at(pb.point, pb.heading, offsetB, y),
      at(pb.point, pb.heading, offsetA, y),
      UP,
    );
  }
}

/** A straight line across the road at arc length s, at a given heading, from offset a to offset b. */
function crossBar(acc: MeshAccumulator, point: Vec3, heading: number, a: number, b: number, y: number, depth: number, normal: Vec3): void {
  const forwardDepth = depth / 2;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  // The points come from at(), so they already carry the height. Shifting along the road keeps it.
  const shift = (p: Vec3, d: number): Vec3 => ({ x: p.x + fx * d, y: p.y, z: p.z + fz * d });
  const aLow = shift(at(point, heading, a, y), -forwardDepth);
  const bLow = shift(at(point, heading, b, y), -forwardDepth);
  const bHigh = shift(at(point, heading, b, y), forwardDepth);
  const aHigh = shift(at(point, heading, a, y), forwardDepth);
  acc.addQuad(aLow, bLow, bHigh, aHigh, normal);
}

/** Dashes along a segment: `dash` metres on, `gap` metres off, starting at s = 0. */
function dashedRibbon(
  acc: MeshAccumulator,
  segment: RoadSegment,
  offsetA: number,
  offsetB: number,
  y: number,
  dash: number,
  gap: number,
  maxStep: number,
  startS = 0,
  endS = segment.lengthMeters,
): void {
  const period = dash + gap;
  for (let s = startS; s < endS; s += period) {
    const end = Math.min(s + dash, endS);
    ribbon(acc, segment, s, end, offsetA, offsetB, y, maxStep);
  }
}

function isRailSegment(segment: RoadSegment): boolean {
  return (segment.kind === 'straight' || segment.kind === 'arc') && segment.centerline !== null;
}

/** Which of a segment's ends meets a junction pad, by the explicit connection list. */
/**
 * Per-segment junction connections, computed once per network. Each street end is marked when it meets a junction.
 * Building this per segment was quadratic in the network size, so chunked builds share one copy.
 */
export interface PreparedRoadInput {
  readonly junctionEnds: ReadonlyMap<string, { start: boolean; end: boolean }>;
}

export function prepareRoadInput(network: RoadNetwork): PreparedRoadInput {
  const kindOf = new Map(network.segments.map((candidate) => [candidate.id, candidate.kind] as const));
  const junctionEnds = new Map<string, { start: boolean; end: boolean }>();
  for (const segment of network.segments) junctionEnds.set(segment.id, { start: false, end: false });
  for (const connection of network.connections) {
    const ends = [connection.a, connection.b];
    for (const mine of ends) {
      const other = ends.find((e) => e.segmentId !== mine.segmentId);
      const record = junctionEnds.get(mine.segmentId);
      if (!record || !other || kindOf.get(other.segmentId) !== 'junction') continue;
      if (mine.portId === 'start') record.start = true;
      if (mine.portId === 'end') record.end = true;
    }
  }
  return { junctionEnds };
}

export interface RoadMeshOptions {
  /** Build only these segments. Omitted means every segment (the whole-network build). */
  readonly emitIds?: ReadonlySet<string>;
  /** Static test blocks to emit. Omitted means the default set. Chunked builds pass the blocks they own. */
  readonly blocks?: readonly BlockInstance[];
  /** Precomputed junction ends. Omitted means computed for this call. */
  readonly prepared?: PreparedRoadInput;
}

/** Builds all road meshes. Deterministic. Call once per network, never per frame. */
/**
 * Barriers around a junction pad. Each compass side is either an arm mouth (road width at its centre, left open) or a
 * closed side (a barrier across the whole edge). A side with an arm gets barriers on the two shoulder strips beside
 * the mouth, which is where the arm's own guardrails end.
 */
function junctionBarriers(
  rails: MeshAccumulator,
  segment: RoadSegment,
  roadHalf: number,
  boundaryHalf: number,
  railBase: number,
  railTop: number,
): void {
  const junction = segment.junction;
  if (!junction) return;
  const c = junction.centre;
  const h = junction.halfSizeMeters;
  const sides: Array<{ port: string; n: Vec3 }> = [
    { port: 'north', n: { x: 0, y: 0, z: 1 } },
    { port: 'east', n: { x: 1, y: 0, z: 0 } },
    { port: 'south', n: { x: 0, y: 0, z: -1 } },
    { port: 'west', n: { x: -1, y: 0, z: 0 } },
  ];
  const span = (side: Vec3, t0: number, t1: number): void => {
    // Tangent along the edge, to the right of the outward normal.
    const tg: Vec3 = { x: -side.z, y: 0, z: side.x };
    // Heights are offsets above the junction's own height.
    const point = (t: number, y: number): Vec3 => ({
      x: c.x + side.x * h + tg.x * t,
      y: c.y + y,
      z: c.z + side.z * h + tg.z * t,
    });
    const inward: Vec3 = { x: -side.x, y: 0, z: -side.z };
    rails.addQuad(point(t0, railBase), point(t1, railBase), point(t1, railTop), point(t0, railTop), inward);
  };
  for (const side of sides) {
    const hasArm = segment.ports.some((port) => port.id === side.port);
    if (!hasArm) {
      span(side.n, -boundaryHalf, boundaryHalf);
      continue;
    }
    span(side.n, roadHalf, boundaryHalf);
    span(side.n, -boundaryHalf, -roadHalf);
  }
}

export function buildRoadMeshData(network: RoadNetwork, options: RoadMeshOptions = {}): RoadMeshData {
  const emit = options.emitIds;
  const prepared = options.prepared ?? prepareRoadInput(network);
  const asphalt = new MeshAccumulator();
  const dirt = new MeshAccumulator();
  const shoulders = new MeshAccumulator();
  const white = new MeshAccumulator();
  const yellow = new MeshAccumulator();
  const rails = new MeshAccumulator();
  const posts: PostInstance[] = [];

  const cfg = ROAD_NETWORK_CONFIG;
  const roadHalf = NETWORK_ROAD_HALF_WIDTH_METERS;
  const boundaryHalf = NETWORK_BOUNDARY_HALF_WIDTH_METERS;
  const laneWidth = cfg.laneWidthMeters;
  const maxStep = cfg.maxSampleSpacingMeters;

  for (const segment of network.segments) {
    if (emit && !emit.has(segment.id)) continue;
    if (segment.kind === 'junction' && segment.junction) {
      const c = segment.junction.centre;
      const h = segment.junction.halfSizeMeters;
      // The pad sits at the junction's own height. A junction is a single flat square.
      const sw: Vec3 = { x: c.x - h, y: c.y, z: c.z - h };
      const se: Vec3 = { x: c.x + h, y: c.y, z: c.z - h };
      const ne: Vec3 = { x: c.x + h, y: c.y, z: c.z + h };
      const nw: Vec3 = { x: c.x - h, y: c.y, z: c.z + h };
      asphalt.addQuad(sw, se, ne, nw, UP);
      // Barriers on every pad edge that is not an open road mouth. The boundary is the pad square, so each edge the
      // car cannot leave through must have a visible barrier. A mouth is the road width at the centre of an arm.
      junctionBarriers(rails, segment, roadHalf, boundaryHalf, cfg.guardrailBaseMeters, cfg.guardrailHeightMeters);
      continue;
    }
    if (!isRailSegment(segment)) continue;
    const line = segment.centerline;
    if (!line) continue;
    const L = segment.lengthMeters;

    // Asphalt: centre to roadHalf, both sides (one ribbon from -roadHalf to +roadHalf).
    ribbon(segment.surface === 'dirt' ? dirt : asphalt, segment, 0, L, -roadHalf, roadHalf, 0, maxStep);
    // Shoulders: from the road edge to the boundary, both sides, a little below the road.
    ribbon(shoulders, segment, 0, L, roadHalf, boundaryHalf, cfg.shoulderYMeters, maxStep);
    ribbon(shoulders, segment, 0, L, -boundaryHalf, -roadHalf, cfg.shoulderYMeters, maxStep);

    // Dirt has no paint. Its markings go to scratch buffers that are discarded.
    const paintWhite = segment.surface === 'dirt' ? new MeshAccumulator() : white;
    const paintYellow = segment.surface === 'dirt' ? new MeshAccumulator() : yellow;
    const markY = cfg.markingYMeters;
    const lw = cfg.lineWidthMeters;
    // Solid edge lines, inset from the road edge.
    const edge = roadHalf - cfg.edgeLineInsetMeters;
    ribbon(paintWhite, segment, 0, L, edge - lw / 2, edge + lw / 2, markY, maxStep);
    ribbon(paintWhite, segment, 0, L, -edge - lw / 2, -edge + lw / 2, markY, maxStep);
    // Dashed lane dividers between lanes of the same direction (at ±laneWidth on a 2-lane-per-way road).
    for (const divider of [laneWidth, -laneWidth]) {
      dashedRibbon(paintWhite, segment, divider - lw / 2, divider + lw / 2, markY, cfg.dashLengthMeters, cfg.dashGapMeters, maxStep);
    }
    // Double yellow centre line: two solid lines either side of the centre.
    const c0 = cfg.centerLineOffsetMeters;
    ribbon(paintYellow, segment, 0, L, c0 - lw / 2, c0 + lw / 2, markY, maxStep);
    ribbon(paintYellow, segment, 0, L, -c0 - lw / 2, -c0 + lw / 2, markY, maxStep);

    // Direction arrows on the travel lane (+laneWidth), every arrowSpacing metres.
    for (let s = cfg.arrowFirstOffsetMeters; s < L - 3; s += cfg.arrowSpacingMeters) {
      const pose = sampleAtDistance(line, s);
      const f = { x: Math.sin(pose.heading), y: 0, z: Math.cos(pose.heading) };
      const centre = at(pose.point, pose.heading, laneWidth, cfg.arrowYMeters);
      // tip and back are on the road's centreline height. at() adds the arrow height to `back`, so it carries the height.
      const tip: Vec3 = { x: centre.x + f.x * 1.6, y: centre.y, z: centre.z + f.z * 1.6 };
      const back = { x: centre.x - f.x * 1.2, y: pose.point.y, z: centre.z - f.z * 1.2 };
      const left = at(back, pose.heading, -0.7, cfg.arrowYMeters);
      const right = at(back, pose.heading, 0.7, cfg.arrowYMeters);
      paintWhite.addTriangle(left, right, tip, UP);
    }

    // Guardrails on both outer edges (boundary), plus a cap at any terminal port.
    const railBase = cfg.guardrailBaseMeters;
    const railTop = cfg.guardrailHeightMeters;
    for (const side of [1, -1]) {
      const boundary = side * boundaryHalf;
      for (let i = 0; i < line.points.length - 1; i += 1) {
        const p0 = line.points[i];
        const p1 = line.points[i + 1];
        const h0 = line.headings[i] ?? 0;
        const h1 = line.headings[i + 1] ?? h0;
        if (!p0 || !p1) continue;
        // Inward normal: opposite the right-hand direction on the right edge, and along it on the left edge.
        const normal = { x: -side * Math.cos(h0), y: 0, z: side * Math.sin(h0) };
        rails.addQuad(
          at(p0, h0, boundary, railBase),
          at(p0, h0, boundary, railTop),
          at(p1, h1, boundary, railTop),
          at(p1, h1, boundary, railBase),
          normal,
        );
      }
    }
    for (const port of segment.ports) {
      if (!port.terminal) continue;
      // Travel heading into the dead end is the reverse of the outward direction.
      const h = Math.atan2(port.outward.x, port.outward.z) + Math.PI;
      const pivot = port.position;
      const n: Vec3 = { x: -port.outward.x, y: 0, z: -port.outward.z };
      rails.addQuad(
        at(pivot, h, -boundaryHalf, railBase),
        at(pivot, h, boundaryHalf, railBase),
        at(pivot, h, boundaryHalf, railTop),
        at(pivot, h, -boundaryHalf, railTop),
        n,
      );
    }

    // Stop lines on the inbound lanes, 1.5 m before the pad. Arms that end at the pad carry inbound traffic on the
    // positive (right) side. Arms that start at the pad carry it on the negative side. Lane directions never conflict.
    const junctionEnds = prepared.junctionEnds.get(segment.id) ?? { start: false, end: false };
    const stopDistance = cfg.stopLineDistanceMeters;
    const stopDepth = cfg.stopLineWidthMeters;
    if (junctionEnds.end) {
      const s0 = Math.max(0, L - stopDistance);
      const pose = sampleAtDistance(line, s0);
      crossBar(white, pose.point, pose.heading, 0, roadHalf, markY, stopDepth, UP);
    }
    if (junctionEnds.start) {
      const pose = sampleAtDistance(line, Math.min(L, stopDistance));
      crossBar(white, pose.point, pose.heading, -roadHalf, 0, markY, stopDepth, UP);
    }

    // Posts every guardrailPostSpacing metres along both edges.
    const spacing = cfg.guardrailPostSpacingMeters;
    for (let s = 0; s <= L + 1e-9; s += spacing) {
      const pose = sampleAtDistance(line, s);
      for (const side of [1, -1]) {
        const p = offsetPoint(pose.point, pose.heading, side * boundaryHalf);
        posts.push({ position: { x: p.x, y: p.y, z: p.z }, headingRadians: pose.heading });
      }
    }
  }

  // Start line across every lane, at the circuit start (z = 0). Its heading is S1's heading.
  const start = network.segments.find((segment) => segment.id === 'S1');
  if (start?.centerline && (!emit || emit.has('S1'))) {
    crossBar(white, start.ports[0]?.position ?? { x: 0, y: 0, z: 0 }, start.centerline.headings[0] ?? 0, -roadHalf, roadHalf, cfg.markingYMeters, 0.6, UP);
  }

  return {
    asphalt: asphalt.build(),
    dirt: dirt.build(),
    shoulders: shoulders.build(),
    markingsWhite: white.build(),
    markingsYellow: yellow.build(),
    guardrails: rails.build(),
    posts,
    blocks: options.blocks ? [...options.blocks] : ROAD_TEST_BLOCKS,
  };
}
