import { Box3, Frustum, PerspectiveCamera, Vector3, type Group, type WebGLRenderer } from 'three';
import { createChaseCameraState, speedFraction, updateChaseCamera, type ChaseCameraState } from '../camera/chaseCamera';
import { CHASE_CAMERA_CONFIG } from '../config/cameraConfig';
import { evaluateGarageEntryAt } from '../garage/garageGate';
import { useGarageUiStore } from '../state/garageUiStore';
import { useCareerUiStore } from '../state/careerUiStore';
import { useConfirmUiStore } from '../state/confirmUiStore';
import { useEnvironmentStore } from '../state/environmentStore';
import { useQualityStore } from '../state/qualityStore';
import { useRaceStore } from '../state/raceStore';
import { getAudioSession, pageHasUserActivation } from '../audio/audioSession';
import { effectFeed } from './effectFeed';
import { slipAngleRadians } from '../simulation/vehicle';
import { evaluateCareerHubGate } from '../career/careerHubGate';
import {
  DIAGNOSTICS_PUBLISH_INTERVAL_SECONDS,
  FIXED_STEP_SECONDS,
  HUD_PUBLISH_INTERVAL_SECONDS,
  MAX_FRAME_SECONDS,
  ROAD_CHECK_AHEAD_METERS,
  ROAD_CHECK_BEHIND_METERS,
  VISIBILITY_CHECK_INTERVAL_SECONDS,
} from '../config/simulationConfig';
import type { InputState } from '../core/types';
import { metersPerSecondToKph, metersPerSecondToMph } from '../core/units';
import { GameSimulation } from '../engine/gameSimulation';
import type { GameAction } from '../input/keyBindings';
import type { RaceController } from '../race/raceController';
import type { RaceVisualPool } from './raceVisuals';
import type { NavigationScene } from './navigationScene';
import type { InputController } from '../input/inputController';
import { useAppStore } from '../state/appStore';
import { useDiagnosticsStore } from '../diagnostics/diagnosticsStore';
import { buildDiagnosticsSnapshot, PHYSICS_MODE_LABEL, type RendererStatus } from '../diagnostics/snapshot';
import { buildTrafficDiagnostics } from '../diagnostics/trafficDiagnostics';
import { isBoundsInFrustum, updateFrustumFromCamera } from '../diagnostics/visibility';
import { getDriveDirection, isDrifting } from '../simulation/vehicle';
import { getRoadSegmentBoundsSim } from '../world/roadLayout';
import type { WorldDefinition } from '../world/worlds';
import { validateRoadNetwork } from '../world/roadValidation';
import { renderBoundsFromSim, setRenderVectorFrom } from './renderSpace';
import { applyWorldOrigin, type PlanarOrigin, type WorldOriginTargets } from './worldOrigin';
import { wrapToBase } from '../world/wrap/worldWrap';
import { setMinimapPose } from '../ui/minimapPose';
import { applyVehicleRig, resolveVehicleRig, type VehicleRig } from './vehicleRig';
import type { TrafficVisualPool } from './trafficVisuals';
import type { PursuitController } from '../pursuit/pursuitController';
import type { PoliceVisualPool } from './policeVisuals';
import type { WorldStreamer } from '../world/streaming/streamer';
import { forwardFromYaw } from '../core/coordinates';

/*
 * The per-frame orchestration for the single authoritative game loop. Each tick:
 *   1. consumes queued actions (pause, reset, debug panel)
 *   2. samples held input once, and advances the fixed-step simulation (the only place simulation state changes)
 *   3. writes the interpolated pose to the vehicle object and camera (render-only)
 *   4. publishes HUD values at about 10 Hz, and dev diagnostics at a few Hz
 * React is not involved per frame. This class is owned by GameLoopDriver and driven by R3F's useFrame.
 */

