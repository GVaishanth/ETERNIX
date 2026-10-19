/*
 * The reveal gate: the game is shown only after the steps succeed, the game has mounted behind the loading page, and the
 * minimum hold has passed. Any one of them missing keeps the loading page on top.
 */
import { describe, expect, it } from 'vitest';
import { canReturn, canReveal } from './entryTiming';

describe('canReveal', () => {
  it('reveals only when the steps are ready, the game is mounted, and the hold is over', () => {
    expect(canReveal({ outcome: 'ready', gameReady: true, holdDone: true, barsDone: true })).toBe(true);
  });

  it('keeps the loading page up until every bar has completed, even when everything else is ready', () => {
    expect(canReveal({ outcome: 'ready', gameReady: true, holdDone: true, barsDone: false })).toBe(false);
  });

  it('keeps the loading page up during the hold, even when everything else is ready', () => {
    expect(canReveal({ outcome: 'ready', gameReady: true, holdDone: false, barsDone: true })).toBe(false);
  });

  it('keeps the loading page up until the game has mounted behind it', () => {
    expect(canReveal({ outcome: 'ready', gameReady: false, holdDone: true, barsDone: true })).toBe(false);
  });

  it('keeps the loading page up while the steps still run, and never reveals after a failure or cancel', () => {
    expect(canReveal({ outcome: null, gameReady: true, holdDone: true, barsDone: true })).toBe(false);
    expect(canReveal({ outcome: 'failed', gameReady: true, holdDone: true, barsDone: true })).toBe(false);
    expect(canReveal({ outcome: 'cancelled', gameReady: true, holdDone: true, barsDone: true })).toBe(false);
  });
});

describe('canReturn', () => {
  it('lets the front page take over only when the hold has passed and it is drawn', () => {
    expect(canReturn({ holdDone: true, homeReady: true })).toBe(true);
    expect(canReturn({ holdDone: false, homeReady: true })).toBe(false);
    expect(canReturn({ holdDone: true, homeReady: false })).toBe(false);
  });
});
