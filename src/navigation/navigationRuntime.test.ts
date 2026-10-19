import { describe, expect, it } from 'vitest';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { garageGoal } from './navigationGoal';
import { NAVIGATION_RECOMPUTE_SECONDS, NavigationRuntime, type NavigationWorld } from './navigationRuntime';
import type { NavigationGoal, NavigationRoute } from './navigationPath';

/*
 * The navigation runtime: low-rate recompute, geometry rebuilt only when the route changes, arrival clears the route.
 */

const network = buildCityNetwork();
const graph = buildLaneGraph(network);
const world: NavigationWorld = { lanes: graph, periodMeters: null, garage: null };
const spawn = { x: network.spawn.position.x, z: network.spawn.position.z };
/** A goal 300 m east of the spawn, on the lane nearest that point. */
const goal: NavigationGoal | null = garageGoal(graph, { x: spawn.x + 300, z: spawn.z });

function harness(goalSource: () => NavigationGoal | null = () => goal) {
  const routes: (NavigationRoute | null)[] = [];
  let goalCalls = 0;
  const runtime = new NavigationRuntime(world, () => {
    goalCalls += 1;
    return goalSource();
  }, (route) => routes.push(route));
  return { runtime, routes, calls: () => goalCalls };
}

describe('navigation runtime', () => {
  it('builds a route on the first update, then waits for the recompute interval', () => {
    const { runtime, routes, calls } = harness();
    runtime.update(0.016, spawn);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.goal.kind).toBe('garage');
    const before = calls();
    runtime.update(0.016, spawn);
    runtime.update(0.016, spawn);
    expect(calls()).toBe(before);
    expect(routes).toHaveLength(1);
  });

  it('does not rebuild the geometry while the car stays on the same lanes and close to where it started', () => {
    const { runtime, routes } = harness();
    runtime.update(0.016, spawn);
    runtime.update(NAVIGATION_RECOMPUTE_SECONDS, { x: spawn.x + 2, z: spawn.z });
    expect(routes).toHaveLength(1);
  });

  it('rebuilds the geometry once the car has moved far enough to trim the part behind it', () => {
    const { runtime, routes } = harness();
    runtime.update(0.016, spawn);
    const moved = { x: spawn.x + 40, z: spawn.z };
    runtime.update(NAVIGATION_RECOMPUTE_SECONDS + 0.1, moved);
    expect(routes.length).toBeGreaterThan(1);
    const latest = routes[routes.length - 1];
    expect(latest?.points[0]).toEqual(moved);
  });

  it('clears the route when there is no goal, and does not report a second clear', () => {
    const { runtime, routes } = harness(() => null);
    runtime.update(0.016, spawn);
    expect(routes).toEqual([]);
    expect(runtime.current).toBeNull();
  });

  it('clears the route on arrival', () => {
    const arrived = garageGoal(graph, spawn);
    expect(arrived).not.toBeNull();
    const { runtime, routes } = harness(() => arrived);
    runtime.update(0.016, spawn);
    expect(routes).toEqual([]);
    expect(runtime.current).toBeNull();
  });
});
