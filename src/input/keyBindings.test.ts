import { describe, expect, it } from 'vitest';
import { isGameKeyCode, keysToInput } from './keyBindings';

const keys = (...codes: string[]) => new Set(codes);

describe('keysToInput', () => {
  it('is neutral with no keys held', () => {
    expect(keysToInput(keys())).toEqual({ steer: 0, throttle: 0, brake: 0 });
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

  it('ignores unrelated keys', () => {
    expect(keysToInput(keys('KeyQ', 'Space'))).toEqual({ steer: 0, throttle: 0, brake: 0 });
  });

  it('recognizes only bound key codes as game keys', () => {
    expect(isGameKeyCode('KeyW')).toBe(true);
    expect(isGameKeyCode('Space')).toBe(false);
  });
});
