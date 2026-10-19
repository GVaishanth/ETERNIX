import { describe, expect, it } from 'vitest';
import { completedCount, messageOf, runReadiness, type ReadinessStep, type StepSnapshot } from './readiness';

function step(id: string, run: ReadinessStep['run']): ReadinessStep {
  return { id, label: id.toUpperCase(), run };
}

describe('runReadiness', () => {
  it('runs every step in order and reports ready', async () => {
    const order: string[] = [];
    const steps = [
      step('a', async () => { order.push('a'); return 'first'; }),
      step('b', async () => { order.push('b'); return 'second'; }),
    ];
    const controller = new AbortController();
    const snapshots: StepSnapshot[][] = [];
    const outcome = await runReadiness(steps, (snap) => snapshots.push([...snap]), controller.signal);
    expect(outcome).toBe('ready');
    expect(order).toEqual(['a', 'b']);
    const last = snapshots[snapshots.length - 1] ?? [];
    expect(last.map((s) => s.status)).toEqual(['done', 'done']);
    expect(last.map((s) => s.detail)).toEqual(['first', 'second']);
    expect(completedCount(last)).toBe(2);
  });

  it('stops at a failure and leaves later steps waiting', async () => {
    let ran = false;
    const steps = [
      step('a', async () => 'ok'),
      step('b', async () => { throw new Error('graphics missing'); }),
      step('c', async () => { ran = true; return 'never'; }),
    ];
    const snapshots: StepSnapshot[][] = [];
    const outcome = await runReadiness(steps, (snap) => snapshots.push([...snap]), new AbortController().signal);
    expect(outcome).toBe('failed');
    expect(ran).toBe(false);
    const last = snapshots[snapshots.length - 1] ?? [];
    expect(last.map((s) => s.status)).toEqual(['done', 'failed', 'waiting']);
    expect(last[1]?.error).toBe('graphics missing');
    expect(completedCount(last)).toBe(1);
  });

  it('does not start another step after cancellation', async () => {
    const controller = new AbortController();
    let secondStarted = false;
    const steps = [
      step('a', async () => { controller.abort(); return 'done before cancel'; }),
      step('b', async () => { secondStarted = true; return 'x'; }),
    ];
    const outcome = await runReadiness(steps, () => undefined, controller.signal);
    expect(outcome).toBe('cancelled');
    expect(secondStarted).toBe(false);
  });

  it('returns ready for an empty step list', async () => {
    const outcome = await runReadiness([], () => undefined, new AbortController().signal);
    expect(outcome).toBe('ready');
  });
});

describe('messageOf', () => {
  it('reads Error messages and strings, and never returns an empty string', () => {
    expect(messageOf(new Error('boom'))).toBe('boom');
    expect(messageOf('plain')).toBe('plain');
    expect(messageOf(new Error('   '))).not.toBe('');
    expect(messageOf(42)).not.toBe('');
  });
});

