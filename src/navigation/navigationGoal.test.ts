import { describe, expect, it } from 'vitest';
import { buildLaneGraph } from '../traffic/laneGraph';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { careerGoal, chooseGoal, type NavigationTargets } from './navigationGoal';

/*
 * Destination choice. The race state decides: no route while a race counts down, the next checkpoint while it runs, and
 * otherwise the career target's race marker, then the garage entrance.
 */

const loopNetwork = buildLoopCityNetwork();
const loopGraph = buildLaneGraph(loopNetwork);
const CHECKPOINT = { x: -200, z: -188 };

function targets(overrides: Partial<NavigationTargets>): NavigationTargets {
  return {
    phase: 'FREE_ROAM',
    careerEventId: 'career-warmup',
    checkpoint: CHECKPOINT,
    garage: loopNetwork.spawn.position,
    ...overrides,
  };
}

describe('choosing the navigation goal', () => {
  it('routes to the career target first, to its race marker', () => {
    const goal = chooseGoal(loopGraph, targets({}));
    const marker = careerGoal(loopGraph, 'career-warmup');
    expect(goal?.kind).toBe('career');
    expect(goal?.label).toBe('Harbour Warm-Up');
    expect(goal?.laneId).toBe(marker?.laneId);
  });

  it('falls back to the garage when there is no career target', () => {
    expect(chooseGoal(loopGraph, targets({ careerEventId: null }))?.kind).toBe('garage');
  });

  it('shows nothing when there is neither a career target nor a garage', () => {
    expect(chooseGoal(loopGraph, targets({ careerEventId: null, garage: null }))).toBeNull();
  });

  it('keeps the career target while the car is in the approach card, and after the race ends', () => {
    expect(chooseGoal(loopGraph, targets({ phase: 'EVENT_APPROACH' }))?.kind).toBe('career');
    expect(chooseGoal(loopGraph, targets({ phase: 'FINISHED' }))?.kind).toBe('career');
    expect(chooseGoal(loopGraph, targets({ phase: 'FAILED' }))?.kind).toBe('career');
  });

  it('ends all navigation when the race starts (COUNTDOWN), and while it is paused', () => {
    expect(chooseGoal(loopGraph, targets({ phase: 'COUNTDOWN' }))).toBeNull();
    expect(chooseGoal(loopGraph, targets({ phase: 'PAUSED' }))).toBeNull();
  });

  it('shows the next checkpoint while the race runs, not the career target or the garage', () => {
    const goal = chooseGoal(loopGraph, targets({ phase: 'RACING' }));
    expect(goal?.kind).toBe('checkpoint');
    expect(goal?.label).toBe('Next checkpoint');
  });

  it('shows nothing while the race runs but has no checkpoint left to name', () => {
    expect(chooseGoal(loopGraph, targets({ phase: 'RACING', checkpoint: null }))).toBeNull();
  });
});