const DIAGNOSTICS_ENABLED = import.meta.env.DEV;
const CHASE_CAMERA_NAME = 'ChaseCamera';
const NEUTRAL_INPUT: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
/** Development overview camera pose, simulation space. Fixed above the test circuit, looking at its centre. */
const OVERVIEW_POSITION = { x: -180, y: 500, z: -260 };
const OVERVIEW_TARGET = { x: -180, y: 0, z: 170 };
const OVERVIEW_FOV_DEGREES = 55;

export interface RenderTickContext {
  deltaSeconds: number;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  vehicle: Group | null;
}

interface IntervalTimers {
  hud: number;
  diagnostics: number;
  visibility: number;
}

/** Returns whether an interval has elapsed, and the new accumulated time. */
function advanceInterval(elapsed: number, deltaSeconds: number, intervalSeconds: number): { fired: boolean; elapsed: number } {
  const next = elapsed + deltaSeconds;
  return next >= intervalSeconds ? { fired: true, elapsed: 0 } : { fired: false, elapsed: next };
}

/** Frame time used for timers and camera damping. The simulation clamps its own input separately. */
function clampFrameSeconds(deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return 0;
  return Math.min(deltaSeconds, MAX_FRAME_SECONDS);
}

function rendererStatusFrom(renderer: WebGLRenderer, frameCount: number): RendererStatus {
  const gl = renderer.getContext();
  const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  return {
    status: frameCount > 0 ? 'ready' : 'initializing',
    backend: isWebGL2 ? 'WebGL2' : 'WebGL1',
    drawCallsLastFrame: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  };
}

/** Actions that open, close, or change a menu-type setting. Each plays the UI click. */
const MENU_ACTIONS: ReadonlySet<GameAction> = new Set<GameAction>(['garage', 'career', 'timeOfDay', 'weather', 'quality']);

export class RenderLoop {
  private readonly simulation: GameSimulation;
  private readonly input: InputController;
  private readonly chase: ChaseCameraState = createChaseCameraState();
  private readonly timers: IntervalTimers = { hud: 0, diagnostics: 0, visibility: 0 };
  private readonly frustum = new Frustum();
  private readonly vehicleBounds = new Box3();
  private readonly roadBounds = new Box3();
  private readonly worldBounds: Box3 | null;
  private readonly world: WorldDefinition;
  private readonly trafficVisuals: TrafficVisualPool | null;
  private readonly opponentVisuals: TrafficVisualPool | null;
  /** Race controller and its visuals, or null outside a race-enabled world. */
  private readonly race: RaceController | null;
  private readonly raceVisuals: RaceVisualPool | null;
  private readonly navigation: NavigationScene | null;
  /** Police pursuit controller and its visuals, or null in worlds without a pursuit. */
  private readonly pursuit: PursuitController | null;
  private readonly policeVisuals: PoliceVisualPool | null;
  /** World streamer for the chunked city, or null in worlds that are not streamed. Read by the frame loop only. */
  private readonly streamer: WorldStreamer | null;
  /** Floating-origin targets, or null when none are mounted (tests). Written once per frame. */
  private readonly origin: WorldOriginTargets | null;
  /** The origin written this frame, in simulation metres. Zero for finite worlds. Reused each frame. */
  private readonly planarOrigin: PlanarOrigin = { x: 0, z: 0 };
  /** Accumulated unpaused frame time. Drives the light bar flash, so the lights stop when the game is paused. */
  private lightSeconds = 0;
  /** Busted resets seen by the camera. A change snaps the camera once. */
  private lastBustCount = 0;
  private readonly roadValidation: { valid: boolean; issueCount: number; connectionCount: number } | null;
  private readonly cameraTarget = new Vector3();
  private overview = false;
  private rigRoot: Group | null = null;
  private lastVolume: number | null = null;
  private lastPursuitState = 'INACTIVE';
  private readonly lastRaceCue: { phase: string; countdown: number | null; goVisible: boolean; nextGate: string | null } = { phase: '', countdown: null, goVisible: false, nextGate: null };
  private rig: VehicleRig | null = null;
  private vehicleInFrustum = false;
  private roadInFrustum = false;
  private frameCount = 0;
  private started = false;

