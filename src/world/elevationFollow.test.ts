/*
 * Elevation through the real lane graph and the real simulation. The circuit is lifted onto a tilted plane, so every
 * port and every road has a height that differs from its neighbours. The tests then check that lanes, connectors and
 * the car all follow that height.
 */
import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../engine/gameSimulation';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState, Vec3 } from '../core/types';
import { buildLaneGraph, type LaneGraph } from '../traffic/laneGraph';
import { OpponentSystem, type OpponentSpec } from '../ai/aiOpponents';
import { buildCircuitNetwork } from './circuitNetwork';
import { roadElevationFor } from './roadElevation';
import type { RoadNetwork } from './roadTypes';

/** The lifted height: a plane with a 3 percent slope along x and 2 percent along z. Every road is under 8 percent. */
function heightAt(x: number, z: number): number {
  return 0.03 * x + 0.02 * z;
}

/** The circuit with every height field set from heightAt. Plan positions are unchanged. */
function liftedCircuit(): RoadNetwork {
  const network = structuredClone(buildCircuitNetwork());
  for (const segment of network.segments) {
    segment.elevationMeters = heightAt(segment.ports[0]?.position.x ?? 0, segment.ports[0]?.position.z ?? 0);
    for (const port of segment.ports) {
      port.position = { ...port.position, y: heightAt(port.position.x, port.position.z) };
      port.elevationMeters = port.position.y;
    }
    if (segment.centerline) {
      segment.centerline.points = segment.centerline.points.map((p) => ({ ...p, y: heightAt(p.x, p.z) }));
    }
    if (segment.junction) {
      const c = segment.junction.centre;
      segment.junction.centre = { ...c, y: heightAt(c.x, c.z) };
    }
  }
  return network;
}

function portHeights(network: RoadNetwork): Map<string, number> {
  const heights = new Map<string, number>();
  for (const segment of network.segments) {
    for (const port of segment.ports) heights.set(`${segment.id}:${port.id}`, port.position.y);
  }
  return heights;
}

const NO_INPUT: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const GAS: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };

describe('elevation follows the lane graph', () => {
  const network = liftedCircuit();
  const graph: LaneGraph = buildLaneGraph(network);
  const heights = portHeights(network);

  it('every lane starts and ends at the height of the port it joins, including turn connectors', () => {
    let checked = 0;
    let connectors = 0;
    const distinct = new Set<number>();
    for (const lane of graph.lanes) {
      const first = lane.points[0];
      const last = lane.points[lane.points.length - 1];
      if (!first || !last) continue;
      distinct.add(Math.round(first.y * 1000));
      const entry = heights.get(lane.entryKey);
      const exit = heights.get(lane.exitKey);
      if (entry !== undefined) {
        expect(Math.abs(first.y - entry)).toBeLessThan(1e-6);
        checked += 1;
      }
      if (exit !== undefined) {
        expect(Math.abs(last.y - exit)).toBeLessThan(1e-6);
        checked += 1;
      }
      if (lane.kind === 'connector') connectors += 1;
    }
    // The lift must be real: the lanes do not all share one height, and connectors were checked.
    expect(distinct.size).toBeGreaterThan(1);
    expect(connectors).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(50);
  });

  it('the car stands on the road: its height is the road height under it, and a climb slows it', () => {
    const elevation = roadElevationFor(graph);
    expect(elevation.isFlat).toBe(false);
    // A straight forward lane with a clear grade at its midpoint.
    const lane = graph.lanes.find((candidate) => {
      if (candidate.kind !== 'segment' || candidate.direction !== 'F' || candidate.lengthMeters < 150) return false;
      const mid = candidate.points[Math.floor(candidate.points.length / 2)];
      if (!mid) return false;
      return Math.abs(elevation.surfaceAt(mid.x, mid.z, candidate.headings[Math.floor(candidate.points.length / 2)] ?? 0)?.grade ?? 0) > 0.02;
    });
    if (!lane) throw new Error('no sloped straight lane in the lifted circuit');
    const mid = lane.points[Math.floor(lane.points.length / 2)] as Vec3;
    const yaw = lane.headings[Math.floor(lane.points.length / 2)] ?? 0;
    const grade = elevation.surfaceAt(mid.x, mid.z, yaw)?.grade ?? 0;

    const sloped = new GameSimulation(VEHICLE_CONFIG, { elevation });
    const flat = new GameSimulation(VEHICLE_CONFIG, { elevation: null });
    sloped.placeVehicle({ x: mid.x, y: 0, z: mid.z }, yaw);
    flat.placeVehicle({ x: mid.x, y: 0, z: mid.z }, yaw);

    // The car takes the road height when it is placed, with no step needed.
    expect(Math.abs(sloped.state.position.y - heightAt(mid.x, mid.z))).toBeLessThan(0.1);

    // One second of throttle from a standstill. Over a longer run the engine fade near top speed hides the slope.
    for (let i = 0; i < 60; i += 1) {
      sloped.update(1 / 60, GAS);
      flat.update(1 / 60, GAS);
    }
    // The sloped car is slower uphill and faster downhill than the flat one.
    const difference = sloped.state.speed - flat.state.speed;
    expect(Math.sign(difference)).toBe(-Math.sign(grade));
    expect(Math.abs(difference)).toBeGreaterThan(0.1);
    // The height follows the road as the car moves: it is still on the surface, not left at the placed height.
    const here = sloped.state.position;
    expect(Math.abs(here.y - heightAt(here.x, here.z))).toBeLessThan(0.6);
    expect(sloped.state.position.y).not.toBe(0);
  });

  it('a car with no elevation keeps its height (the flat game is unchanged)', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG, { elevation: null });
    sim.placeVehicle({ x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 60; i += 1) sim.update(1 / 60, NO_INPUT);
    expect(sim.state.position.y).toBe(0);
  });

  it('an AI unit stands on the road as it drives: its height is the road height under it', () => {
    const lane = graph.byId.get('S1:F:0');
    if (!lane) throw new Error('S1:F:0 is missing from the lifted circuit');
    const spec: OpponentSpec = { typeId: 'sedan', laneId: lane.id, s: 20, speedMps: 8, colourIndex: 0 };
    const system = new OpponentSystem(graph, null, [spec]);
    for (let i = 0; i < 120; i += 1) system.integrate(1 / 60, []);
    const unit = system.opponents[0];
    if (!unit) throw new Error('no unit');
    const here = unit.state.position;
    expect(Math.abs(here.y - heightAt(here.x, here.z))).toBeLessThan(0.3);
    expect(here.y).not.toBe(0);
  });
});
