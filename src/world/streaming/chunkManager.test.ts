import { describe, expect, it } from 'vitest';
import type { ChunkCoord } from './chunkGrid';
import { ChunkManager, type ChunkRequest, type ManagerUpdate } from './chunkManager';

const LIMITS = { maxActiveChunks: 6, maxConcurrentLoads: 2, maxRetries: 2 };
const EMPTY = new Set<string>();

function request(kx: number, kz: number, priority = 0): ChunkRequest {
  return { key: `C-${kx}-${kz}`, coord: { kx, kz } as ChunkCoord, priority, detail: 'full', urgent: false };
}

function update(manager: ChunkManager, load: ChunkRequest[], keep?: Set<string>, extra: Partial<ManagerUpdate> = {}) {
  const keys = new Set(load.map((r) => r.key));
  const kept = new Set<string>([...keys, ...(keep ?? EMPTY)]);
  return manager.update({ load, keep: kept, pinned: EMPTY, maxStarts: 10, ...extra });
}

describe('chunk lifecycle', () => {
  it('creates one record per chunk, even when asked repeatedly', () => {
    const m = new ChunkManager(LIMITS);
    update(m, [request(0, 0), request(0, 0)]);
    update(m, [request(0, 0)]);
    expect(m.counts().loading + m.counts().queued + m.counts().active).toBe(1);
  });

  it('starts no more than the concurrent-load limit and the start budget', () => {
    const m = new ChunkManager(LIMITS);
    const result = update(m, [request(0, 0), request(1, 0), request(2, 0), request(3, 0)], undefined, { maxStarts: 4 });
    expect(result.started).toBe(2);
    expect(m.counts().loading).toBe(2);
    expect(m.counts().queued).toBe(2);
    const budget = update(new ChunkManager(LIMITS), [request(0, 0), request(1, 0), request(2, 0)], undefined, { maxStarts: 1 });
    expect(budget.started).toBe(1);
  });

  it('starts the nearest chunk first', () => {
    const m = new ChunkManager({ ...LIMITS, maxConcurrentLoads: 1 });
    update(m, [request(5, 0, 50), request(1, 0, 5)], undefined, { maxStarts: 1 });
    expect(m.record('C-1-0')?.state).toBe('LOADING');
    expect(m.record('C-5-0')?.state).toBe('QUEUED');
  });

  it('never exceeds the active cap', () => {
    const m = new ChunkManager({ ...LIMITS, maxActiveChunks: 3, maxConcurrentLoads: 3 });
    const load = [request(0, 0), request(1, 0), request(2, 0), request(3, 0), request(4, 0)];
    update(m, load, undefined, { maxStarts: 10 });
    expect(m.counts().loading).toBe(3);
    for (const r of m.mounted()) m.complete(r.key);
    update(m, load, undefined, { maxStarts: 10 });
    expect(m.counts().loading + m.counts().active).toBeLessThanOrEqual(3);
  });

  it('cancels queued work that is no longer kept, before it starts', () => {
    const m = new ChunkManager({ ...LIMITS, maxConcurrentLoads: 1 });
    update(m, [request(0, 0), request(1, 0)], undefined, { maxStarts: 1 });
    const result = m.update({ load: [], keep: EMPTY, pinned: EMPTY, maxStarts: 1 });
    expect(result.queuedCancelled).toBe(1);
    expect(m.record('C-1-0')).toBeUndefined();
    expect(m.totals().cancelled).toBe(1);
  });

  it('unloads a built chunk when it leaves the keep set, and deletes it after release', () => {
    const m = new ChunkManager(LIMITS);
    update(m, [request(0, 0)]);
    m.complete('C-0-0');
    const out = m.update({ load: [], keep: EMPTY, pinned: EMPTY, maxStarts: 1 });
    expect(out.unloading).toBe(1);
    expect(m.record('C-0-0')?.state).toBe('UNLOADING');
    expect(m.mounted()).toHaveLength(0);
    expect(m.released('C-0-0')).toBe(true);
    expect(m.record('C-0-0')).toBeUndefined();
    expect(m.totals().unloaded).toBe(1);
  });

  it('restores an unloading chunk without rebuilding it when it is wanted again', () => {
    const m = new ChunkManager(LIMITS);
    update(m, [request(0, 0)]);
    m.complete('C-0-0');
    m.update({ load: [], keep: EMPTY, pinned: EMPTY, maxStarts: 1 });
    const back = update(m, [request(0, 0)]);
    expect(back.restored).toBe(1);
    expect(m.record('C-0-0')?.state).toBe('ACTIVE');
    expect(m.totals().started).toBe(1);
  });

  it('keeps a pinned chunk that the keep set does not include', () => {
    const m = new ChunkManager(LIMITS);
    update(m, [request(2, 2)], undefined, { pinned: new Set(['C-2-2']) });
    m.complete('C-2-2');
    m.update({ load: [], keep: EMPTY, pinned: new Set(['C-2-2']), maxStarts: 1 });
    expect(m.record('C-2-2')?.state).toBe('ACTIVE');
  });

  it('marks a failed chunk, retries it within the limit, then leaves it failed', () => {
    const m = new ChunkManager({ ...LIMITS, maxRetries: 1 });
    const keep = new Set(['C-0-0']);
    const again = () => m.update({ load: [request(0, 0)], keep, pinned: EMPTY, maxStarts: 1 });
    again();
    expect(m.fail('C-0-0', 'boom')).toBe(true);
    expect(m.record('C-0-0')?.state).toBe('FAILED');
    // One retry (maxRetries 1): the second attempt starts, then fails and is not retried again.
    again();
    expect(m.record('C-0-0')?.state).toBe('LOADING');
    m.fail('C-0-0', 'boom again');
    again();
    expect(m.record('C-0-0')?.state).toBe('FAILED');
    expect(m.record('C-0-0')?.failures).toBe(2);
    expect(m.record('C-0-0')?.error).toBe('boom again');
  });

  it('ignores completion and failure reports for chunks it does not track', () => {
    const m = new ChunkManager(LIMITS);
    expect(m.complete('C-9-9')).toBe(false);
    expect(m.fail('C-9-9', 'x')).toBe(false);
    expect(m.released('C-9-9')).toBe(false);
  });

  it('does not drop a mounted chunk when the renderer reports release out of turn', () => {
    const m = new ChunkManager(LIMITS);
    update(m, [request(0, 0)]);
    m.complete('C-0-0');
    expect(m.released('C-0-0')).toBe(false);
    expect(m.record('C-0-0')?.state).toBe('ACTIVE');
  });
});
