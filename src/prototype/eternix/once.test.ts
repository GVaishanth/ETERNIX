import { describe, expect, it } from 'vitest';
import { createRetryableOnce } from './once';

describe('createRetryableOnce', () => {
  it('runs the task once and shares the result with every caller', async () => {
    let runs = 0;
    const once = createRetryableOnce(async () => {
      runs += 1;
      return 'loaded';
    });
    const [a, b] = await Promise.all([once(), once()]);
    expect(a).toBe('loaded');
    expect(b).toBe('loaded');
    expect(await once()).toBe('loaded');
    expect(runs).toBe(1);
  });

  it('does not keep a failure, so the next call runs the task again', async () => {
    let runs = 0;
    const once = createRetryableOnce(async () => {
      runs += 1;
      if (runs === 1) throw new Error('network');
      return 'ok';
    });
    await expect(once()).rejects.toThrow('network');
    expect(await once()).toBe('ok');
    expect(runs).toBe(2);
  });
});