  constructor(
    simulation: GameSimulation,
    input: InputController,
    world: WorldDefinition,
    trafficVisuals: TrafficVisualPool | null = null,
    opponentVisuals: TrafficVisualPool | null = null,
    race: RaceController | null = null,
    raceVisuals: RaceVisualPool | null = null,
    pursuit: PursuitController | null = null,
    policeVisuals: PoliceVisualPool | null = null,
    streamer: WorldStreamer | null = null,
    origin: WorldOriginTargets | null = null,
    navigation: NavigationScene | null = null,
  ) {
    this.navigation = navigation;
    this.streamer = streamer;
    this.origin = origin;
    this.simulation = simulation;
    this.input = input;
    this.world = world;
    this.trafficVisuals = trafficVisuals;
    this.opponentVisuals = opponentVisuals;
    this.race = race;
    this.raceVisuals = raceVisuals;
    this.pursuit = pursuit;
    this.policeVisuals = policeVisuals;
    this.worldBounds = world.bounds
      ? new Box3(
          new Vector3(world.bounds.minX, -1, world.bounds.minZ),
          new Vector3(world.bounds.maxX, 1, world.bounds.maxZ),
        )
      : null;
    if (world.network) {
      const report = validateRoadNetwork(world.network);
      this.roadValidation = { valid: report.valid, issueCount: report.issues.length, connectionCount: report.connectionCount };
    } else {
      this.roadValidation = null;
    }
  }

