import { describe, expect, it } from 'vitest';
import { WORLD_STREAMING_CONFIG } from '../../config/worldStreamingConfig';
import { buildCityNetwork, buildLoopCityNetwork } from '../city/cityNetwork';
import { CITY_SPAWN } from '../city/cityLayout';
import { chunkKey, chunkOfPoint, parseChunkKey } from './chunkGrid';
import { canonicalChunk, logicalChunk } from './periodicChunks';
import { WorldStreamer, type StreamPose } from './streamer';
import { aheadSamples, countUnloadedAhead, type PlanarPoint } from './streamingGaps';
import { chunkPriority, selectChunks } from './wantedChunks';
import { buildWorldIndex, type WorldIndex } from './worldIndex';

/*
 * Stage C: streaming across the seams of the looping world. Everything here drives the real WorldStreamer. The renderer is
 * simulated: a chunk the streamer mounts becomes built after a fixed number of frames, then the simulated renderer reports
 * it complete. Build time is therefore a parameter, not a measurement. Speeds are simulated (60 Hz), not wall-clock.
 */

const CFG = WORLD_STREAMING_CONFIG;
const SIZE = CFG.chunkSizeMeters;
const index = buildWorldIndex(buildLoopCityNetwork(), SIZE);
const period = index.period;
if (period === null) throw new Error('The loop city index must be periodic.');
const PERIOD = period.periodMeters;
const HZ = 60;
const DT = 1 / HZ;
const WARMUP_CAP_FRAMES = 60_000; // Upper bound on the standstill warm-up. The warm-up ends as soon as the start is fully built.

interface Drive {
  readonly start: PlanarPoint;
  readonly heading: PlanarPoint;
}

const DRIVES: Record<'east' | 'west' | 'north' | 'south', Drive> = {
  east: { start: { x: 700, z: -401.8 }, heading: { x: 1, z: 0 } },
  west: { start: { x: -700, z: -398.2 }, heading: { x: -1, z: 0 } },
  north: { start: { x: -398.2, z: 700 }, heading: { x: 0, z: 1 } },
  south: { start: { x: -401.8, z: -700 }, heading: { x: 0, z: -1 } },
};

interface DriveResult {
  /** Frames after warm-up in which the strip ahead had at least one chunk not active. */
  readonly gapFrames: number;
  /** The largest number of unloaded chunks ahead in any frame after warm-up. */
  readonly worstUnloadedAhead: number;
  /** Frames after warm-up in which the chunk under the car was not active. */
  readonly underCarMisses: number;
  /** Number of times the car's logical chunk changed. */
  readonly chunkChanges: number;
  readonly teleports: number;
  readonly peakMounted: number;
  readonly maxLoadRadius: number;
}

/** Drives the real streamer along a straight line at constant speed, with a simulated renderer of fixed build latency. */
function simulateDrive(drive: Drive, speedMps: number, driveMeters: number, latencyFrames: number, streamIndex: WorldIndex = index): DriveResult {
  const streamer = new WorldStreamer(streamIndex, CFG);
  const built = new Set<string>();
  const dueFrame = new Map<string, number>();
  let frame = 0;
  let maxLoadRadius = 0;

  const step = (x: number, z: number, speed: number) => {
    const pose: StreamPose = { x, z, forward: drive.heading, speedMps: speed };
    streamer.update(pose);
    const mounted = streamer.mountedChunks();
    const mountedKeys = new Set(mounted.map((m) => m.key));
    for (const m of mounted) {
      if (!built.has(m.key) && !dueFrame.has(m.key)) dueFrame.set(m.key, frame + latencyFrames);
    }
    for (const [key, due] of [...dueFrame]) {
      if (!mountedKeys.has(key)) {
        dueFrame.delete(key);
      } else if (due <= frame) {
        streamer.complete(key);
        built.add(key);
        dueFrame.delete(key);
      }
    }
    for (const key of [...built]) {
      if (!mountedKeys.has(key)) {
        streamer.released(key);
        built.delete(key);
      }
    }
    frame += 1;
    const stats = streamer.stats();
    maxLoadRadius = Math.max(maxLoadRadius, stats.loadRadiusMeters);
    return stats;
  };

  // Standstill warm-up: the drive starts only once everything around the start is built (queued and loading both zero).
  for (let i = 0; i < WARMUP_CAP_FRAMES; i += 1) {
    const warm = step(drive.start.x, drive.start.z, 0);
    if (warm.queued === 0 && warm.loading === 0) break;
  }

  const frames = Math.ceil(driveMeters / (speedMps * DT));
  let x = drive.start.x;
  let z = drive.start.z;
  let previousCar = chunkKey(chunkOfPoint(x, z, SIZE));
  let gapFrames = 0;
  let worst = 0;
  let underCarMisses = 0;
  let chunkChanges = 0;
  let last = streamer.stats();
  for (let i = 0; i < frames; i += 1) {
    x += drive.heading.x * speedMps * DT;
    z += drive.heading.z * speedMps * DT;
    last = step(x, z, speedMps);
    const car = chunkKey(chunkOfPoint(x, z, SIZE));
    if (car !== previousCar) {
      chunkChanges += 1;
      previousCar = car;
    }
    if (last.unloadedAhead > 0) gapFrames += 1;
    worst = Math.max(worst, last.unloadedAhead);
    if (last.underCarActive !== true) underCarMisses += 1;
  }
  return { gapFrames, worstUnloadedAhead: worst, underCarMisses, chunkChanges, teleports: last.teleports, peakMounted: last.peakMounted, maxLoadRadius };
}

