import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { Object3D, Vector3 } from 'three';
import { applyWorldOrigin } from './worldOrigin';
import { setRenderVectorFrom } from './renderSpace';

/**
 * The floating origin is checked through Three.js's own matrices. A mirrored root (scale z = -1) holds the world, and the
 * camera is placed with setRenderVectorFrom. The two must agree on where a simulation point appears on screen.
 */
function sceneRoot(): { root: Object3D; ground: Object3D; rootRef: ReturnType<typeof createRef<Object3D>>; groundRef: ReturnType<typeof createRef<Object3D>> } {
  const root = new Object3D();
  root.scale.set(1, 1, -1);
  const ground = new Object3D();
  const rootRef = createRef<Object3D>();
  const groundRef = createRef<Object3D>();
  rootRef.current = root;
  groundRef.current = ground;
  return { root, ground, rootRef, groundRef };
}

describe('floating origin', () => {
  it('places the car at the scene origin wherever it is on the torus', () => {
    const { root, ground, rootRef, groundRef } = sceneRoot();
    const origin = { x: 13_250.5, z: -7_801.25 };
    applyWorldOrigin({ root: rootRef, ground: groundRef }, origin);

    const car = new Object3D();
    car.position.set(origin.x, 0, origin.z);
    root.add(car);
    root.updateMatrixWorld(true);
    const at = car.getWorldPosition(new Vector3());
    expect(at.x).toBeCloseTo(0, 9);
    expect(at.z).toBeCloseTo(0, 9);
    expect(ground.position.x).toBeCloseTo(origin.x, 9);
  });

  it('agrees with the camera placement for any simulation point near the car', () => {
    const { root, rootRef, groundRef } = sceneRoot();
    const origin = { x: 5_000.75, z: 2_400 };
    applyWorldOrigin({ root: rootRef, ground: groundRef }, origin);

    const point = { x: origin.x + 37.5, y: 0.5, z: origin.z - 22.25 };
    const world = new Object3D();
    world.position.set(point.x, point.y, point.z);
    root.add(world);
    root.updateMatrixWorld(true);
    const inWorld = world.getWorldPosition(new Vector3());

    const camera = setRenderVectorFrom(new Vector3(), point, origin);
    expect(inWorld.x).toBeCloseTo(camera.x, 9);
    expect(inWorld.y).toBeCloseTo(camera.y, 9);
    expect(inWorld.z).toBeCloseTo(camera.z, 9);
  });

  it('is the identity for a finite world, which keeps the origin at zero', () => {
    const { root, rootRef, groundRef } = sceneRoot();
    applyWorldOrigin({ root: rootRef, ground: groundRef }, { x: 0, z: 0 });
    expect(root.position.length()).toBe(0);
    const v = setRenderVectorFrom(new Vector3(), { x: 3, y: 1, z: 7 }, { x: 0, z: 0 });
    expect(v.toArray()).toEqual([3, 1, -7]);
  });

  it('tolerates missing targets without throwing', () => {
    expect(() => applyWorldOrigin({ root: createRef<Object3D>(), ground: createRef<Object3D>() }, { x: 1, z: 1 })).not.toThrow();
  });
});
