import type { NavigationRoute } from '../navigation/navigationPath';

/*
 * Navigation marks for the minimap (plain mutable values, read in the minimap's own draw loop, like the race marks).
 * The route is written when it changes, not per frame. Simulation coordinates: x east, z north.
 */

let route: NavigationRoute | null = null;
let garage: { x: number; z: number } | null = null;

export function setMinimapRoute(next: NavigationRoute | null): void {
  route = next;
}

export function setMinimapGarage(point: { x: number; z: number } | null): void {
  garage = point;
}

export interface MinimapNavigation {
  readonly route: NavigationRoute | null;
  readonly garage: { x: number; z: number } | null;
}

const view: { route: NavigationRoute | null; garage: { x: number; z: number } | null } = { route, garage };

/** Read-only view for the minimap. */
export function getMinimapNavigation(): MinimapNavigation {
  view.route = route;
  view.garage = garage;
  return view;
}

/**
 * A route segment is drawn only when both ends are on the minimap's view and close together. On a loop, a segment
 * that spans the far side of the view would cross the whole map, so it is skipped.
 */
export function routeSegmentDrawable(ax: number, ay: number, bx: number, by: number, sizePx: number): boolean {
  return Math.hypot(bx - ax, by - ay) <= sizePx / 2;
}
