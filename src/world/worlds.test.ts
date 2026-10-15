import { describe, expect, it } from 'vitest';
import { getWorldDefinition, parseWorldId } from './worlds';
import { VEHICLE_SPAWN, VEHICLE_SPAWN_YAW_RADIANS } from '../config/simulationConfig';
import { validateRoadNetwork } from './roadValidation';

describe('parseWorldId', () => {
  it('defaults to the test circuit', () => {
    expect(parseWorldId('')).toBe('circuit');
    expect(parseWorldId('?world=circuit')).toBe('circuit');
    expect(parseWorldId('?world=anything')).toBe('circuit');
  });

  it('selects the legacy straight road with ?world=legacy', () => {
    expect(parseWorldId('?world=legacy')).toBe('legacy');
  });
});

describe('getWorldDefinition', () => {
  it('builds the circuit with a validated network, a boundary, and the network spawn', () => {
    const world = getWorldDefinition('circuit');
    expect(world.network).not.toBeNull();
    expect(world.boundary).not.toBeNull();
    expect(world.bounds).not.toBeNull();
    expect(validateRoadNetwork(world.network ?? { id: '', name: '', segments: [], connections: [], spawn: { position: { x: 0, y: 0, z: 0 }, yawRadians: 0 } }).valid).toBe(true);
    expect(world.spawn.position.x).toBeCloseTo(1.8, 9);
    expect(world.spawn.position.z).toBeCloseTo(6, 9);
  });

  it('keeps the legacy road as a reference: no network, no boundary, the original spawn', () => {
    const world = getWorldDefinition('legacy');
    expect(world.network).toBeNull();
    expect(world.boundary).toBeNull();
    expect(world.bounds).toBeNull();
    expect(world.spawn.position).toEqual(VEHICLE_SPAWN);
    expect(world.spawn.yawRadians).toBe(VEHICLE_SPAWN_YAW_RADIANS);
  });

  it('returns the same cached instance for the same id', () => {
    expect(getWorldDefinition('circuit')).toBe(getWorldDefinition('circuit'));
  });
});
