import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ControlsInfo } from '../../ui/ControlsInfo';
import { ETERNIX_PROTOTYPE_CONFIG as C } from '../../config/eternixPrototypeConfig';
import { HeroBoundary, HeroStage } from './HeroStage';
import { ShowroomPanel } from './ShowroomPanel';
import { ShowroomStage } from './ShowroomStage';
import { BACK_VIEW_INDEX, HERO_VIEWS, nextViewIndex } from './heroViews';
import { type CameraMove, type CameraPose } from './cameraMove';
import { type ShowroomView } from './showroomOrbit';
import { Wordmark } from './Wordmark';
import { buildReadinessSteps, loadGameModules } from './readinessSteps';
import { messageOf, runReadiness, type ReadinessOutcome, type StepSnapshot } from './readiness';
import { canReturn, canReveal } from './entryTiming';
import { pickBarDurations } from './loadingBars';
import { CanvasProbe } from './CanvasProbe';
import { GameLayer } from './GameLayer';
import { readSaveSnapshot, type SaveSnapshot } from './saveSnapshot';

/*
 * The ETERNIX front page. ENTER GAME does not open a page. The camera swings to the back view (3 s). Then a translucent
 * loading page holds for at least 3 s, with one bar per real loading step, and the game loads behind it. Once the game
 * is ready and the bars are complete, the page fades and the game is shown. Leaving the game (the HUD's Leave) plays the
 * same handoff in reverse: the loading page shows over the game, then the camera swings back to where the page was left,
 * and the page fades back in. The standalone play.html page is unchanged.
 */

type View = 'landing' | 'showroom';

/**
 * landing: the front page. entering: the camera swings to the back view and the game mounts behind the page. loading:
 * the loading page shows. revealing: the loading page and the front page fade. game: the game alone. leaving: the
 * loading page shows over the game on the way back. returning: the camera swings back and the front page fades in.
 */
type Phase = 'landing' | 'entering' | 'loading' | 'revealing' | 'game' | 'leaving' | 'returning';

const READINESS_STEPS = buildReadinessSteps();

