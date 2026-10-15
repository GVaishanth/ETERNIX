import { describe, expect, it } from 'vitest';
import { buildCircuitNetwork } from './circuitNetwork';
import { buildRoadMeshData, ROAD_TEST_BLOCKS, type MeshBuffers } from './roadMeshData';
import { buildRoadBoundary, signedDistance } from '../simulation/roadBoundary';
import { NETWORK_BOUNDARY_HALF_WIDTH_METERS } from '../config/roadConfig';

const network = buildCircuitNetwork();
const boundary = buildRoadBoundary(network);
const data = buildRoadMeshData(network);

function sd(x: number, z: number): number {
  return signedDistance(boundary, x, z).distance;
}

function forEachVertex(buffers: MeshBuffers, visit: (x: number, y: number, z: number) => void): void {
  for (let i = 0; i < buffers.vertexCount; i += 1) {
    visit(buffers.positions[i * 3] ?? 0, buffers.positions[i * 3 + 1] ?? 0, buffers.positions[i * 3 + 2] ?? 0);
  }
}

describe('road surface', () => {
  it('keeps every asphalt vertex inside the drivable region', () => {
    let worst = -Infinity;
    forEachVertex(data.asphalt, (x, _y, z) => {
      worst = Math.max(worst, sd(x, z));
    });
    expect(worst).toBeLessThan(0.01);
  });

  it('keeps every shoulder vertex inside the drivable region', () => {
    let worst = -Infinity;
    forEachVertex(data.shoulders, (x, _y, z) => {
      worst = Math.max(worst, sd(x, z));
    });
    expect(worst).toBeLessThan(0.01);
  });

  it('keeps every marking vertex inside the drivable region', () => {
    let worst = -Infinity;
    for (const buffers of [data.markingsWhite, data.markingsYellow]) {
      forEachVertex(buffers, (x, _y, z) => {
        worst = Math.max(worst, sd(x, z));
      });
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('places markings above the asphalt and the shoulders below it (no z-fighting by construction)', () => {
    const minY = (buffers: MeshBuffers) => {
      let m = Infinity;
      forEachVertex(buffers, (_x, y) => {
        m = Math.min(m, y);
      });
      return m;
    };
    expect(minY(data.markingsWhite)).toBeGreaterThan(0);
    expect(minY(data.markingsYellow)).toBeGreaterThan(0);
    expect(minY(data.shoulders)).toBeLessThan(0);
  });

  it('stores normals that agree with each triangle winding, so no surface is culled by mistake', () => {
    for (const buffers of [data.asphalt, data.shoulders, data.markingsWhite, data.markingsYellow, data.guardrails]) {
      for (let t = 0; t < buffers.triangleCount; t += 1) {
        const ia = buffers.indices[t * 3] ?? 0;
        const ib = buffers.indices[t * 3 + 1] ?? 0;
        const ic = buffers.indices[t * 3 + 2] ?? 0;
        const p = (i: number) => [buffers.positions[i * 3] ?? 0, buffers.positions[i * 3 + 1] ?? 0, buffers.positions[i * 3 + 2] ?? 0] as const;
        const [ax, ay, az] = p(ia);
        const [bx, by, bz] = p(ib);
        const [cx, cy, cz] = p(ic);
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = cx - ax;
        const vy = cy - ay;
        const vz = cz - az;
        const gx = uy * vz - uz * vy;
        const gy = uz * vx - ux * vz;
        const gz = ux * vy - uy * vx;
        const nx = buffers.normals[ia * 3] ?? 0;
        const ny = buffers.normals[ia * 3 + 1] ?? 0;
        const nz = buffers.normals[ia * 3 + 2] ?? 0;
        expect(gx * nx + gy * ny + gz * nz).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});

describe('guardrails and posts', () => {
  it('places every guardrail vertex on the boundary (|sd| < 0.01)', () => {
    forEachVertex(data.guardrails, (x, _y, z) => {
      expect(Math.abs(sd(x, z))).toBeLessThan(0.01);
    });
  });

  it('places every post on the boundary', () => {
    expect(data.posts.length).toBeGreaterThan(100);
    for (const post of data.posts) {
      expect(Math.abs(sd(post.position.x, post.position.z))).toBeLessThan(0.01);
    }
  });

  it('keeps guardrails off the open junction (no rail vertex inside the pad square)', () => {
    const pad = { minX: -190.2 + 0.01, maxX: -169.8 - 0.01, minZ: 249.8 + 0.01, maxZ: 270.2 - 0.01 };
    forEachVertex(data.guardrails, (x, _y, z) => {
      const inside = x > pad.minX && x < pad.maxX && z > pad.minZ && z < pad.maxZ;
      expect(inside).toBe(false);
    });
  });

  it('keeps the guardrail top at the configured height', () => {
    let top = 0;
    forEachVertex(data.guardrails, (_x, y) => {
      top = Math.max(top, y);
    });
    expect(top).toBeCloseTo(0.7, 6);
  });
});

describe('props and bounds', () => {
  it('keeps every test block clear of the road (every corner at least 5 m outside)', () => {
    for (const block of ROAD_TEST_BLOCKS) {
      const hw = block.widthMeters / 2;
      const hd = block.depthMeters / 2;
      for (const dx of [-hw, hw]) {
        for (const dz of [-hd, hd]) {
          expect(sd(block.centre.x + dx, block.centre.z + dz)).toBeGreaterThan(5);
        }
      }
    }
  });

  it('keeps the bounded mesh budget (triangles and vertices)', () => {
    const total = [data.asphalt, data.shoulders, data.markingsWhite, data.markingsYellow, data.guardrails].reduce((sum, b) => sum + b.triangleCount, 0);
    expect(total).toBeGreaterThan(1000);
    expect(total).toBeLessThan(60000);
  });

  it('has a visible start line across every lane at z = 0', () => {
    let found = false;
    forEachVertex(data.markingsWhite, (x, y, z) => {
      if (Math.abs(z) < 0.31 && Math.abs(x) > 7 && Math.abs(x) < 7.3 && y > 0) found = true;
    });
    expect(found).toBe(true);
  });

  it('keeps the boundary half width used for guardrails and shoulders', () => {
    expect(NETWORK_BOUNDARY_HALF_WIDTH_METERS).toBeCloseTo(10.2, 9);
  });
});

describe('determinism', () => {
  it('builds identical buffers from the same network', () => {
    const again = buildRoadMeshData(buildCircuitNetwork());
    expect(again.asphalt.vertexCount).toBe(data.asphalt.vertexCount);
    expect(again.markingsWhite.triangleCount).toBe(data.markingsWhite.triangleCount);
    expect(again.guardrails.positions.reduce((a, b) => a + b, 0)).toBeCloseTo(data.guardrails.positions.reduce((a, b) => a + b, 0), 6);
    expect(again.posts.length).toBe(data.posts.length);
  });
});
