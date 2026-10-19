import { describe, expect, it } from 'vitest';
import { buildCityNetwork, buildLoopCityNetwork } from '../world/city/cityNetwork';
import { wrapDelta } from '../world/wrap/worldWrap';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { buildLaneGraph, nearestOnLane, type LaneGraph } from './laneGraph';

/*
 * Stage D step 1: lanes on the loop. Every successor must continue its predecessor across a seam, and a query must find
 * the lane across a seam. The finite city is the control: the same rules hold there without any wrapping.
 */

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
const loopGraph: LaneGraph = buildLaneGraph(buildLoopCityNetwork());
const cityGraph: LaneGraph = buildLaneGraph(buildCityNetwork());

function joinGap(graph: LaneGraph, periodMeters: number | undefined): { worst: number; checked: number; crossings: number } {
  let worst = 0;
  let checked = 0;
  let crossings = 0;
  for (const lane of graph.lanes) {
    const end = lane.points[lane.points.length - 1];
    if (!end) continue;
    for (const id of lane.successorIds) {
      const next = graph.byId.get(id);
      const start = next?.points[0];
      if (!start) continue;
      const dx = periodMeters === undefined ? start.x - end.x : wrapDelta(end.x, start.x, periodMeters);
      const dz = periodMeters === undefined ? start.z - end.z : wrapDelta(end.z, start.z, periodMeters);
      const gap = Math.hypot(dx, dz);
      worst = Math.max(worst, gap);
      checked += 1;
      // A join across the seam: the raw coordinates differ by about a period.
      if (Math.abs(start.x - end.x) > PERIOD / 2 || Math.abs(start.z - end.z) > PERIOD / 2) crossings += 1;
    }
  }
  return { worst, checked, crossings };
}

describe('lanes on the loop', () => {
  it('every lane has a period on the loop and none on the finite city', () => {
    expect(loopGraph.lanes.every((lane) => lane.periodMeters === PERIOD)).toBe(true);
    expect(cityGraph.lanes.every((lane) => lane.periodMeters === undefined)).toBe(true);
  });

  it('every successor continues its predecessor across the seam (loop)', () => {
    const result = joinGap(loopGraph, PERIOD);
    expect(result.checked).toBeGreaterThan(500);
    expect(result.crossings).toBeGreaterThan(0);
    expect(result.worst).toBeLessThan(0.5);
  });

  it('control: successors join on the finite city without wrapping', () => {
    const result = joinGap(cityGraph, undefined);
    expect(result.checked).toBeGreaterThan(500);
    expect(result.crossings).toBe(0);
    expect(result.worst).toBeLessThan(0.5);
  });

  it('every lane is shorter than half a period, so the nearest image is unambiguous', () => {
    const longest = Math.max(...loopGraph.lanes.map((lane) => lane.lengthMeters));
    expect(longest).toBeLessThan(PERIOD / 2);
  });

  it('nearestOnLane finds a lane across the seam at the same distance as on the base side', () => {
    let tested = 0;
    for (const lane of loopGraph.lanes) {
      const p = lane.points[Math.floor(lane.points.length / 2)];
      if (!p) continue;
      const hitBase = nearestOnLane(lane, p.x + 0.7, p.z - 0.4);
      // The same point, moved one period over: the logical position on the far side of the seam.
      const hitImage = nearestOnLane(lane, p.x + PERIOD + 0.7, p.z - 0.4);
      expect(hitBase).not.toBeNull();
      expect(hitImage?.distance ?? NaN).toBeCloseTo(hitBase?.distance ?? NaN, 9);
      expect(hitImage?.s ?? NaN).toBeCloseTo(hitBase?.s ?? NaN, 9);
      tested += 1;
      if (tested >= 60) break;
    }
    expect(tested).toBe(60);
  });
});