  tick(context: RenderTickContext): void {
    const { camera, vehicle } = context;
    const frameSeconds = clampFrameSeconds(context.deltaSeconds);
    camera.name = CHASE_CAMERA_NAME;

    for (const action of this.input.consumeActions()) {
      this.handleAction(action);
    }

    // The garage parks the car like a pause, and it blocks every gameplay action (see handleAction).
    const paused =
      useAppStore.getState().paused ||
      useGarageUiStore.getState().open ||
      useCareerUiStore.getState().open ||
      useConfirmUiStore.getState().request !== null;
    // Race timing follows the same pause as the car: a paused race does not advance, and resuming keeps the countdown.
    this.race?.syncPaused(paused);
    const inputState: InputState = paused ? NEUTRAL_INPUT : this.input.sample();
    if (!paused) {
      this.simulation.update(frameSeconds, inputState);
    }
    // A busted reset moves the car to the spawn in one step. The camera snaps with it, as it does for R, so it never
    // sweeps across the map from the capture point.
    if (this.simulation.bustCount !== this.lastBustCount) {
      this.lastBustCount = this.simulation.bustCount;
      this.chase.initialized = false;
    }
    const pose = this.simulation.getRenderState();
    // Part 10 presentation feed. Plain numbers, read only: effects and audio never change the physics or the body.
    effectFeed.active = true;
    effectFeed.x = pose.position.x;
    effectFeed.z = pose.position.z;
    effectFeed.yaw = pose.yaw;
    effectFeed.speed = pose.speed;
    effectFeed.lateralSpeed = pose.speed * Math.sin(slipAngleRadians(pose));
    effectFeed.handbrake = inputState.handbrake > 0.5;
    effectFeed.throttle = inputState.throttle;
    effectFeed.wheelSpin = pose.wheelSpin;
    this.tickAudio(paused, inputState, pose.speed);
    // Floating origin. The looping world draws relative to the car, and the camera uses the same origin. A finite world
    // keeps the origin at zero, so its scene is unchanged.
    const loopPeriod = this.world.periodMeters;
    this.planarOrigin.x = loopPeriod !== null ? pose.position.x : 0;
    this.planarOrigin.z = loopPeriod !== null ? pose.position.z : 0;
    if (this.origin) applyWorldOrigin(this.origin, this.planarOrigin);
    // Minimap marker pose. Written as plain values, so it causes no React work. The looping world's minimap shows one
    // period, so the marker is wrapped into the base domain.
    setMinimapPose(
      loopPeriod !== null ? wrapToBase(pose.position.x, loopPeriod) : pose.position.x,
      loopPeriod !== null ? wrapToBase(pose.position.z, loopPeriod) : pose.position.z,
      pose.yaw,
    );
    // World streaming follows the car. Reverse driving flips the direction, so the chunks ahead of the car load first.
    if (this.streamer) {
      const ahead = forwardFromYaw(pose.yaw);
      const sign = pose.speed < 0 ? -1 : 1;
      this.streamer.update({
        x: pose.position.x,
        z: pose.position.z,
        forward: { x: sign * ahead.x, z: sign * ahead.z },
        speedMps: Math.abs(pose.speed),
      });
    }

    // Traffic visuals are copied from the traffic state after the simulation update. Read only.
    const traffic = this.simulation.traffic;
    if (this.trafficVisuals && traffic) {
      this.trafficVisuals.sync(traffic.system.vehicles, { x: pose.position.x, z: pose.position.z, period: loopPeriod });
    }
    const opponents = this.simulation.opponents;
    if (this.opponentVisuals) {
      // No opponents means every slot is hidden. The pool is sized for the most opponents a world can have.
      // A retired opponent has left the race, so its slot is not written and stays hidden.
      this.opponentVisuals.sync(opponents ? opponents.opponents.filter((opponent) => !opponent.retired).map((opponent) => ({
        id: opponent.id,
        active: true,
        typeId: opponent.typeId,
        x: opponent.state.position.x,
        y: opponent.state.position.y,
        z: opponent.state.position.z,
        heading: opponent.state.yaw,
      })) : []);
    }
    if (this.race && this.raceVisuals) this.raceVisuals.sync(this.race, { x: pose.position.x, z: pose.position.z, period: loopPeriod });
    // The route is recomputed at a low rate inside the scene; this only moves the garage ring and checks for a change.
    if (this.navigation) this.navigation.update(frameSeconds, { x: pose.position.x, z: pose.position.z });
    if (!paused) this.lightSeconds += frameSeconds;
    // Police visuals are copied from the pursuit's units after the simulation update. Read only.
    if (this.pursuit && this.policeVisuals) {
      this.policeVisuals.sync(this.pursuit.visualUnits(), this.lightSeconds, { x: pose.position.x, z: pose.position.z, period: loopPeriod });
    }

    const rig = this.resolveRig(vehicle);
    if (rig) applyVehicleRig(rig, pose, this.simulation.getRenderBody(), this.simulation.getRenderRoadPitch());

    if (this.overview) {
      // Development overview: a fixed pose, so the road layout can be checked at a glance. The chase state is
      // not advanced, and it snaps back on exit.
      if (camera.fov !== OVERVIEW_FOV_DEGREES) {
        camera.fov = OVERVIEW_FOV_DEGREES;
        camera.updateProjectionMatrix();
      }
      setRenderVectorFrom(camera.position, OVERVIEW_POSITION, this.planarOrigin);
      camera.lookAt(setRenderVectorFrom(this.cameraTarget, OVERVIEW_TARGET, this.planarOrigin));
    } else {
      // A zero step while paused freezes the camera. Reset snaps it because `initialized` was cleared.
      updateChaseCamera(this.chase, pose, CHASE_CAMERA_CONFIG, this.simulation.vehicleConfig.maxForwardSpeedMps, paused ? 0 : frameSeconds);
      if (camera.fov !== this.chase.fovDegrees) {
        camera.fov = this.chase.fovDegrees;
        camera.updateProjectionMatrix();
      }
      setRenderVectorFrom(camera.position, this.chase.position, this.planarOrigin);
      camera.lookAt(setRenderVectorFrom(this.cameraTarget, this.chase.target, this.planarOrigin));
    }

    if (!this.started) {
      this.started = true;
      useAppStore.getState().setStatus('running');
    }
    this.publishHud(frameSeconds);

    if (DIAGNOSTICS_ENABLED) {
      this.publishDiagnostics(context, frameSeconds, inputState, paused);
    }
    this.frameCount += 1;
  }

