import { describe, expect, it } from 'vitest';
import { careerPromptVisible } from './careerPrompt';

describe('careerPromptVisible', () => {
  it('shows while the career has not started and the player is in the game', () => {
    expect(careerPromptVisible({ started: false, hubOpen: false, dismissed: false })).toBe(true);
  });

  it('hides once the career has started', () => {
    expect(careerPromptVisible({ started: true, hubOpen: false, dismissed: false })).toBe(false);
  });

  it('steps aside while the career hub is open', () => {
    expect(careerPromptVisible({ started: false, hubOpen: true, dismissed: false })).toBe(false);
  });

  it('stays hidden after the player dismisses it', () => {
    expect(careerPromptVisible({ started: false, hubOpen: false, dismissed: true })).toBe(false);
  });
});
