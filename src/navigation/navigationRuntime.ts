import { distanceOnWorld } from '../garage/garageGate';
import type { LaneGraph } from '../traffic/laneGraph';
import { buildNavigationRoute, type NavigationGoal, type NavigationPoint, type NavigationRoute } from './navigationPath';

/*
 * The navigation route for the car, updated at a low rate. Pure: the caller passes the car's position each frame and
 * receives a callback when the route geometry must change. Nothing is computed per frame.
 */

export const NAVIGATION_RECOMPUTE_SECONDS = 1;
/** The route is rebuilt once the car has moved this far from where the current geometry started, so the part behind the car is trimmed. */
export const NAVIGATION_REBUILD_METERS = 15;
/** Within this distance of the goal the route is cleared: the car has arrived. */
export const NAVIGATION_ARRIVED_METERS = 8;

export interface NavigationWorld {
  readonly lanes: LaneGraph;
  readonly periodMeters: number | null;
  /** Garage entrance position, or null where the world has no garage. */
  readonly garage: { readonly position: { readonly x: number; readonly z: number } } | null;
}

export type NavigationGoalSource = (graph: LaneGraph, garage: NavigationWorld['garage']) => NavigationGoal | null;

/** What the DEV debug read-out reports about the current route. Plain values, no geometry. */
export interface NavigationReadout {
  readonly goalKind: NavigationGoal['kind'];
  readonly goalLabel: string;
  readonly laneCount: number;
  readonly pointCount: number;
  readonly lengthMeters: number;
  readonly start: NavigationPoint;
  readonly end: NavigationPoint;
}

export function readoutOf(route: NavigationRoute | null): NavigationReadout | null {
  if (route === null || route.points.length < 2) return null;
  const first = route.points[0];
  const last = route.points[route.points.length - 1];
  if (!first || !last) return null;
  return {
    goalKind: route.goal.kind,
    goalLabel: route.goal.label,
    laneCount: route.laneIds.length,
    pointCount: route.points.length,
    lengthMeters: route.lengthMeters,
    start: { x: first.x, z: first.z },
    end: { x: last.x, z: last.z },
  };
}

export interface NavigationRouteListener {
  (route: NavigationRoute | null): void;
}

function sameLanes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export class NavigationRuntime {
  private route: NavigationRoute | null = null;
  private timer = 0;
  private goalKey: string | null = null;
  private builtAt: NavigationPoint | null = null;

  constructor(
    private readonly world: NavigationWorld,
    private readonly goalSource: NavigationGoalSource,
    private readonly onRoute: NavigationRouteListener,
  ) {}

  /** The current route, or null when there is none. */
  get current(): NavigationRoute | null {
    return this.route;
  }

  /** Per frame. Does work at most once per NAVIGATION_RECOMPUTE_SECONDS of simulated time. */
  update(seconds: number, car: NavigationPoint): void {
    this.timer -= seconds;
    if (this.timer > 0) return;
    this.timer = NAVIGATION_RECOMPUTE_SECONDS;
    this.recompute(car);
  }

  private recompute(car: NavigationPoint): void {
    const goal = this.goalSource(this.world.lanes, this.world.garage);
    if (goal === null) {
      this.setRoute(null, car);
      return;
    }
    const goalKey = `${goal.kind}:${goal.laneId}:${goal.s.toFixed(1)}`;
    const goalPoint = { x: goal.x, z: goal.z };
    if (distanceOnWorld(car, goalPoint, this.world.periodMeters) <= NAVIGATION_ARRIVED_METERS) {
      this.goalKey = goalKey;
      this.setRoute(null, car);
      return;
    }
    const next = buildNavigationRoute(this.world.lanes, car, this.world.periodMeters, goal);
    if (next === null) {
      this.goalKey = goalKey;
      this.setRoute(null, car);
      return;
    }
    const current = this.route;
    const unchanged =
      current !== null && goalKey === this.goalKey && sameLanes(current.laneIds, next.laneIds) && this.builtAt !== null &&
      distanceOnWorld(car, this.builtAt, this.world.periodMeters) < NAVIGATION_REBUILD_METERS;
    this.goalKey = goalKey;
    if (unchanged) return;
    this.setRoute(next, car);
  }

  private setRoute(route: NavigationRoute | null, car: NavigationPoint): void {
    if (route === null && this.route === null) return;
    this.route = route;
    this.builtAt = route === null ? null : { x: car.x, z: car.z };
    this.onRoute(route);
  }
}