function initialSteps(): readonly StepSnapshot[] {
  return READINESS_STEPS.map((step) => ({ id: step.id, label: step.label, status: 'waiting', detail: null, error: null }));
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function SaveStatus({ snapshot }: { readonly snapshot: SaveSnapshot }) {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Car', snapshot.car.vehicleClass ? `${snapshot.car.name}, ${snapshot.car.vehicleClass}` : snapshot.car.name],
    ['Paint', snapshot.car.paintLabel],
    ['Credits', snapshot.state.credits.toLocaleString('en-US')],
    ['Save', snapshot.saveLabel],
  ];
  return (
    <dl className="ex-status" aria-label="Your save">
      {rows.map(([term, value]) => (
        <div key={term} className="ex-status-row">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface BarRow {
  readonly id: string;
  readonly label: string;
  /** The real step has finished. The bar completes and its tick appears. */
  readonly done: boolean;
  readonly failed: boolean;
}

/** A tick mark that draws itself when its step is complete. A failed step shows a cross. */
function Tick({ done, failed }: { readonly done: boolean; readonly failed: boolean }) {
  if (failed) {
    return (
      <span className="ex-tick ex-tick-failed" aria-hidden="true">
        ×
      </span>
    );
  }
  return (
    <svg className={done ? 'ex-tick ex-tick-done' : 'ex-tick'} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" />
      <path d="M4.8 8.4 L7 10.6 L11.2 6" />
    </svg>
  );
}

interface LoadingVeilProps {
  readonly kicker: string;
  readonly rows: readonly BarRow[];
  /** The page is fading out. */
  readonly out: boolean;
  readonly footnote: string | null;
  /**
   * The bars complete one at a time: `ticked` bars are complete, and the bar at that index is running for its own run
   * time (durations[index], in ms). Without it, every pending bar runs for the loading time (the way back).
   */
  readonly sequence?: { readonly ticked: number; readonly durations: readonly number[] };
  readonly children: ReactNode;
}

/**
 * The translucent loading page, centred. Each row is a bar and a tick. The bars complete one at a time when a sequence
 * is given: each runs for its own random time, then ticks once its real step is done. The bars are CSS, so nothing
 * re-renders per frame.
 */
function LoadingVeil({ kicker, rows, out, footnote, sequence, children }: LoadingVeilProps) {
  const complete = (row: BarRow, index: number) => (sequence ? index < sequence.ticked : row.done);
  const done = rows.filter((row, index) => complete(row, index)).length;
  // The bar's run time follows the config, so the page and the timing agree.
  const style = {
    '--ex-load-s': `${C.handoffLoadSeconds}s`,
    '--ex-fade-ms': `${C.revealFadeMs}ms`,
  } as unknown as CSSProperties;
  return (
    <section className={out ? 'ex-veil ex-veil-out' : 'ex-veil'} role="status" aria-live="polite" style={style}>
      <div className="ex-veil-panel">
        <p className="ex-kicker">{kicker}</p>
        <ol className="ex-bars" aria-label="Loading progress">
          {rows.map((row, index) => {
            const isDone = complete(row, index);
            const active = sequence !== undefined && index === sequence.ticked;
            const rowClass = row.failed ? 'ex-bar-row ex-row-failed' : isDone ? 'ex-bar-row ex-row-done' : 'ex-bar-row';
            let fillClass: string;
            if (sequence) {
              fillClass = isDone || row.failed ? 'ex-fill ex-fill-done' : active ? 'ex-fill ex-fill-run' : 'ex-fill';
            } else {
              fillClass = row.done || row.failed ? 'ex-fill ex-fill-done' : 'ex-fill ex-fill-run';
            }
            const rowStyle = sequence ? ({ '--ex-bar-ms': `${sequence.durations[index] ?? 0}ms` } as CSSProperties) : undefined;
            return (
              <li key={row.id} className={rowClass} style={rowStyle}>
                <span className="ex-bar-label">{row.label}</span>
                <span className="ex-track" aria-hidden="true">
                  <span className={fillClass} />
                </span>
                <Tick done={isDone} failed={row.failed} />
              </li>
            );
          })}
        </ol>
        <p className="ex-count">
          {done} of {rows.length} ready
        </p>
        {footnote ? <p className="ex-loader-text">{footnote}</p> : null}
        {children ? <div className="ex-loader-actions">{children}</div> : null}
      </div>
    </section>
  );
}

export function EternixPrototype() {
  const [snapshot, setSnapshot] = useState<SaveSnapshot>(() => readSaveSnapshot());
  const [view, setView] = useState<View>('landing');
  /** Set when ENTER GAME is pressed in the garage: the entry starts once the front page is shown. */
  const enterAfterLandingRef = useRef(false);
  const [showroomView, setShowroomView] = useState<ShowroomView>('threeQuarter');
  const [phase, setPhase] = useState<Phase>('landing');
  // The template view the camera settles on, cycled on the front page only.
  const [homeView, setHomeView] = useState(0);
  const [move, setMove] = useState<CameraMove>({ token: 0, kind: 'none' });
  const [heroKey, setHeroKey] = useState(0);
  // The game's readiness steps. A run id starts them, and cancel clears it.
  const [runId, setRunId] = useState<number | null>(null);
  const [steps, setSteps] = useState<readonly StepSnapshot[]>(initialSteps);
  const [failed, setFailed] = useState(false);
  const [outcome, setOutcome] = useState<ReadinessOutcome | null>(null);
  const [gameMounted, setGameMounted] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [loadHold, setLoadHold] = useState(false);
  const [leaveHold, setLeaveHold] = useState(false);
  const [homeReady, setHomeReady] = useState(false);
  // The camera's pose, written by the hero each frame. ENTER GAME copies it, so the return can go back to it.
  const poseRef = useRef<CameraPose | null>(null);
  const returnPose = useRef<CameraPose | null>(null);
  const markGameReady = useCallback(() => setGameReady(true), []);
  const markHomeReady = useCallback(() => setHomeReady(true), []);
  const leaveGame = useCallback(() => {
    setLeaveHold(false);
    setHomeReady(false);
    setMove((current) => ({ token: current.token + 1, kind: 'none' }));
    setPhase('leaving');
  }, []);
  const reducedMotion = usePrefersReducedMotion();

  // Start the game's modules shortly after the landing appears. A failure here is only logged: the loading step retries.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadGameModules().catch((error: unknown) => {
        console.warn('ETERNIX prototype: preloading the game failed; ENTER GAME will retry', messageOf(error));
      });
    }, C.preloadGameAfterMs);
    return () => window.clearTimeout(timer);
  }, []);

  // The front page cycles its views, and only while it is the front page.
  useEffect(() => {
    if (phase !== 'landing' || view !== 'landing') return;
    const timer = window.setInterval(
      () => setHomeView((current) => nextViewIndex(current, HERO_VIEWS.length)),
      C.heroViews.intervalSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [phase, view]);

  // The readiness steps run from ENTER GAME. A failure shows on the loading page, and the game is taken down.
  useEffect(() => {
    if (runId === null) return;
    const controller = new AbortController();
    void runReadiness(READINESS_STEPS, setSteps, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result === 'ready') {
        setOutcome('ready');
      } else if (result === 'failed') {
        setFailed(true);
        setGameMounted(false);
        setPhase('loading');
      }
    });
    return () => controller.abort();
  }, [runId]);

  // The camera's move to the back view. When it ends, the loading page appears, the game mounts behind it, and the
  // readiness steps start. Nothing else runs during the swing: the game mount and the steps are main-thread work, and
  // running them during the swing made it stutter.
  useEffect(() => {
    if (phase !== 'entering') return;
    const timer = window.setTimeout(() => {
      setGameMounted(true);
      setRunId((previous) => (previous ?? 0) + 1);
      setPhase('loading');
    }, C.handoffMoveSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // The loading bars, in order. The steps come first, then the game's canvas.
  const forwardRows: BarRow[] = [
    ...steps.map((step) => ({
      id: step.id,
      label: step.label,
      done: step.status === 'done',
      failed: step.status === 'failed',
    })),
    { id: 'game', label: 'Game on screen', done: gameReady, failed: false },
  ];
  const barRange = { minMs: C.loadingBarMinSeconds * 1000, maxMs: C.loadingBarMaxSeconds * 1000 };
  const barCount = forwardRows.length;
  // Each bar's run time is random in the config's range, drawn once per loading run.
  const [barDurations, setBarDurations] = useState<readonly number[]>(() => pickBarDurations(barCount, barRange, Math.random));
  // The bars complete one at a time: barTicks are complete. barAnimDone: the active bar's own run time is over.
  const [barTicks, setBarTicks] = useState(0);
  const [barAnimDone, setBarAnimDone] = useState(false);
  const barsDone = barTicks >= barCount;
  const activeStepDone = !barsDone && (forwardRows[barTicks]?.done === true || forwardRows[barTicks]?.failed === true);

  // The loading page holds for its minimum time, counted from when it appears (and again after a retry).
  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = window.setTimeout(() => setLoadHold(true), C.handoffLoadSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [phase, runId]);

  // The active bar runs for its random time.
  useEffect(() => {
    if (phase !== 'loading' || barsDone || barAnimDone) return;
    const timer = window.setTimeout(() => setBarAnimDone(true), barDurations[barTicks] ?? 0);
    return () => window.clearTimeout(timer);
  }, [phase, barsDone, barAnimDone, barTicks, barDurations, runId]);

  // A bar completes once its run time is over and its real step is done. The next bar then starts.
  useEffect(() => {
    if (phase !== 'loading' || barsDone || !barAnimDone || !activeStepDone) return;
    const timer = window.setTimeout(() => {
      setBarTicks((count) => count + 1);
      setBarAnimDone(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [phase, barsDone, barAnimDone, activeStepDone]);

  // Reveal the game once the steps, the game's canvas, the hold, and every bar have all finished.
  const revealReady = phase === 'loading' && canReveal({ outcome, gameReady, holdDone: loadHold, barsDone });
  useEffect(() => {
    if (!revealReady) return;
    const timer = window.setTimeout(() => setPhase('revealing'), 0);
    return () => window.clearTimeout(timer);
  }, [revealReady]);
  useEffect(() => {
    if (phase !== 'revealing') return;
    const timer = window.setTimeout(() => setPhase('game'), C.revealFadeMs);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // The way back. The loading page holds over the game, and the front page must be drawn before the camera moves.
  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setLeaveHold(true), C.handoffLoadSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);
  const leaveReady = phase === 'leaving' && canReturn({ holdDone: leaveHold, homeReady });
  useEffect(() => {
    if (!leaveReady) return;
    const timer = window.setTimeout(() => {
      const back = returnPose.current;
      setSnapshot(readSaveSnapshot());
      setMove((current) =>
        back ? { token: current.token + 1, kind: 'fromBack', to: back } : { token: current.token + 1, kind: 'none' },
      );
      setPhase('returning');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [leaveReady]);

  // When the camera has returned, the game is taken down and the front page is the page again.
  useEffect(() => {
    if (phase !== 'returning') return;
    const timer = window.setTimeout(() => {
      setGameMounted(false);
      setRunId(null);
      setPhase('landing');
    }, C.handoffMoveSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const startEntry = () => {
    if (view === 'showroom') {
      // The garage has no hero camera to move. Show the front page first, then start the handoff in the same press
      // (see the effect below). Before this, the press only showed the front page, which read as a return to home.
      enterAfterLandingRef.current = true;
      setView('landing');
      return;
    }
    if (phase !== 'landing') return;
    returnPose.current = poseRef.current ? { ...poseRef.current } : null;
    setFailed(false);
    setSteps(initialSteps());
    setOutcome(null);
    setGameReady(false);
    setLoadHold(false);
    setBarTicks(0);
    setBarAnimDone(false);
    setBarDurations(pickBarDurations(barCount, barRange, Math.random));
    setGameMounted(false);
    setMove((current) => ({ token: current.token + 1, kind: 'toBack' }));
    setPhase('entering');
  };

  const cancelEntry = () => {
    setRunId(null);
    setGameMounted(false);
    setFailed(false);
    setSteps(initialSteps());
    setOutcome(null);
    setGameReady(false);
    setLoadHold(false);
    setMove((current) => ({ token: current.token + 1, kind: 'none' }));
    setHeroKey((key) => key + 1);
    setPhase('landing');
  };

  const retryEntry = () => {
    setFailed(false);
    setSteps(initialSteps());
    setOutcome(null);
    setGameReady(false);
    setLoadHold(false);
    setBarTicks(0);
    setBarAnimDone(false);
    setBarDurations(pickBarDurations(barCount, barRange, Math.random));
    setGameMounted(true);
    setRunId((previous) => (previous ?? 0) + 1);
  };

  // A press of ENTER GAME from the garage waits for the front page's hero to mount, then starts the entry.
  useEffect(() => {
    if (view !== 'landing' || phase !== 'landing' || !enterAfterLandingRef.current) return;
    enterAfterLandingRef.current = false;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => startEntry()));
    // startEntry reads the current view and phase, which this effect's deps cover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, phase]);

  const toggleView = () => {
    setView((current) => (current === 'showroom' ? 'landing' : 'showroom'));
  };

  // The hero's view: the front page's template, except while the camera is at the back view.
  const heroGoal = phase === 'landing' || phase === 'returning' ? homeView : BACK_VIEW_INDEX;
  const reverse = phase === 'leaving' || phase === 'returning';
  const reverseRows: BarRow[] = [
    { id: 'leave', label: 'Leaving the road', done: true, failed: false },
    { id: 'home', label: 'Drawing the front page', done: homeReady, failed: false },
  ];
  const failedStep = steps.find((step) => step.status === 'failed') ?? null;
  // Layers. The game sits at the back from ENTER GAME until the front page is shown again. The front page stage is
  // opaque, so it hides the game when it is shown; the stage is hidden while the loading page is over the game.
  const gameShown = phase === 'loading' || phase === 'revealing' || phase === 'leaving' || phase === 'game';
  const veilShown = phase === 'loading' || phase === 'revealing' || phase === 'leaving' || phase === 'returning';
  const veilOut = phase === 'revealing' || phase === 'returning';
  const chrome = phase === 'landing' || phase === 'entering' || phase === 'returning';


  const rootClass = [
    'ex-root',
    reducedMotion ? 'ex-reduced' : '',
    phase === 'entering' ? 'ex-moving' : '',
    phase === 'revealing' ? 'ex-revealing' : '',
    view === 'showroom' ? 'ex-garage-view' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <main className={rootClass}>
      {gameMounted ? (
        <div className={gameShown ? 'ex-game-slot' : 'ex-game-slot ex-hidden'}>
          <GameLayer onReady={markGameReady} interactive={phase === 'game'} onLeave={leaveGame} />
        </div>
      ) : null}
      {phase === 'game' ? null : (
        <>
{phase === 'loading' || phase === 'revealing' ? null : (
            <div className={phase === 'leaving' ? 'ex-stage ex-hidden' : 'ex-stage'}>
            <HeroBoundary>
              {view === 'landing' ? (
                <HeroStage
                  key={heroKey}
                  car={snapshot.car}
                  reducedMotion={reducedMotion}
                  view={heroGoal}
                  move={move}
                  poseRef={poseRef}
                />
              ) : (
                <ShowroomStage car={snapshot.car} view={showroomView} reducedMotion={reducedMotion} />
              )}
            </HeroBoundary>
            {phase === 'leaving' ? <CanvasProbe scope=".ex-stage" onReady={markHomeReady} /> : null}
          </div>
          )}

          {chrome ? <div className="ex-shade" aria-hidden="true" /> : null}

          {chrome ? (
            <div className={phase === 'entering' ? 'ex-brand ex-moving-out' : 'ex-brand'}>
              <Wordmark className="ex-wordmark" />
              <p className="ex-build">DRIVE WITHOUT END</p>
            </div>
          ) : null}

          {view === 'showroom' && phase === 'landing' ? (
            <ShowroomPanel car={snapshot.car} view={showroomView} onView={setShowroomView} />
          ) : null}

          {chrome ? (
            <section className="ex-entry" aria-label="Entry">
              {phase === 'landing' || phase === 'returning' ? (
                <>
                  <button type="button" className="ex-btn ex-btn-primary" onClick={startEntry}>
                    <span>ENTER GAME</span>
                    <span className="ex-arrow" aria-hidden="true">
                      →
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ex-btn ex-btn-outline"
                    aria-pressed={view === 'showroom'}
                    onClick={(event) => {
                      event.currentTarget.blur();
                      toggleView();
                    }}
                  >
                    {view === 'showroom' ? 'LANDING' : 'GARAGE'}
                  </button>
                </>
              ) : null}
            </section>
          ) : null}

          {veilShown ? (
            reverse ? (
              <LoadingVeil kicker="Back to the front page" rows={reverseRows} out={veilOut} footnote={null}>
                {null}
              </LoadingVeil>
            ) : (
              <LoadingVeil
                kicker={failed ? 'Could not start' : 'Preparing the road'}
                rows={forwardRows}
                sequence={{ ticked: barTicks, durations: barDurations }}
                out={veilOut}
                footnote={failed ? (failedStep?.error ?? 'The step did not finish.') : null}
              >
                {failed ? (
                  <>
                    <button type="button" className="ex-btn ex-btn-primary ex-btn-inline" onClick={retryEntry}>
                      RETRY
                    </button>
                    <a className="ex-link" href="./play.html">
                      Open the game page
                    </a>
                  </>
                ) : (
                  <button type="button" className="ex-btn-quiet" onClick={cancelEntry}>
                    Cancel
                  </button>
                )}
              </LoadingVeil>
            )
          ) : null}

          {chrome ? (
            <aside className={phase === 'entering' ? 'ex-meta ex-moving-out' : 'ex-meta'}>
              <SaveStatus snapshot={snapshot} />
              <ControlsInfo classPrefix="ex" />
            </aside>
          ) : null}
        </>
      )}
    </main>
  );
}
