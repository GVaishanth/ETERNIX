import { describe, expect, it } from 'vitest';
import { WORLD_STREAMING_CONFIG } from '../../config/worldStreamingConfig';
import { buildCityNetwork } from '../city/cityNetwork';
import { CITY_SPAWN } from '../city/cityLayout';
import { chunkKey, chunkOfPoint, distanceToChunk } from './chunkGrid';
import { WorldStreamer, type StreamPose } from './streamer';
import { chunkDetail, chunkPriority, selectChunks } from './wantedChunks';
import { buildWorldIndex, chunksTouchedBy } from './worldIndex';

const CFG = WORLD_STREAMING_CONFIG;
const SIZE = CFG.chunkSizeMeters;
const network = buildCityNetwork();
const index = buildWorldIndex(network, SIZE);

function poseAt(x: number, z: number, forward = { x: 1, z: 0 }, speedMps = 0): StreamPose {
  return { x, z, forward, speedMps };
}

/** Completes every LOADING chunk, as a renderer that builds instantly would. */
function settle(streamer: WorldStreamer): void {
  for (const chunk of streamer.mountedChunks()) streamer.complete(chunk.key);
}

describe('wanted chunks', () => {
  it('loads a footprint owner whenever the footprint touches a near chunk (boundary alignment)', () => {
    // A point on the x = 400 boundary, at rest, so the near set is the chunks within the load radius.
    const point = { x: 400, z: -1.8 };
    const wanted = selectChunks(index, point, CFG.loadRadiusMeters);
    for (const footprint of index.footprints) {
      const touches = chunksTouchedBy(footprint, SIZE).some((c) => distanceToChunk(point.x, point.z, c, SIZE) === 0);
      if (touches) expect(wanted.has(footprint.owner), footprint.segmentId).toBe(true);
    }
  });

  it('never leaves a segment owner out when a road it touches is near', () => {
    for (const probe of [CITY_SPAWN.position, { x: 0, z: 0 }, { x: 396, z: 204 }]) {
      const radius = 260;
      const wanted = selectChunks(index, probe, radius);
      // The near chunks themselves, by distance. Owners added by the closure are not near chunks.
      const near = new Set<string>();
      for (const [key, coord] of index.chunks) {
        if (distanceToChunk(probe.x, probe.z, coord, SIZE) <= radius) near.add(key);
      }
      for (const footprint of index.footprints) {
        const touchesNear = chunksTouchedBy(footprint, SIZE).some((c) => near.has(chunkKey(c)));
        if (touchesNear) expect(wanted.has(footprint.owner), `${footprint.segmentId} near ${probe.x},${probe.z}`).toBe(true);
      }
    }
  });

  it('grows the wanted set with radius and always contains the player chunk', () => {
    const small = selectChunks(index, CITY_SPAWN.position, 100);
    const large = selectChunks(index, CITY_SPAWN.position, 800);
    expect(large.size).toBeGreaterThan(small.size);
    expect(small.has(chunkKey({ kx: Math.floor(CITY_SPAWN.position.x / SIZE), kz: Math.floor(CITY_SPAWN.position.z / SIZE) }))).toBe(true);
  });

  it('gives chunks ahead of the car a lower priority than chunks behind at the same distance', () => {
    const point = { x: 0, z: 0 };
    const ahead = chunkPriority(index, { kx: 0, kz: 1 }, point, { x: 0, z: 1 }, 0.6);
    const behind = chunkPriority(index, { kx: 0, kz: -2 }, point, { x: 0, z: 1 }, 0.6);
    expect(ahead).toBeLessThan(behind);
    // At the chunk's own centre the priority is zero.
    expect(chunkPriority(index, { kx: 0, kz: 0 }, { x: 200, z: 200 }, { x: 0, z: 1 }, 0.6)).toBe(0);
  });

  it('switches detail with hysteresis, so a chunk on the edge does not flip', () => {
    // Chunk kx = 2 starts at x = 800. A point at x = 330, z = 200 is exactly 470 m from it.
    const coord = { kx: 2, kz: 0 };
    const at470 = { x: 330, z: 200 };
    expect(distanceToChunk(at470.x, at470.z, coord, SIZE)).toBeCloseTo(470, 9);
    const r = CFG.sceneryRadiusMeters;
    const m = CFG.sceneryMarginMeters;
    // 470 m is inside the band (460 to 540): a full chunk stays full, and a roads-only chunk stays roads-only.
    expect(chunkDetail(index, coord, at470, r, m, 'full')).toBe('full');
    expect(chunkDetail(index, coord, at470, r, m, 'roads')).toBe('roads');
    // Outside the band, the detail changes. Full becomes roads beyond r + m, and roads becomes full inside r - m.
    expect(chunkDetail(index, coord, { x: 200, z: 200 }, r, m, 'full')).toBe('roads');
    expect(chunkDetail(index, coord, { x: 600, z: 200 }, r, m, 'roads')).toBe('full');
  });
});

