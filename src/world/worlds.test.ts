import { describe, expect, it } from 'vitest';
import { CITY_SPAWN } from './city/cityLayout';
import { getWorldDefinition, parseWorldId } from './worlds';

/*
 * World registry (Part 5). The city is the default. The circuit and the legacy road stay reachable as regressions.
 */

describe('world registry', () => {
  it('defaults to the city, and keeps the circuit and legacy worlds reachable', () => {
    expect(parseWorldId('')).toBe('loop');
    expect(parseWorldId('?traffic=off')).toBe('loop');
    expect(parseWorldId('?world=city')).toBe('city');
    expect(parseWorldId('?world=circuit')).toBe('circuit');
    expect(parseWorldId('?world=legacy')).toBe('legacy');
    expect(parseWorldId('?world=loop')).toBe('loop');
    expect(parseWorldId('?world=unknown')).toBe('loop');
  });

  it('builds the city with its spawn, traffic scenario, and scenery', () => {
    const city = getWorldDefinition('city');
    expect(city.network?.id).toBe('city');
    expect(city.spawn.position).toEqual(CITY_SPAWN.position);
    expect(city.city).not.toBeNull();
    expect(city.opponents).toEqual([]);
    expect(city.trafficScenario.length).toBeGreaterThan(0);
    for (const request of city.trafficScenario) {
      expect(city.lanes?.byId.has(request.laneId), request.laneId).toBe(true);
    }
  });

  it('keeps the circuit world unchanged: no city extras', () => {
    const circuit = getWorldDefinition('circuit');
    expect(circuit.city).toBeNull();
    expect(circuit.network?.segments).toHaveLength(12);
  });
});
