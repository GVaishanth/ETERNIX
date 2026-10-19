import { describe, expect, it } from 'vitest';
import { buildCircuitNetwork } from '../world/circuitNetwork';
import { buildLaneGraph, laneSample, type LanePath } from './laneGraph';

const network = buildCircuitNetwork();
const graph = buildLaneGraph(network);

function loopFrom(startId: string): LanePath[] {
  const order: LanePath[] = [];
  let lane = graph.byId.get(startId);
  for (let guard = 0; lane && guard < 100; guard += 1) {
    // Stop before pushing the start lane again, so each lane of the loop is counted once.
    if (lane.id === startId && order.length > 0) break;
    order.push(lane);
    const next = lane.successorIds[0];
    lane = next ? graph.byId.get(next) : undefined;
  }
  return order;
}

describe('traffic lane graph', () => {
  it('builds two lanes per direction on each circuit segment, plus straight-through junction connectors', () => {
    // 9 circuit segments (S1, T1, S2a, S2b, T2, S3, T3, S4, T4) x 2 directions x 2 lanes = 36.
    // Junction J1 contributes east>west and west>east, each with 2 lanes = 4. Spurs contribute nothing.
    const segmentLanes = graph.lanes.filter((lane) => lane.kind === 'segment');
    const connectorLanes = graph.lanes.filter((lane) => lane.kind === 'connector');
    expect(segmentLanes).toHaveLength(36);
    expect(connectorLanes).toHaveLength(4);
    expect(graph.lanes.some((lane) => lane.ownerId === 'JN' || lane.ownerId === 'JS')).toBe(false);
  });

  it('gives every lane exactly one successor, on the same lane index', () => {
    for (const lane of graph.lanes) {
      expect(lane.successorIds, lane.id).toHaveLength(1);
      expect(graph.byId.get(lane.successorIds[0] ?? '')?.laneIndex, lane.id).toBe(lane.laneIndex);
    }
  });

  it('meets every successor at the joint: position and heading match within tolerance', () => {
    for (const lane of graph.lanes) {
      const successor = graph.byId.get(lane.successorIds[0] ?? '');
      if (!successor) throw new Error(`${lane.id} has no successor`);
      const end = laneSample(lane, lane.lengthMeters);
      const start = laneSample(successor, 0);
      expect(Math.hypot(end.x - start.x, end.z - start.z), `${lane.id} -> ${successor.id}`).toBeLessThan(0.01);
      expect(Math.abs(end.heading - start.heading), `${lane.id} -> ${successor.id} heading`).toBeLessThan(0.01);
    }
  });

  it('keeps arc-length samples strictly increasing', () => {
    for (const lane of graph.lanes) {
      for (let i = 1; i < lane.s.length; i += 1) {
        expect(lane.s[i] ?? 0, lane.id).toBeGreaterThan(lane.s[i - 1] ?? 0);
      }
    }
  });

  it('places forward lanes 1.8 m and 5.4 m to the right of the centerline, on straights and arcs', () => {
    // Right of a heading h is (cos h, -sin h). The forward inner lane on S1 (heading 0) sits at x = +1.8.
    const s1Inner = graph.byId.get('S1:F:0');
    const s1Outer = graph.byId.get('S1:F:1');
    expect(s1Inner?.points[10]?.x).toBeCloseTo(1.8, 6);
    expect(s1Outer?.points[10]?.x).toBeCloseTo(5.4, 6);

    // On the arc T1 the centre is (-60, 200), R = 60. The right lane is outside a left turn: radius R + offset.
    const t1 = graph.byId.get('T1:F:0');
    if (!t1) throw new Error('missing T1 lane');
    for (const index of [0, Math.floor(t1.points.length / 2), t1.points.length - 1]) {
      const point = t1.points[index];
      if (!point) throw new Error('missing sample');
      expect(Math.hypot(point.x + 60, point.z - 200), `T1 sample ${index}`).toBeCloseTo(61.8, 3);
    }
  });

  it('places reverse lanes on the opposite side of the centerline, facing against the centerline direction', () => {
    const reverse = graph.byId.get('S1:R:0');
    expect(reverse?.points[10]?.x).toBeCloseTo(-1.8, 6);
    // wrapAngle returns (-pi, pi], so a half turn may come back as -pi. Compare the magnitude.
    expect(Math.abs(Math.abs(reverse?.headings[10] ?? 0) - Math.PI)).toBeLessThan(1e-6);
  });

  it('forms one closed loop in each direction, with the loop length of the circuit', () => {
    const forward = loopFrom('S1:F:0');
    const reverse = loopFrom('S1:R:0');
    const forwardLength = forward.reduce((sum, lane) => sum + lane.lengthMeters, 0);
    const reverseLength = reverse.reduce((sum, lane) => sum + lane.lengthMeters, 0);
    // The last lane of each loop hands over to the start lane, which closes the loop.
    expect(forward[forward.length - 1]?.successorIds).toEqual(['S1:F:0']);
    expect(reverse[reverse.length - 1]?.successorIds).toEqual(['S1:R:0']);
    // Forward lane loop: 1236.6 m of centerline, plus 11.3 m because the lane sits 1.8 m outside each left turn
    // (4 arcs x (R + 1.8) x pi/2), plus the 20.4 m pad connector. Total 1268.3 m.
    // Reverse lane loop: the same lanes sit on the inside of the turns (R - 1.8), so it is 22.6 m shorter.
    expect(Math.abs(forwardLength - 1268.3)).toBeLessThan(0.5);
    expect(Math.abs(reverseLength - 1245.7)).toBeLessThan(0.5);
  });

  it('crosses the junction only through the connector lanes for the circuit', () => {
    const forward = loopFrom('S1:F:0');
    const junction = forward.filter((lane) => lane.kind === 'connector');
    expect(junction.map((lane) => lane.id)).toEqual(['J1:east>west:0']);
  });

  it('is deterministic: the same network gives the same lane ids and lengths', () => {
    const again = buildLaneGraph(buildCircuitNetwork());
    expect(again.lanes.map((lane) => `${lane.id}:${lane.lengthMeters.toFixed(6)}`)).toEqual(
      graph.lanes.map((lane) => `${lane.id}:${lane.lengthMeters.toFixed(6)}`),
    );
  });
});
