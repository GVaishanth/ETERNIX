import { Canvas } from '@react-three/fiber';
import { lazy, Suspense, useEffect, useState } from 'react';
import { CHASE_CAMERA_CONFIG } from './config/cameraConfig';
import { activeSpecs } from './garage/activeVehicle';
import { garageService } from './garage/garageService';
import { GarageLauncher } from './ui/GarageLauncher';
import { GameSimulation } from './engine/gameSimulation';
import { getWorldDefinition, parseWorldId } from './world/worlds';
import { devStartOverride } from './world/devStart';
import { createTrafficRuntime, isTrafficEnabled, playerFootprintFromConfig } from './traffic/trafficRuntime';
import { OpponentSystem } from './ai/aiOpponents';
import { InputController } from './input/inputController';
import { RenderLayer } from './render/RenderLayer';
import { Hud } from './ui/Hud';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { RaceHud } from './ui/RaceHud';
import { RaceController } from './race/raceController';
import { LOOP_RACE_EVENTS, RACE_EVENTS } from './race/raceEvents';
import { CAREER_RACE_EVENTS, CAREER_RACE_IDS } from './career/careerRaces';
import { CAREER_SESSION_ID, careerService } from './career/careerService';
import { careerRaceBlock, careerRaceVisible } from './career/careerModel';
import { CareerLauncher } from './ui/CareerLauncher';
import { CareerPrompt } from './ui/CareerPrompt';
import { PresentationStatus } from './ui/PresentationStatus';
import { useQualityStore } from './state/qualityStore';
import { QUALITY_PRESETS } from './config/qualityConfig';
import { installRaceDebug } from './race/raceDebug';
import { Minimap } from './ui/Minimap';
import { PursuitController } from './pursuit/pursuitController';
import { PursuitHud } from './ui/PursuitHud';
import { PURSUIT_CONFIG } from './config/pursuitConfig';
import { bustFineNotice } from './pursuit/bustNotice';
import { usePursuitStore } from './state/pursuitStore';
import { installPursuitDebug } from './pursuit/pursuitDebug';
import { disposeAudioSession, getAudioSession } from './audio/audioSession';
import { roadElevationFor } from './world/roadElevation';
import { setSurfaceWetnessSource } from './simulation/surfaceModel';
import { WEATHER_PRESETS } from './config/environmentConfig';
import { useEnvironmentStore } from './state/environmentStore';


// The diagnostics panel is in every build. It stays hidden until Shift + ` opens it, and it is read-only.
const DebugPanel = lazy(() => import('./diagnostics/DebugPanel').then((module) => ({ default: module.DebugPanel })));