describe('seam drive through the real streamer', () => {
  // The drive covers one full period (2400 m), so it crosses every seam of the loop in that direction.
  const DRIVE_METERS = PERIOD;
  const BUILD_FRAMES = 8; // about 0.13 s of simulated build time per chunk

  for (const name of Object.keys(DRIVES) as Array<keyof typeof DRIVES>) {
    for (const speed of [30, 60]) {
      it(`${name} at ${speed} m/s: nothing unloaded ahead, chunk under the car always active`, () => {
        const result = simulateDrive(DRIVES[name], speed, DRIVE_METERS, BUILD_FRAMES);
        expect(result.teleports).toBe(0);
        expect(result.chunkChanges).toBeGreaterThanOrEqual(6);
        expect(result.gapFrames).toBe(0);
        expect(result.worstUnloadedAhead).toBe(0);
        expect(result.underCarMisses).toBe(0);
      }, 120_000);
    }
  }

  it('east and north at 60 m/s with a 6 s build per chunk: still no gap ahead', () => {
    // Measured onset of gaps is between 8 s and 15 s of build per chunk at 60 m/s (see PROJECT_CONTEXT). 6 s is inside it.
    for (const drive of [DRIVES.east, DRIVES.north]) {
      const result = simulateDrive(drive, 60, DRIVE_METERS, 360);
      expect(result.teleports).toBe(0);
      expect(result.gapFrames).toBe(0);
      expect(result.underCarMisses).toBe(0);
    }
  }, 120_000);

  it('finite city (control, no seam): driving east from the spawn stays gap-free', () => {
    // The finite city has no seam. The same gap rules must hold there, with the non-periodic chunk lookup.
    const finite = buildWorldIndex(buildCityNetwork(), SIZE);
    expect(finite.period).toBeNull();
    const drive: Drive = { start: { x: CITY_SPAWN.position.x, z: CITY_SPAWN.position.z }, heading: { x: 1, z: 0 } };
    const result = simulateDrive(drive, 30, 300, BUILD_FRAMES, finite);
    expect(result.teleports).toBe(0);
    expect(result.gapFrames).toBe(0);
    expect(result.underCarMisses).toBe(0);
  }, 120_000);

  it('negative control: a 15 s build per chunk at 60 m/s must show gaps ahead', () => {
    // The detector has to be able to fail. Past the prefetch lead the strip ahead is not built when the car arrives.
    const result = simulateDrive(DRIVES.east, 60, DRIVE_METERS, 900);
    expect(result.gapFrames).toBeGreaterThan(0);
    expect(result.underCarMisses).toBeGreaterThan(0);
  }, 120_000);
});

