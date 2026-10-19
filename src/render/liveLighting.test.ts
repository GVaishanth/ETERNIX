/*
 * Automated tests for the shared live lighting (game and home page): a load starts at its environment, a change of
 * time or weather moves gradually and frame-rate independently, and the values settle on their goal.
 */
import { describe, expect, it } from 'vitest';
import { lightingGoal, startingLive, stepLiveLighting } from './liveLighting';

describe('shared live lighting', () => {
  it('starts already at the goal for the environment it loads into', () => {
    const live = startingLive('night', 'rain');
    const goal = lightingGoal('night', 'rain');
    expect(live.ambientIntensity).toBeCloseTo(goal.ambientIntensity, 9);
    expect(live.sunIntensity).toBeCloseTo(goal.sunIntensity, 9);
    expect(live.wetness).toBeCloseTo(goal.wetness, 9);
    expect(live.fogFar).toBeCloseTo(goal.fogFar, 9);
  });

  it('moves gradually when the environment changes, not in one frame', () => {
    const live = startingLive('day', 'clear');
    const night = lightingGoal('night', 'rain');
    const before = live.sunIntensity;
    stepLiveLighting(live, night, 1 / 60);
    const moved = Math.abs(live.sunIntensity - before);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(Math.abs(night.sunIntensity - before) * 0.1);
  });

  it('gives the same result for one long step and many short ones', () => {
    const goal = lightingGoal('night', 'rain');
    const coarse = startingLive('day', 'clear');
    const fine = startingLive('day', 'clear');
    stepLiveLighting(coarse, goal, 1);
    for (let i = 0; i < 60; i += 1) stepLiveLighting(fine, goal, 1 / 60);
    expect(fine.sunIntensity).toBeCloseTo(coarse.sunIntensity, 3);
    expect(fine.wetness).toBeCloseTo(coarse.wetness, 3);
  });

  it('reports settled once every value is at its goal', () => {
    const live = startingLive('day', 'clear');
    const goal = lightingGoal('evening', 'rain');
    expect(stepLiveLighting(live, goal, 1 / 60)).toBe(false);
    let settled = false;
    for (let i = 0; i < 60 * 60 && !settled; i += 1) settled = stepLiveLighting(live, goal, 1 / 60);
    expect(settled).toBe(true);
  });
});
