import { describe, expect, it } from 'vitest';
import { actionForKeyCode, isHeldGameKeyCode, keysToInput, shouldPreventDefault } from './keyBindings';

const keys = (...codes: string[]) => new Set(codes);

describe('keysToInput', () => {
  it('is neutral with no keys held', () => {
    expect(keysToInput(keys())).toEqual({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
  });

  it('maps A and Left Arrow to full left steer (-1)', () => {
    expect(keysToInput(keys('KeyA')).steer).toBe(-1);
    expect(keysToInput(keys('ArrowLeft')).steer).toBe(-1);
  });

  it('maps D and Right Arrow to full right steer (+1)', () => {
    expect(keysToInput(keys('KeyD')).steer).toBe(1);
    expect(keysToInput(keys('ArrowRight')).steer).toBe(1);
  });

  it('cancels steering when left and right are both held', () => {
    expect(keysToInput(keys('KeyA', 'KeyD')).steer).toBe(0);
  });

  it('maps W/Up to throttle and S/Down to brake', () => {
    expect(keysToInput(keys('KeyW')).throttle).toBe(1);
    expect(keysToInput(keys('ArrowUp')).throttle).toBe(1);
    expect(keysToInput(keys('KeyS')).brake).toBe(1);
    expect(keysToInput(keys('ArrowDown')).brake).toBe(1);
  });

  it('maps Space to the handbrake', () => {
    expect(keysToInput(keys('Space')).handbrake).toBe(1);
    expect(keysToInput(keys('KeyW')).handbrake).toBe(0);
  });

  it('ignores unrelated keys', () => {
    expect(keysToInput(keys('KeyQ'))).toEqual({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
  });
});

describe('key classification', () => {
  it('recognizes driving keys as held game keys', () => {
    expect(isHeldGameKeyCode('KeyW')).toBe(true);
    expect(isHeldGameKeyCode('Space')).toBe(true);
    expect(isHeldGameKeyCode('Escape')).toBe(false);
  });

  it('prevents default page behavior for driving keys only', () => {
    expect(shouldPreventDefault('ArrowUp')).toBe(true);
    expect(shouldPreventDefault('Space')).toBe(true);
    expect(shouldPreventDefault('KeyQ')).toBe(false);
  });

  it('maps action keys to actions', () => {
    expect(actionForKeyCode('Escape')).toBe('pause');
    expect(actionForKeyCode('KeyR')).toBe('reset');
    expect(actionForKeyCode('Backquote')).toBe('debugPanel');
    expect(actionForKeyCode('KeyG')).toBe('roadDebug');
    expect(actionForKeyCode('KeyO')).toBe('overview');
    expect(actionForKeyCode('KeyW')).toBeNull();
  });
});
