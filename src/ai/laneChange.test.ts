/*
 * Lane changes. A segment lane has one lane-change neighbour: the same road and direction on the other lane index.
 * Traffic follows successor links only, so it never changes lane. A driver with a route that asks for the neighbour, or
 * one that is asked to change, moves onto it at its own place along the road. The tests read real decisions on the city.
 */
import { describe, expect, it } from 'vitest';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, isLaneChange, laneSample, successorOf, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import { createVehicleState } from '../simulation/vehicle';
import { rightFromYaw } from '../core/coordinates';
import type { VehicleState } from '../core/types';
import { AiDriver } from './aiController';

const graph: LaneGraph = buildLaneGraph(buildCityNetwork());

/** A segment lane on the first forward road, on lane index 0, and its neighbour on index 1. */
function pairOfLanes(): { from: LanePath; to: LanePath } {
  const from = graph.lanes.find((lane) => lane.kind === 'segment' && lane.direction === 'F' && lane.laneIndex === 0 && lane.lengthMeters > 80);
  if (!from) throw new Error('no forward lane');
  const to = graph.byId.get(from.lateralIds[0] ?? '');
  if (!to) throw new Error('no neighbour lane');
  return { from, to };
}

/** A vehicle state on the lane at `s`, aligned with the lane, offset `lateral` metres to the right, at `speed`. */
function stateOn(lane: LanePath, s: number, speed = 10, lateral = 0): VehicleState {
  const pose = laneSample(lane, s);
  const right = rightFromYaw(pose.heading);
  const position = { x: pose.x + right.x * lateral, y: 0, z: pose.z + right.z * lateral };
  return { ...createVehicleState(position, pose.heading), speed };
}

describe('lane-change neighbours', () => {
  it('a segment lane lists exactly the other lane index of its road and direction', () => {
    for (const lane of graph.lanes) {
      if (lane.kind !== 'segment') {
        expect(lane.lateralIds, `connector ${lane.id}`).toEqual([]);
        continue;
      }
      expect(lane.lateralIds.length, lane.id).toBe(1);
      const other = graph.byId.get(lane.lateralIds[0]!)!;
      expect(other.ownerId).toBe(lane.ownerId);
      expect(other.direction).toBe(lane.direction);
      expect(other.laneIndex).not.toBe(lane.laneIndex);
      expect(isLaneChange(lane, other)).toBe(true);
    }
  });

  it('traffic never follows a lane change: no successor link is a lane-change neighbour', () => {
    for (const lane of graph.lanes) {
      for (const id of lane.lateralIds) expect(lane.successorIds.includes(id), `${lane.id} -> ${id}`).toBe(false);
      expect(successorOf(lane) === undefined || !lane.lateralIds.includes(successorOf(lane)!)).toBe(true);
    }
  });
});

describe('AI driver lane changes', () => {
  it('a route whose next lane is the neighbour moves the driver onto it at its own place on the road', () => {
    const { from, to } = pairOfLanes();
    const driver = new AiDriver(graph, from.id, 40, { nextLaneOf: () => to.id });
    const decision = driver.decide(stateOn(from, 40), []);
    expect(decision.laneId).toBe(to.id);
    // The place along the road is kept: the car is at 40 m on the neighbour too.
    expect(Math.abs(driver.route.s - 40)).toBeLessThan(1);
    // The car is on the original lane, so it is now about one lane width off the new lane's centre.
    expect(Math.abs(decision.lateralErrorMeters)).toBeGreaterThan(2.5);
  });

  it('a driver asked to change lane changes on its next step, and ignores a request for a lane that is not a neighbour', () => {
    const { from, to } = pairOfLanes();
    const driver = new AiDriver(graph, from.id, 60);
    driver.requestLaneChange(to.id);
    expect(driver.decide(stateOn(from, 60), []).laneId).toBe(to.id);

    const other = new AiDriver(graph, from.id, 60);
    const far = graph.lanes.find((lane) => lane.kind === 'segment' && lane.ownerId !== from.ownerId && lane.direction === 'F');
    expect(far).toBeDefined();
    other.requestLaneChange(far!.id);
    expect(other.decide(stateOn(from, 60), []).laneId).toBe(from.id);
  });

  it('a traffic driver with the default policy never changes lane index, even when the car drifts onto the neighbour', () => {
    const { from, to } = pairOfLanes();
    const driver = new AiDriver(graph, from.id, 5);
    // The car sits on the neighbour lane. The default policy follows successor links only, so the driver stays on index 0.
    for (let i = 0; i < 100; i += 1) {
      driver.decide(stateOn(to, 5 + i * 0.5, 10), []);
      expect(driver.route.laneId).toBe(from.id);
    }
  });
});
