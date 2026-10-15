import { describe, expect, it } from 'vitest';
import { forwardFromYaw, rightFromYaw, toRenderSpace } from './coordinates';

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 9);

describe('simulation coordinate convention', () => {
  it('faces +Z with the nose at yaw 0 and +X is right', () => {
    const forward = forwardFromYaw(0);
    close(forward.x, 0);
    close(forward.z, 1);
    const right = rightFromYaw(0);
    close(right.x, 1);
    close(right.z, 0);
  });

  it('turns right through +X when yaw increases by a quarter turn', () => {
    const forward = forwardFromYaw(Math.PI / 2);
    close(forward.x, 1);
    close(forward.z, 0);
    const right = rightFromYaw(Math.PI / 2);
    close(right.x, 0);
    close(right.z, -1);
  });

  it('defines right as forward rotated 90 degrees clockwise seen from above', () => {
    for (const yaw of [0, 0.4, 1.3, 2.9, -2.1]) {
      const right = rightFromYaw(yaw);
      const rotatedForward = forwardFromYaw(yaw + Math.PI / 2);
      close(right.x, rotatedForward.x);
      close(right.z, rotatedForward.z);
    }
  });

  it('keeps forward and right orthogonal unit vectors', () => {
    for (const yaw of [0, 0.7, 2.2, -1.5]) {
      const f = forwardFromYaw(yaw);
      const r = rightFromYaw(yaw);
      close(f.x * r.x + f.y * r.y + f.z * r.z, 0);
      close(Math.hypot(f.x, f.y, f.z), 1);
      close(Math.hypot(r.x, r.y, r.z), 1);
    }
  });
});

describe('toRenderSpace (the single render-boundary mirror)', () => {
  it('negates only Z and leaves X and Y unchanged', () => {
    expect(toRenderSpace({ x: 2, y: 3, z: 5 })).toEqual({ x: 2, y: 3, z: -5 });
  });

  it('is its own inverse', () => {
    const point = { x: -4, y: 1.5, z: 9 };
    expect(toRenderSpace(toRenderSpace(point))).toEqual(point);
  });
});
