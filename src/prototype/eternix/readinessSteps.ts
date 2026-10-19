/*
 * The real loading steps for the prototype. Each one does work the game needs before it can start. None waits on a
 * timer. The game's own loader (play.html) stays the source of truth for gameplay start-up. These steps only decide
 * whether the page can hand over.
 */
import { getWorldDefinition } from '../../world/worlds';
import { createRetryableOnce } from './once';
import type { ReadinessStep } from './readiness';
import { readSaveSnapshot } from './saveSnapshot';

/**
 * The game's module graph. It is started early by the landing (see EternixPrototype) and shared with the loading step.
 * So when the preload has finished, ENTER GAME opens the game at once. A failed import is retried on the next attempt.
 */
export const loadGameModules = createRetryableOnce(() => import('../../App'));

function webglAvailable(): boolean {
  const canvas = document.createElement('canvas');
  return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null;
}

export function buildReadinessSteps(): readonly ReadinessStep[] {
  return [
    {
      id: 'graphics',
      label: 'Checking graphics',
      run: async () => {
        if (!webglAvailable()) {
          throw new Error('WebGL is not available. The game needs it. Turn on hardware acceleration in your browser, then try again.');
        }
        return 'WebGL available';
      },
    },
    {
      id: 'save',
      label: 'Reading your save',
      run: async () => readSaveSnapshot().saveLabel,
    },
    {
      id: 'car',
      label: 'Loading your car',
      run: async () => {
        const { car } = readSaveSnapshot();
        return `${car.name}, ${car.paintLabel}`;
      },
    },
    {
      id: 'code',
      label: 'Loading game code',
      run: async () => {
        await loadGameModules();
        return 'Ready';
      },
    },
    {
      id: 'road',
      label: 'Preparing the road',
      run: async () => {
        getWorldDefinition('loop');
        return 'Loop road ready';
      },
    },
  ];
}
