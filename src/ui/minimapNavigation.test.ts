import { describe, expect, it } from 'vitest';
import { getMinimapNavigation, routeSegmentDrawable, setMinimapGarage, setMinimapRoute } from './minimapNavigation';
import type { NavigationRoute } from '../navigation/navigationPath';

describe('minimap navigation marks', () => {
  it('draws a segment only when both ends are on the view and close together', () => {
    expect(routeSegmentDrawable(10, 10, 20, 10, 220)).toBe(true);
    expect(routeSegmentDrawable(0, 0, 100, 0, 220)).toBe(true);
    expect(routeSegmentDrawable(0, 0, 111, 0, 220)).toBe(false);
    expect(routeSegmentDrawable(0, 0, 300, 0, 220)).toBe(false);
  });

  it('exposes the route and the garage ring, and clears them', () => {
    const route = { goal: { kind: 'career', label: 'x', laneId: 'a', s: 0, x: 0, z: 0 }, laneIds: ['a'], points: [{ x: 0, z: 0 }, { x: 1, z: 0 }], lengthMeters: 1 } as NavigationRoute;
    setMinimapRoute(route);
    setMinimapGarage({ x: 5, z: 6 });
    expect(getMinimapNavigation().route).toBe(route);
    expect(getMinimapNavigation().garage).toEqual({ x: 5, z: 6 });
    setMinimapRoute(null);
    setMinimapGarage(null);
    expect(getMinimapNavigation().route).toBeNull();
    expect(getMinimapNavigation().garage).toBeNull();
  });
});
