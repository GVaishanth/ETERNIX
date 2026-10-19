/*
 * The game, mounted behind the front page while the handoff runs. The game is the same App as play.html; the standalone
 * play.html page is unchanged. Leaving the game (the HUD's Leave) calls onLeave instead of opening the front page, so
 * the page can play the return. The startup guard catches a failed start (for example, no WebGL) and shows its message.
 */
import { lazy, Suspense } from 'react';
import { StartupBoundary } from '../../ui/StartupBoundary';
import { CanvasProbe } from './CanvasProbe';

// Loaded on demand. The readiness steps preload the same modules, so this resolves at once after ENTER GAME.
const GameApp = lazy(() => import('../../App').then((module) => ({ default: module.App })));

interface GameLayerProps {
  /** Called once the game has drawn its canvas behind the page. */
  readonly onReady: () => void;
  /** True once the game is shown on its own. Until then it takes no pointer input. */
  readonly interactive: boolean;
  /** The HUD's Leave, in-page. */
  readonly onLeave: () => void;
}

export function GameLayer({ onReady, interactive, onLeave }: GameLayerProps) {
  return (
    <div className={interactive ? 'ex-game-layer' : 'ex-game-layer ex-game-idle'} aria-hidden={!interactive}>
      <StartupBoundary>
        <Suspense fallback={null}>
          <GameApp onLeave={onLeave} />
          <CanvasProbe scope=".ex-game-layer" onReady={onReady} />
        </Suspense>
      </StartupBoundary>
    </div>
  );
}
