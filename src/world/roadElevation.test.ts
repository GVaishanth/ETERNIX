import { describe, expect, it } from 'vitest';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildLoopCityNetwork } from './city/cityNetwork';
import { buildRoadElevation } from './roadElevation';
import type { LaneGraph, LanePath } from '../traffic/laneGraph';

const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

/** A hand-built lane through the given points. Only the fields the elevation lookup reads are filled in. */
function laneThrough(id: string, points: { x: number; y: number; z: number }[], periodMeters?: number): LanePath {
  const s = [0];
  const headings: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) throw new Error('bad fixture');
    s.push((s[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  points.forEach((_, i) => {
    const here = points[i];
    const next = points[Math.min(i + 1, points.length - 1)];
    const prev = points[Math.max(i - 1, 0)];
    const dx = (next?.x ?? 0) - (prev?.x ?? 0);
    const dz = (next?.z ?? 0) - (prev?.z ?? 0);
    headings.push(here ? Math.atan2(dx, dz) : 0);
  });
  return {
    id,
    kind: 'segment',
    ownerId: id,
    direction: 'F',
    laneIndex: 0,
    offsetMeters: 0,
    points,
    headings,
    s,
    lengthMeters: s[s.length - 1] ?? 0,
    speedLimitMps: 10,
    entryKey: '',
    exitKey: '',
    successorIds: [],
    lateralIds: [],
    periodMeters,
  } as LanePath;
}

function graphOf(...lanes: LanePath[]): LaneGraph {
  return { lanes, byId: new Map(lanes.map((lane) => [lane.id, lane])) };
}

/** A straight eastward road from x=0 to x=400, climbing at 5 percent. Samples every 10 m. */
function climbingEast(): LanePath {
  const points = [];
  for (let x = 0; x <= 400; x += 10) points.push({ x, y: 0.05 * x, z: 0 });
  return laneThrough('east', points);
}

describe('road elevation lookup', () => {
  it('reports a climb: the height follows the road and the grade is the slope, positive for a car going uphill', () => {
    const elevation = buildRoadElevation(graphOf(climbingEast()));
    const at = elevation.surfaceAt(103, 0, EAST)!;
    expect(at.heightMeters).toBeCloseTo(5.15, 6);
    expect(at.grade).toBeCloseTo(0.05, 6);
  });

  it('a car facing the other way on the same road sees the grade with the opposite sign', () => {
    const elevation = buildRoadElevation(graphOf(climbingEast()));
    const back = elevation.surfaceAt(103, 0, WEST)!;
    expect(back.heightMeters).toBeCloseTo(5.15, 6);
    expect(back.grade).toBeCloseTo(-0.05, 6);
  });

  it('a lane that runs downhill in its travel direction gives a negative grade to a car travelling with it', () => {
    const points = [];
    for (let x = 400; x >= 0; x -= 10) points.push({ x, y: 0.05 * x, z: 0 });
    const elevation = buildRoadElevation(graphOf(laneThrough('west', points)));
    const down = elevation.surfaceAt(103, 0, WEST)!;
    expect(down.grade).toBeCloseTo(-0.05, 6);
  });

  it('is zero off the road, and zero everywhere on a flat graph', () => {
    const elevation = buildRoadElevation(graphOf(climbingEast()));
    expect(elevation.surfaceAt(1000, 1000, EAST)).toBeNull();

    const flat = buildRoadElevation(graphOf(laneThrough('flat', [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }])));
    expect(flat.isFlat).toBe(true);
    expect(flat.surfaceAt(50, 0, EAST)).toBeNull();
  });

  it('on the real city loop graph, the hillside crest rises to 12 m and the flat city reads zero', () => {
    const elevation = buildRoadElevation(buildLaneGraph(buildLoopCityNetwork()));
    expect(elevation.isFlat).toBe(false);
    // Node (9, 2) is the crest at x = 1400, z = 0. A car just north of it, on V-9-2, is within a few centimetres of 12 m.
    const crest = elevation.surfaceAt(1400, 10.2, 0);
    expect(crest?.heightMeters).toBeGreaterThan(11.5);
    expect(crest?.heightMeters).toBeLessThanOrEqual(12);
    // Node (-1, -1) is a flat junction in the city: the surface is at zero.
    const flat = elevation.surfaceAt(-600, -600, 0);
    expect(flat).not.toBeNull();
    expect(flat?.heightMeters).toBeCloseTo(0, 6);
    expect(flat?.grade).toBeCloseTo(0, 6);
  });

  it('finds the road across the wrap seam of a looping graph', () => {
    const period = 2400;
    // A road that starts just before the seam (x = 2300) and runs past it (x = 2500), rising 5 percent.
    const points = [];
    for (let x = 2300; x <= 2500; x += 10) points.push({ x, y: 0.05 * (x - 2300), z: 0 });
    const elevation = buildRoadElevation(graphOf(laneThrough('seam', points, period)));
    // x = 50 is the same place as x = 2450 on the loop. The surface there is 0.05 * 150 = 7.5 m high.
    const beyond = elevation.surfaceAt(50, 0, EAST)!;
    expect(beyond.heightMeters).toBeCloseTo(7.5, 6);
    expect(beyond.grade).toBeCloseTo(0.05, 6);
    expect(elevation.surfaceAt(2450, 0, EAST)?.heightMeters).toBeCloseTo(7.5, 6);
  });

  it('returns each sample\'s own height when the query sits on the sample', () => {
    const elevation = buildRoadElevation(graphOf(climbingEast()));
    for (let x = 0; x <= 400; x += 40) {
      expect(elevation.surfaceAt(x, 0, EAST)?.heightMeters).toBeCloseTo(0.05 * x, 6);
    }
  });
});
