/*
 * Automated tests for the Part 10 render-side helpers that run without a browser: the asphalt registry (weather-driven
 * roughness, registration and unregistration), the bounded rain field, and the bounded tire-smoke field. Three.js
 * objects are created but never rendered, so the tests need no WebGL.
 */
import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, Vector3 } from 'three';
import { ASPHALT_ROUGHNESS } from '../config/environmentConfig';
import { QUALITY_PRESETS } from '../config/qualityConfig';
import { applyAsphaltWetness, registerAsphalt, registeredAsphaltCount } from './surfaceRegistry';
import { RainField } from './rainField';
import { effectFeed } from './effectFeed';
import { TireSmokeField } from './tireSmokeField';

describe('asphalt registry', () => {
  it('applies wetness to every registered material and stops once unregistered', () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    const removeA = registerAsphalt(a);
    const removeB = registerAsphalt(b);
    expect(registeredAsphaltCount()).toBeGreaterThanOrEqual(2);
    const withBoth = registeredAsphaltCount();

    applyAsphaltWetness(1);
    expect(a.roughness).toBeCloseTo(ASPHALT_ROUGHNESS.wet, 6);
    expect(b.roughness).toBeCloseTo(ASPHALT_ROUGHNESS.wet, 6);

    removeA();
    applyAsphaltWetness(0);
    expect(a.roughness).toBeCloseTo(ASPHALT_ROUGHNESS.wet, 6);
    expect(b.roughness).toBeCloseTo(ASPHALT_ROUGHNESS.dry, 6);

    removeB();
    expect(registeredAsphaltCount()).toBe(withBoth - 2);
  });

  it('gives a newly registered material the current wetness, never a stale dry look', () => {
    applyAsphaltWetness(1);
    const late = new MeshStandardMaterial();
    const remove = registerAsphalt(late);
    expect(late.roughness).toBeCloseTo(ASPHALT_ROUGHNESS.wet, 6);
    remove();
    applyAsphaltWetness(0);
  });
});

describe('RainField', () => {
  it('stays hidden with no wetness, and shows the wet count with wetness', () => {
    const field = new RainField(50);
    field.update(new Vector3(), 0, 0, 50);
    expect(field.object.visible).toBe(false);
    field.update(new Vector3(), 0, 1, 50);
    expect(field.object.visible).toBe(true);
    expect(field.object.geometry.drawRange.count).toBe(100);
    field.dispose();
  });

  it('never draws more streaks than its allocated capacity, whatever the budget asks for', () => {
    const field = new RainField(50);
    field.update(new Vector3(), 1, 1, 100_000);
    expect(field.object.geometry.drawRange.count).toBe(100);
    field.dispose();
  });

  it('keeps every streak inside the field around the camera', () => {
    const field = new RainField(200);
    const camera = new Vector3(500, 0, -300);
    field.update(camera, 3.7, 1, 200);
    const array = field.object.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < 200 * 2; i += 1) {
      const x = array[i * 3] ?? 0;
      const z = array[i * 3 + 2] ?? 0;
      expect(Math.abs(x - 500)).toBeLessThanOrEqual(400);
      expect(Math.abs(z + 300)).toBeLessThanOrEqual(400);
    }
    field.dispose();
  });
});

describe('TireSmokeField', () => {
  const feedSlipping = { ...effectFeed, active: true, speed: 20, lateralSpeed: 12, throttle: 0.8 };

  it('emits up to the quality budget and never beyond it', () => {
    const field = new TireSmokeField(QUALITY_PRESETS.high.smokeParticles, QUALITY_PRESETS.low.smokeParticles);
    field.update(0.1, feedSlipping);
    expect(field.object.count).toBe(QUALITY_PRESETS.low.smokeParticles);
    field.setCapacity(QUALITY_PRESETS.high.smokeParticles);
    for (let i = 0; i < 200; i += 1) field.update(0.05, feedSlipping);
    expect(field.object.count).toBe(QUALITY_PRESETS.high.smokeParticles);
    // Live particles are bounded by the budget, however long the slip lasts.
    expect(field.liveParticles()).toBeLessThanOrEqual(QUALITY_PRESETS.high.smokeParticles);
    expect(field.liveParticles()).toBeGreaterThan(0);
    field.dispose();
  });

  it('emits no particles without real slip, handbrake, or wheelspin', () => {
    const field = new TireSmokeField(72, 72);
    field.update(0.5, { ...effectFeed, active: true, speed: 20, lateralSpeed: 0, throttle: 0, handbrake: false });
    expect(field.liveParticles()).toBe(0);
    field.update(0.5, { ...effectFeed, active: true, speed: 20, lateralSpeed: 0, throttle: 0, handbrake: true });
    expect(field.liveParticles()).toBeGreaterThan(0);
    field.dispose();
  });

  it('emits nothing when stopped, even with the handbrake on', () => {
    const field = new TireSmokeField(72, 72);
    field.update(0.5, { ...effectFeed, active: true, speed: 0, lateralSpeed: 0, throttle: 1, handbrake: true });
    expect(field.liveParticles()).toBe(0);
    field.dispose();
  });

  it('hides everything when the feed is inactive or the budget is zero', () => {
    const field = new TireSmokeField(72, 0);
    field.update(0.5, feedSlipping);
    expect(field.object.count).toBe(0);
    field.setCapacity(36);
    field.update(0.5, { ...feedSlipping, active: false });
    expect(field.object.count).toBe(0);
    field.dispose();
  });

  it('clamps a capacity request to the mesh size', () => {
    const field = new TireSmokeField(10, 0);
    field.setCapacity(999);
    field.update(0.1, feedSlipping);
    expect(field.object.count).toBe(10);
    field.dispose();
  });
});