  /** Resolves the named rig nodes once per vehicle root. Never called per node per frame. */
  private resolveRig(root: Group | null): VehicleRig | null {
    if (root !== this.rigRoot) {
      this.rigRoot = root;
      this.rig = root ? resolveVehicleRig(root) : null;
    }
    return this.rig;
  }

  private handleAction(action: GameAction): void {
    // Menu-type actions play one short UI click (Part 10). Silent while the game is paused, by design.
    if (MENU_ACTIONS.has(action)) getAudioSession().cue('uiClick');
    // While the garage is open the car is parked. Only V and Esc act, and both close it. Every other action is ignored,
    // so no race, reset, or pause can start under the garage.
    if (useGarageUiStore.getState().open) {
      if (action === 'garage' || action === 'pause') useGarageUiStore.getState().close();
      return;
    }
    // The career hub parks the car the same way. Only C and Esc act, and both close it.
    if (useCareerUiStore.getState().open) {
      if (action === 'career' || action === 'pause') useCareerUiStore.getState().close();
      return;
    }
    switch (action) {
      case 'pause':
        useAppStore.getState().togglePause();
        break;
      case 'reset':
        // A race locks reset: a reset would move the car out of the race. The race explains the refusal.
        if (this.race?.blocksReset()) {
          this.race.refuseReset();
          break;
        }
        this.simulation.reset();
        // Reset versus traffic (decided in Part 6): R also clears AI traffic and restores its spawn requests. Otherwise
        // a car already on the road can drive into the car at its spawn pose on the first frames after R. The spawner's
        // own rules still keep new traffic away from the player.
        this.simulation.resetTraffic();
        // The camera snaps on the next frame. Its heading, lag, and FOV reset with it.
        this.chase.initialized = false;
        // Show the reset speed on the next frame, not after the normal HUD interval.
        this.timers.hud = HUD_PUBLISH_INTERVAL_SECONDS;
        break;
      case 'debugPanel':
        // Shift + ` in every build. The panel is read-only, and it is hidden until it is opened.
        useDiagnosticsStore.getState().togglePanel();
        break;
      case 'roadDebug':
        if (DIAGNOSTICS_ENABLED) useDiagnosticsStore.getState().toggleRoadDebug();
        break;
      case 'trafficReset':
        // Development only: clears traffic and restores the scenario's spawn requests. The player is not affected.
        if (DIAGNOSTICS_ENABLED) this.simulation.resetTraffic();
        break;
      case 'devReset':
        // Development only: moves the player to the world's explicit DEV reset pose. Normal reset (R) is unchanged.
        if (DIAGNOSTICS_ENABLED && this.race?.blocksReset()) {
          this.race.refuseReset();
        } else if (DIAGNOSTICS_ENABLED) {
          this.simulation.devReset();
        }
        break;
      case 'raceConfirm':
        if (this.race && this.race.confirm()) {
          // The car was placed on the grid: the chase camera snaps to it rather than sweeping across the map.
          this.chase.initialized = false;
        }
        // Show the race state on the next frame.
        this.timers.hud = HUD_PUBLISH_INTERVAL_SECONDS;
        break;
      case 'raceCancel':
        this.race?.cancel();
        this.timers.hud = HUD_PUBLISH_INTERVAL_SECONDS;
        break;
      case 'garage':
        this.toggleGarage();
        break;
      case 'career':
        this.toggleCareer();
        break;
      case 'timeOfDay':
        useEnvironmentStore.getState().cycleTimeOfDay();
        break;
      case 'weather':
        useEnvironmentStore.getState().cycleWeather();
        break;
      case 'quality':
        useQualityStore.getState().cycleQuality();
        break;
      case 'environmentAuto':
        useEnvironmentStore.getState().toggleAutomatic();
        break;
      case 'overview':
        if (DIAGNOSTICS_ENABLED) {
          this.overview = !this.overview;
          // Leaving the overview snaps the chase camera back to the car, with no sweep from the overview pose.
          this.chase.initialized = false;
        }
        break;
      default: {
        const unhandled: never = action;
        throw new Error(`Unhandled action: ${String(unhandled)}`);
      }
    }
  }