export function App({ onLeave }: { readonly onLeave?: () => void } = {}) {
  // The canvas pixel ratio follows the quality setting (Part 10). Quality changes budgets only, never rules.
  const quality = useQualityStore((state) => QUALITY_PRESETS[state.quality]);
  // ?world=legacy loads the preserved straight road, ?world=circuit the test circuit. Otherwise the city (Part 5) loads.
  const [world] = useState(() => getWorldDefinition(parseWorldId(window.location.search)));
  // The simulation and the pursuit are built together. Police exist only in the city world, with traffic on (they witness
  // traffic collisions). The pursuit is the simulation's step host, so it must exist before the simulation.
  const [{ simulation, pursuit }] = useState(() => {
    // Traffic exists only where the world has a lane graph, and it can be turned off with ?traffic=off.
    const { network, lanes } = world;
    // Traffic runs on the looping world (Stage D). Police and opponents follow traffic, so their rules decide below.
    const trafficOn = network !== null && lanes !== null && isTrafficEnabled(window.location.search);
    // Part 8: the car the player owns and selected. The same effective-spec pipeline feeds the garage display.
    const startConfig = activeSpecs(garageService.getState()).config;
    const footprint = playerFootprintFromConfig(startConfig);
    const traffic = trafficOn ? createTrafficRuntime(network, lanes, world.boundary, world.trafficScenario, footprint, world.ambient) : null;
    // Opponents are AI traffic-class cars, so ?traffic=off turns them off as well.
    const opponents = trafficOn && lanes && world.opponents.length > 0 ? new OpponentSystem(lanes, world.boundary, world.opponents) : null;
    // Police run on the loop too (Stage D). Pursuit uses the same lane graph and wrap rules as traffic.
    const pursuit =
      world.city && trafficOn && lanes
        ? new PursuitController({
            onSessionEnd: (reason) => {
              // A pursuit that ends with the police giving up is an escape. Only the career counts it.
              if (reason === 'cooldown') careerService.recordEscape();
              // A busted pursuit takes a share of the credits, in one save. The car is sent to the spawn by the simulation.
              if (reason === 'busted') {
                const percent = PURSUIT_CONFIG.capture.bustFinePercent;
                usePursuitStore.getState().showBust(bustFineNotice(garageService, percent));
              }
            },
            graph: lanes,
            boundary: world.boundary,
            traffic: traffic ? traffic.system : null,
            playerFootprint: { rearMeters: footprint.rearMeters, frontMeters: footprint.noseMeters, halfWidthMeters: footprint.halfWidthMeters },
            spawn: { x: world.spawn.position.x, z: world.spawn.position.z, yaw: world.spawn.yawRadians },
          })
        : null;
    // Recovery returns the car to the nearest driving lane. The DEV reset pose is used only by the DEV reset action.
    const simulation = new GameSimulation(startConfig, {
      // DEV only. The check is here, not only inside devStartOverride, so the production build drops the parser.
      spawn: (import.meta.env.DEV ? devStartOverride(window.location.search, world, true) : null) ?? world.spawn,
      boundary: world.boundary,
      traffic,
      opponents,
      recoveryLanes: lanes ? lanes.lanes : null,
      // Road height and grade for the car. Null when the world has no lanes.
      elevation: lanes ? roadElevationFor(lanes) : null,
      devReset: world.devReset,
      pursuit,
    });
    return { simulation, pursuit };
  });
  const [input] = useState(() => new InputController());
  // Races run on the city and on the looping world, on their lane graphs. The controller is the only link between races and the simulation.
  // A race never starts while a pursuit is on: the entry gate refuses with a reason, which the race HUD shows.
  // A race reward is credited to the garage balance once per attempt (the race's ledger de-duplicates it). Part 8.
  // Career races (Part 9) are listed with the free-roam races. They are career events only by their ids: a career race's
  // credits are paid in the same commit as its career progress (careerService), not here, so they are never paid twice.
  const [race] = useState(() =>
    world.city && world.lanes
      ? new RaceController(
          simulation,
          world.lanes,
          world.boundary,
          // The seam sprint is listed only on the looping world (Stage D). Career races are unchanged.
          [...RACE_EVENTS, ...CAREER_RACE_EVENTS, ...(world.periodMeters !== null ? LOOP_RACE_EVENTS : [])],
          (eventId) => {
            if (pursuit && pursuit.session.currentState !== 'INACTIVE') return 'Lose the police before starting a race.';
            // A career race is refused with its reason while it is locked. A free-roam race is never blocked here.
            return careerRaceBlock(eventId, careerService.profile());
          },
          (grant) => {
            if (CAREER_RACE_IDS.has(grant.eventId)) return;
            garageService.earnCredits(grant.credits, `race ${grant.eventId}`);
          },
          (result) => {
            if (!CAREER_RACE_IDS.has(result.eventId)) return;
            // The official result decides. One commit records the progress and pays the race credits together.
            careerService.applyRaceResult({
              raceEventId: result.eventId,
              sessionId: CAREER_SESSION_ID,
              attemptId: result.attemptId,
              outcome: result.outcome,
              place: result.place,
              finishSeconds: result.finishSeconds,
              raceCredits: result.reward ? result.reward.credits : 0,
            });
          },
          // A career race is on the map and in the world only once it is unlocked, and not after its division retires.
          (eventId) => careerRaceVisible(eventId, careerService.profile()),
        )
      : null,
  );

  // Garage changes reach the simulation here, once, through the same effective-spec pipeline. Paint does not reach it:
  // the config object is the same when only the colour changes, so the car is not reset or rebuilt.
  useEffect(() => {
    const apply = () => {
      const { config } = activeSpecs(garageService.getState());
      if (simulation.vehicleConfig !== config) simulation.setVehicleConfig(config);
    };
    apply();
    return garageService.store.subscribe(apply);
  }, [simulation]);

  // The only keyboard listeners in the app. Removed on unmount, and re-attached cleanly under StrictMode.
  // The audio follows tab visibility through this same listener (no second visibility listener exists).
  useEffect(
    () => input.attach(window, document, { onVisibilityChange: (hidden) => getAudioSession().setHidden(hidden) }),
    [input],
  );

  // Audio is a page-wide singleton with window and document listeners and an AudioContext. Tear it down when the app
  // unmounts. The session is created again on demand if the app mounts again (StrictMode mounts twice in development).
  useEffect(() => () => disposeAudioSession(), []);
  // Dirt roads are slower in rain. The wetness is the current weather's preset, read each step.
  useEffect(() => setSurfaceWetnessSource(() => WEATHER_PRESETS[useEnvironmentStore.getState().weather].wetness), []);

  // Connects the race to the simulation for this mount, and disconnects it on unmount (StrictMode mounts twice in dev).
  useEffect(() => {
    if (!race) return;
    if (import.meta.env.DEV) {
      for (const line of race.diagnostics.routeIssues) console.warn(`[race] invalid route dropped: ${line}`);
    }
    race.attach();
    // The pursuit is frozen while a race is on. Its probe is connected here, since the race is created after the simulation.
    pursuit?.attachRaceProbe(() => race.blocksReset());
    // DEV only: read access and the staging call for browser tests. Not part of the production build.
    const removeDebug = import.meta.env.DEV ? installRaceDebug(window, race, simulation) : () => undefined;
    return () => {
      removeDebug();
      pursuit?.attachRaceProbe(null);
      race.detach();
    };
  }, [race, simulation, pursuit]);

  // DEV only: read access to the pursuit for browser tests and diagnostics. Not part of the production build.
  useEffect(() => {
    if (!import.meta.env.DEV || !pursuit || !world.lanes) return;
    return installPursuitDebug(window, pursuit, simulation, world.lanes);
  }, [pursuit, simulation, world]);

  return (
    <>
      <Canvas
        dpr={[1, quality.maxPixelRatio]}
        gl={{ antialias: true }}
        camera={{
          fov: CHASE_CAMERA_CONFIG.fovBaseDegrees,
          near: CHASE_CAMERA_CONFIG.nearMeters,
          far: CHASE_CAMERA_CONFIG.farMeters,
          position: [0, CHASE_CAMERA_CONFIG.heightMeters, 8],
        }}
      >
        <RenderLayer simulation={simulation} input={input} world={world} race={race} pursuit={pursuit} />
      </Canvas>
      <Hud onAction={(action) => input.queueAction(action)} onLeave={onLeave} />
      <CareerPrompt />
      {race ? <RaceHud onAction={(action) => input.queueAction(action)} /> : null}
      {pursuit ? <PursuitHud /> : null}
      <GarageLauncher
        simulation={simulation}
        race={race}
        pursuit={pursuit}
        world={world}
        onAction={(action) => input.queueAction(action)}
      />
      {race ? <CareerLauncher simulation={simulation} race={race} pursuit={pursuit} onAction={(action) => input.queueAction(action)} /> : null}
      {world.city && world.network ? <Minimap network={world.network} /> : null}
      <PresentationStatus />
      <ConfirmDialog />
      <Suspense fallback={null}>
        <DebugPanel />
      </Suspense>
    </>
  );
}