describe('gap probe', () => {
  const sampling = { lookaheadMeters: CFG.gapLookaheadMeters, lateralMeters: CFG.gapLateralMeters, stepMeters: CFG.gapStepMeters };

  it('samples the car point plus a three-line strip ahead', () => {
    const samples = aheadSamples({ x: 0, z: 0 }, { x: 1, z: 0 }, sampling);
    // 1 car point + (80 / 20 + 1) along positions x 3 lateral lines.
    expect(samples).toHaveLength(1 + 5 * 3);
    expect(samples[0]).toEqual({ x: 0, z: 0 });
    const far = samples.reduce((max, p) => Math.max(max, p.x), 0);
    expect(far).toBeCloseTo(80, 9);
  });

  it('counts only inactive chunks with content, once each', () => {
    const samples = aheadSamples({ x: 1190, z: -401.8 }, { x: 1, z: 0 }, sampling);
    const everything = countUnloadedAhead(index, samples, () => false);
    expect(everything).toBeGreaterThan(0);
    expect(countUnloadedAhead(index, samples, () => true)).toBe(0);
    const distinct = new Set(samples.map((p) => chunkKey(chunkOfPoint(p.x, p.z, SIZE))));
    expect(everything).toBeLessThanOrEqual(distinct.size);
  });

  it('a zero forward vector gives only the car point', () => {
    expect(aheadSamples({ x: 5, z: 5 }, { x: 0, z: 0 }, sampling)).toEqual([{ x: 5, z: 5 }]);
  });
});

describe('seam invariants', () => {
  function distanceToBox(p: PlanarPoint, box: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
    const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX);
    const dz = Math.max(box.minZ - p.z, 0, p.z - box.maxZ);
    return Math.hypot(dx, dz);
  }

  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('brute force: every footprint within the load radius, over all images, has its owner selected', () => {
    const random = rng(20261017);
    let checked = 0;
    const points: PlanarPoint[] = [];
    for (let i = 0; i < 300; i += 1) {
      points.push({ x: (random() * 2 - 1) * PERIOD, z: (random() * 2 - 1) * PERIOD });
    }
    // Points near the two seams, where an image boundary cuts through the wanted set.
    for (let i = 0; i < 300; i += 1) {
      const seam = random() < 0.5 ? PERIOD / 2 : -PERIOD / 2;
      const along = (random() * 2 - 1) * 1200;
      points.push(random() < 0.5 ? { x: seam + (random() * 2 - 1) * 250, z: along } : { x: along, z: seam + (random() * 2 - 1) * 250 });
    }
    for (const p of points) {
      const radius = 150 + random() * (CFG.maxLoadRadiusMeters - 150);
      const selected = selectChunks(index, p, radius);
      for (const footprint of index.footprints) {
        const owner = parseChunkKey(footprint.owner);
        if (owner === null) throw new Error(`Unparsable owner ${footprint.owner}`);
        const canonical = canonicalChunk(period, owner);
        for (const mx of [-1, 0, 1]) {
          for (const mz of [-1, 0, 1]) {
            const box = {
              minX: footprint.minX + mx * PERIOD,
              maxX: footprint.maxX + mx * PERIOD,
              minZ: footprint.minZ + mz * PERIOD,
              maxZ: footprint.maxZ + mz * PERIOD,
            };
            if (distanceToBox(p, box) > radius) continue;
            checked += 1;
            const key = chunkKey(logicalChunk(period, canonical, mx, mz));
            if (!selected.has(key)) {
              throw new Error(`Footprint ${footprint.segmentId} image (${mx},${mz}) owned by ${key} is within ${radius} m of (${p.x}, ${p.z}) but not selected.`);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  }, 120_000);

  it('forward priority holds across the seam: the chunk ahead outranks the chunk behind, both ways', () => {
    const bias = CFG.forwardPriorityBias;
    // Eastbound, just west of the seam at x = 1200. Ahead is kx 3 (x 1200..1600), behind is kx 1 (x 400..800).
    const east = { x: 1190, z: -401.8 };
    const eastFwd = { x: 1, z: 0 };
    const eastAhead = chunkPriority(index, { kx: 3, kz: -2 }, east, eastFwd, bias);
    const eastBehind = chunkPriority(index, { kx: 1, kz: -2 }, east, eastFwd, bias);
    expect(eastAhead).toBeLessThan(eastBehind);
    // Westbound, just east of the seam. Ahead is kx 2 (x 800..1200), behind is kx 4 (x 1600..2000).
    const west = { x: 1210, z: -398.2 };
    const westFwd = { x: -1, z: 0 };
    const westAhead = chunkPriority(index, { kx: 2, kz: -2 }, west, westFwd, bias);
    const westBehind = chunkPriority(index, { kx: 4, kz: -2 }, west, westFwd, bias);
    expect(westAhead).toBeLessThan(westBehind);
  });
});