  private publishHud(frameSeconds: number): void {
    const timer = advanceInterval(this.timers.hud, frameSeconds, HUD_PUBLISH_INTERVAL_SECONDS);
    this.timers.hud = timer.elapsed;
    if (!timer.fired) return;
    const state = this.simulation.state;
    useAppStore.getState().setHud({
      speedKph: Math.abs(metersPerSecondToKph(state.speed)),
      speedMph: Math.abs(metersPerSecondToMph(state.speed)),
      speedFraction: speedFraction(state.speed, this.simulation.vehicleConfig.maxForwardSpeedMps),
      direction: getDriveDirection(state.speed),
      drifting: isDrifting(state, this.simulation.vehicleConfig),
    });
    this.race?.publish();
    this.pursuit?.publish();
  }

  /** Development only. Visibility is checked at a low rate, and the snapshot is published at a low rate. */
  /** Opens the garage if the entry rules allow it. Otherwise the reason is shown in the garage launcher. */
  private toggleGarage(): void {
    const ui = useGarageUiStore.getState();
    const state = this.simulation.state;
    const decision = evaluateGarageEntryAt({
      position: state.position,
      speedMps: state.speed,
      entrance: this.world.garage,
      periodMeters: this.world.periodMeters,
      // The controller's own phase, not the 10 Hz HUD snapshot: a key press can land between snapshots.
      racePhase: this.race ? this.race.phase : 'FREE_ROAM',
      pursuitState: this.pursuit ? this.pursuit.session.currentState : 'INACTIVE',
    });
    // A refusal changes nothing. The launcher shows the same rule's reason next to the button.
    if (decision.allowed) ui.show();
    this.timers.hud = HUD_PUBLISH_INTERVAL_SECONDS;
  }

  /**
   * Audio for this tick. Engine, tyre noise, rain, and the siren follow real state. Race cues fire on real race
   * transitions, and the siren cue fires when a pursuit starts. Nothing here allocates per frame.
   */
  private tickAudio(paused: boolean, input: InputState, speed: number): void {
    const audio = getAudioSession();
    // The unlock waits for the page's first user gesture. No listener is needed for it (see audioSession).
    audio.tryUnlock(pageHasUserActivation());
    audio.setPaused(paused);
    const volume = useQualityStore.getState().volume;
    if (volume !== this.lastVolume) {
      this.lastVolume = volume;
      audio.setVolume(volume);
    }
    const pursuitState = this.pursuit ? this.pursuit.session.currentState : 'INACTIVE';
    // Cue tracking runs even while paused. A change that happens during a pause is recorded here, so it is not played
    // later on resume: cue() ignores every request while the audio is paused.
    if (pursuitState === 'INITIATING' && this.lastPursuitState !== 'INITIATING') audio.cue('sirenStart');
    this.lastPursuitState = pursuitState;
    const snap = useRaceStore.getState().snapshot;
    const last = this.lastRaceCue;
    if (snap.countdown !== null && snap.countdown !== last.countdown) audio.cue('countdown');
    if (snap.goVisible && !last.goVisible) audio.cue('go');
    if (snap.phase === 'RACING' && last.nextGate !== null && snap.nextGate !== last.nextGate) audio.cue('checkpoint');
    if (snap.phase === 'FINISHED' && last.phase !== 'FINISHED') audio.cue('finish');
    last.phase = snap.phase;
    last.countdown = snap.countdown;
    last.goVisible = snap.goVisible;
    last.nextGate = snap.nextGate;
    if (paused) return;
    audio.update({
      speedMetersPerSecond: speed,
      throttle: input.throttle,
      lateralSpeedMetersPerSecond: effectFeed.lateralSpeed,
      handbrake: effectFeed.handbrake,
      pursuitState,
      rainWetness: useEnvironmentStore.getState().weather === 'rain' ? 1 : 0,
    });
  }

