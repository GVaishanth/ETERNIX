import { describe, expect, it } from 'vitest';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { CAREER_EVENTS } from '../career/careerCatalogue';
import { buildLaneGraph, laneSample } from '../traffic/laneGraph';
import { buildCityNetwork, buildLoopCityNetwork } from '../world/city/cityNetwork';
import { careerGoal, garageGoal } from './navigationGoal';
import { buildNavigationRoute, nearestLane, NAVIGATION_SAMPLE_METERS, type NavigationRoute } from './navigationPath';

/*
 * Navigation routes on the lane graph. The loop cases check that a route across the seam is continuous in logical
 * coordinates, so it never jumps back by a period.
 */

const PERIOD = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
const loopNetwork = buildLoopCityNetwork();
const finiteNetwork = buildCityNetwork();
const loopGraph = buildLaneGraph(loopNetwork);
const finiteGraph = buildLaneGraph(finiteNetwork);

/** Largest distance between consecutive route points, metres. A jump across the seam would show here. */
function largestStep(route: NavigationRoute): number {
  let largest = 0;
  for (let i = 1; i < route.points.length; i += 1) {
    const a = route.points[i - 1];
    const b = route.points[i];
    if (a && b) largest = Math.max(largest, Math.hypot(b.x - a.x, b.z - a.z));
  }
  return largest;
}

/**
 * Every lane follows a successor edge, except one allowed turn-around: the first hop may go to the opposite lane of the
 * car's own segment (the same owner, the other direction). That is the only way from one circuit to the other.
 */
function expectDrivable(route: NavigationRoute, graph: ReturnType<typeof buildLaneGraph>): void {
  for (let i = 1; i < route.laneIds.length; i += 1) {
    const from = graph.byId.get(route.laneIds[i - 1] ?? '');
    const to = graph.byId.get(route.laneIds[i] ?? '');
    const turnAround = i === 1 && from !== undefined && to !== undefined && to.ownerId === from.ownerId && to.direction !== from.direction;
    if (turnAround) continue;
    expect(from?.successorIds ?? [], `lane ${i}`).toContain(route.laneIds[i]);
  }
}

describe('nearest lane', () => {
  it('finds a point on a lane at distance zero', () => {
    const lane = loopGraph.lanes.find((candidate) => candidate.id === 'H-0-0:F:0');
    expect(lane).toBeDefined();
    const hit = nearestLane(loopGraph, 0, 0);
    expect(hit).not.toBeNull();
    expect(hit?.distance ?? Infinity).toBeLessThan(20);
  });
});

describe('navigation to career events', () => {
  for (const [name, graph, network] of [
    ['finite city', finiteGraph, finiteNetwork],
    ['loop', loopGraph, loopNetwork],
  ] as const) {
    it(`routes from the spawn to every career race marker on the ${name}, drivably and without jumps`, () => {
      const car = { x: network.spawn.position.x, z: network.spawn.position.z };
      const raced = CAREER_EVENTS.filter((event) => event.raceEventId !== '');
      expect(raced.length).toBeGreaterThan(0);
      for (const event of raced) {
        const goal = careerGoal(graph, event.id);
        expect(goal, `${event.id} goal`).not.toBeNull();
        if (goal === null) continue;
        const route = buildNavigationRoute(graph, car, name === 'loop' ? PERIOD : null, goal);
        expect(route, `${event.id} route`).not.toBeNull();
        if (route === null) continue;
        expect(route.points[0]).toEqual(car);
        expect(largestStep(route), `${event.id} step`).toBeLessThan(NAVIGATION_SAMPLE_METERS + 3);
        expectDrivable(route, graph);
        expect(route.lengthMeters).toBeGreaterThan(0);
      }
    });
  }
});

describe('navigation across the loop seam', () => {
  it('a car just east of the seam is routed west through it, continuing past the seam in logical coordinates', () => {
    // Row z = -201.8 is the east-west street. At 2800 m the seam is at x = 1600, which is base -1200. The car is at
    // logical x 1500, just west of the seam. The goal is at base x -1000, which is logical 1800: 300 m to the east,
    // through the seam.
    const car = { x: 1500, z: -201.8 };
    const goal = garageGoal(loopGraph, { x: -1000, z: -201.8 });
    expect(goal).not.toBeNull();
    if (goal === null) return;
    const route = buildNavigationRoute(loopGraph, car, PERIOD, goal);
    expect(route).not.toBeNull();
    if (route === null) return;
    expectDrivable(route, loopGraph);
    expect(largestStep(route)).toBeLessThan(NAVIGATION_SAMPLE_METERS + 3);
    const last = route.points[route.points.length - 1];
    // The goal is at base -1000 (lane point). Continuing east in logical coordinates, the same point is at 1800.
    expect(last?.x ?? 0).toBeGreaterThan(1700);
    expect(last?.x ?? 0).toBeLessThan(1900);
    // The route is about the logical distance, not the 2600 m the other way round.
    expect(route.lengthMeters).toBeGreaterThan(200);
    expect(route.lengthMeters).toBeLessThan(400);
  });
});

describe('navigation destinations', () => {
  it('gives every career event its own destination: no two are within 30 m of each other on the loop', () => {
    const points: { id: string; x: number; z: number }[] = [];
    for (const event of CAREER_EVENTS) {
      const goal = careerGoal(loopGraph, event.id);
      if (goal === null) continue;
      points.push({ id: event.id, x: goal.x, z: goal.z });
    }
    expect(points.length).toBeGreaterThan(1);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]!;
        const b = points[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.id} vs ${b.id}`).toBeGreaterThan(30);
      }
    }
  });

  it('routes from a car on a reverse lane: it turns round once on its own segment, then follows the other circuit', () => {
    // Race markers and the reverse lanes are one circuit; the grid and the garage are on the other. A car on a reverse
    // lane must still get a route to the garage.
    const lane = loopGraph.byId.get('H-0-0:R:1');
    expect(lane).toBeDefined();
    if (!lane) return;
    const pose = laneSample(lane, 40);
    const car = { x: pose.x, z: pose.z };
    const goal = garageGoal(loopGraph, loopNetwork.spawn.position);
    expect(goal).not.toBeNull();
    if (goal === null) return;
    const route = buildNavigationRoute(loopGraph, car, PERIOD, goal);
    expect(route).not.toBeNull();
    if (route === null) return;
    // The route starts on the forward lane of the car's own segment: the turn-around is the first step, from the car to it.
    expect(route.laneIds[0]?.startsWith('H-0-0:F:')).toBe(true);
    expectDrivable(route, loopGraph);
    // The turn-around crosses the road to the opposite lane: a step of a lane width or two, not a jump along the road.
    expect(largestStep(route)).toBeLessThan(NAVIGATION_SAMPLE_METERS + 8);
  });
});