describe('world streamer on the city', () => {
  it('drives the spawn east for 2 km without duplicates, gaps, or an overfull active set', () => {
    const streamer = new WorldStreamer(index);
    const speed = 20;
    const step = 0.5;
    for (let t = 0; t < 2000 / (speed * step); t += 1) {
      const x = CITY_SPAWN.position.x + speed * step * t;
      const z = CITY_SPAWN.position.z;
      streamer.update(poseAt(x, z, { x: 1, z: 0 }, speed));
      settle(streamer);
      // The renderer releases chunks it has unloaded on each sync. Without that, unloading chunks keep their budget
      // slots and the active set fills up behind the car.
      for (const key of index.chunks.keys()) streamer.released(key);
      const mounted = streamer.mountedChunks().map((c) => c.key);
      expect(new Set(mounted).size, `duplicates at ${x}`).toBe(mounted.length);
      expect(mounted.length).toBeLessThanOrEqual(CFG.maxActiveChunks);
      // Every road that passes through the car's own position must have its owner mounted.
      for (const footprint of index.footprints) {
        const inside = x >= footprint.minX && x <= footprint.maxX && z >= footprint.minZ && z <= footprint.maxZ;
        if (inside) expect(mounted.includes(footprint.owner), `${footprint.segmentId} at ${x}`).toBe(true);
      }
    }
    expect(streamer.stats().started).toBeGreaterThan(index.chunks.size / 2);
  });

  it('unloads chunks far behind after a teleport and releases their records', () => {
    const streamer = new WorldStreamer(index);
    streamer.update(poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z));
    settle(streamer);
    const before = streamer.mountedChunks().length;
    expect(before).toBeGreaterThan(0);
    // North-east, well outside the keep radius of every chunk at the spawn.
    const far = { x: 1000, z: 1000 };
    streamer.update(poseAt(far.x, far.z));
    expect(streamer.stats().unloading).toBeGreaterThan(0);
    // The renderer removes unloading chunks on its next sync, then reports each release.
    for (const key of [...index.chunks.keys()]) streamer.released(key);
    expect(streamer.stats().unloading).toBe(0);
    expect(streamer.stats().unloaded).toBeGreaterThan(0);
    // Every mounted chunk is within the keep radius of the player, so nothing from the old area is held.
    const keep = streamer.stats().keepRadiusMeters;
    for (const chunk of streamer.mountedChunks()) {
      expect(distanceToChunk(far.x, far.z, chunk.coord, SIZE)).toBeLessThanOrEqual(keep);
    }
  });

  it('spends the larger start budget after a teleport, and no more', () => {
    const streamer = new WorldStreamer(index);
    streamer.update(poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z));
    const before = streamer.stats().started;
    streamer.update(poseAt(-700, 700));
    const started = streamer.stats().started - before;
    expect(started).toBeLessThanOrEqual(CFG.teleportStartsPerUpdate);
    expect(streamer.stats().teleports).toBe(1);
  });

  it('keeps a pinned chunk loaded far from the player, and releases it when unpinned', () => {
    const streamer = new WorldStreamer(index);
    // The north-east corner of the city. Far outside the load radius at the spawn.
    const far = chunkKey({ kx: 2, kz: 2 });
    expect(index.chunks.has(far)).toBe(true);
    streamer.setPins('race', [far]);
    const spawn = poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z);
    // Start budget is two per update, so give the streamer several updates to settle.
    for (let i = 0; i < 40; i += 1) {
      streamer.update(spawn);
      settle(streamer);
    }
    expect(streamer.mountedChunks().some((c) => c.key === far)).toBe(true);
    streamer.releasePins('race');
    streamer.update(spawn);
    expect(streamer.stats().pinnedChunks).toBe(0);
  });

  it('ignores a pin on a chunk that is not part of this world', () => {
    const streamer = new WorldStreamer(index);
    streamer.setPins('race', [chunkKey({ kx: 60, kz: 60 })]);
    expect(streamer.stats().pinnedChunks).toBe(0);
  });

  it('starts the chunks under the car at once, even when distant chunks wait for the budget', () => {
    const streamer = new WorldStreamer(index);
    const at = poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z);
    streamer.update(at);
    const mounted = new Set(streamer.mountedChunks().map((c) => c.key));
    expect(mounted.has(chunkKey(chunkOfPoint(at.x, at.z, SIZE)))).toBe(true);
    for (const footprint of index.footprints) {
      const inside = at.x >= footprint.minX && at.x <= footprint.maxX && at.z >= footprint.minZ && at.z <= footprint.maxZ;
      if (inside) expect(mounted.has(footprint.owner), footprint.segmentId).toBe(true);
    }
    // Ordinary chunks are still limited to the start budget on this first update.
    expect(streamer.stats().loading).toBeLessThanOrEqual(Math.max(CFG.maxConcurrentLoads, mounted.size));
    expect(streamer.stats().queued).toBeGreaterThan(0);
  });

  it('notifies subscribers only when the mounted set changes', () => {
    const streamer = new WorldStreamer(index);
    let calls = 0;
    streamer.subscribe(() => {
      calls += 1;
    });
    streamer.update(poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z));
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThan(0);
    streamer.update(poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z));
    expect(calls).toBe(afterFirst);
  });

  it('retries a failed chunk and reports its error', () => {
    const streamer = new WorldStreamer(index);
    streamer.update(poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z));
    const first = streamer.mountedChunks()[0];
    if (!first) throw new Error('nothing mounted at the spawn');
    expect(streamer.fail(first.key, 'build failed')).toBe(true);
    expect(streamer.errorOf(first.key)).toBe('build failed');
    streamer.update(poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z));
    expect(streamer.mountedChunks().some((c) => c.key === first.key)).toBe(true);
  });

  it('disposes cleanly and then ignores updates', () => {
    const streamer = new WorldStreamer(index);
    streamer.update(poseAt(CITY_SPAWN.position.x, CITY_SPAWN.position.z));
    streamer.dispose();
    streamer.update(poseAt(0, 0));
    expect(streamer.mountedChunks()).toEqual([]);
  });
});