  /** Opens the career hub if no race or pursuit is in the way. The hub changes no progress, so opening it grants nothing. */
  private toggleCareer(): void {
    const decision = evaluateCareerHubGate({
      racePhase: this.race ? this.race.phase : 'FREE_ROAM',
      pursuitState: this.pursuit ? this.pursuit.session.currentState : 'INACTIVE',
    });
    if (decision.allowed) useCareerUiStore.getState().show();
    this.timers.hud = HUD_PUBLISH_INTERVAL_SECONDS;
  }

  private publishDiagnostics(context: RenderTickContext, frameSeconds: number, inputState: InputState, paused: boolean): void {
    const { camera, renderer, vehicle } = context;

    const visibilityTimer = advanceInterval(this.timers.visibility, frameSeconds, VISIBILITY_CHECK_INTERVAL_SECONDS);
    this.timers.visibility = visibilityTimer.elapsed;
    if (visibilityTimer.fired && vehicle) {
      updateFrustumFromCamera(this.frustum, camera);
      this.vehicleBounds.setFromObject(vehicle);
      this.vehicleInFrustum = isBoundsInFrustum(this.frustum, this.vehicleBounds);
      // Visibility is checked on the road stretch around the car, not the whole 4 km road.
      if (this.worldBounds) {
        // A network world: the whole network is one bounds check, computed once at construction.
        this.roadBounds.copy(this.worldBounds);
      } else {
        // Legacy straight road: check only the stretch around the car.
        const segment = getRoadSegmentBoundsSim(this.simulation.state.position.z, ROAD_CHECK_BEHIND_METERS, ROAD_CHECK_AHEAD_METERS);
        this.roadBounds.copy(renderBoundsFromSim(segment));
      }
      this.roadInFrustum = isBoundsInFrustum(this.frustum, this.roadBounds);
    }

    const publishTimer = advanceInterval(this.timers.diagnostics, frameSeconds, DIAGNOSTICS_PUBLISH_INTERVAL_SECONDS);
    this.timers.diagnostics = publishTimer.elapsed;
    if (!publishTimer.fired) return;

    const authoritative = this.simulation.state;
    useDiagnosticsStore.getState().setSnapshot(
      buildDiagnosticsSnapshot({
        streaming: DIAGNOSTICS_ENABLED && this.streamer ? this.streamer.stats() : null,
        nowMs: Date.now(),
        renderer: rendererStatusFrom(renderer, this.frameCount),
        cameraName: camera.name,
        cameraFovDegrees: camera.fov,
        cameraNear: camera.near,
        cameraFar: camera.far,
        chase: this.chase,
        vehicle: authoritative,
        body: this.simulation.body,
        drifting: isDrifting(authoritative, this.simulation.vehicleConfig),
        input: inputState,
        pressedKeys: this.input.pressedKeys,
        paused,
        physics: {
          mode: PHYSICS_MODE_LABEL,
          fixedStepSeconds: FIXED_STEP_SECONDS,
          stepCount: this.simulation.stepCount,
          droppedSeconds: this.simulation.droppedSeconds,
          interpolationAlpha: this.simulation.interpolationAlpha,
        },
        vehicleInFrustum: this.vehicleInFrustum,
        roadInFrustum: this.roadInFrustum,
        road: {
          worldId: this.world.id,
          worldLabel: this.world.label,
          segmentCount: this.world.network?.segments.length ?? 0,
          connectionCount: this.roadValidation?.connectionCount ?? 0,
          validationValid: this.roadValidation?.valid ?? true,
          validationIssueCount: this.roadValidation?.issueCount ?? 0,
          currentSegmentId: this.simulation.currentRoadSegmentId,
          contact: this.simulation.roadContact,
          contactSteps: this.simulation.roadContactSteps,
          cameraMode: this.overview ? 'overview' : 'chase',
          roadDebugVisible: useDiagnosticsStore.getState().roadDebug,
          recoveryCount: this.simulation.recoveryCount,
          lastRecovery: this.simulation.lastRecoveryReason,
        },
        traffic: buildTrafficDiagnostics(this.simulation.traffic, this.simulation.opponents),
      }),
    );
  }
}
