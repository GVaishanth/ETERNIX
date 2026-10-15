import { Box3, Frustum, PerspectiveCamera, Vector3, type Group, type WebGLRenderer } from 'three';
import { createChaseCameraState, speedFraction, updateChaseCamera, type ChaseCameraState } from '../camera/chaseCamera';
import { CHASE_CAMERA_CONFIG } from '../config/cameraConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
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
import type { InputController } from '../input/inputController';
import { useAppStore } from '../state/appStore';
import { useDiagnosticsStore } from '../diagnostics/diagnosticsStore';
import { buildDiagnosticsSnapshot, PHYSICS_MODE_LABEL, type RendererStatus } from '../diagnostics/snapshot';
import { isBoundsInFrustum, updateFrustumFromCamera } from '../diagnostics/visibility';
import { getDriveDirection, isDrifting } from '../simulation/vehicle';
import { getRoadSegmentBoundsSim } from '../world/roadLayout';
import type { WorldDefinition } from '../world/worlds';
import { validateRoadNetwork } from '../world/roadValidation';
import { renderBoundsFromSim, setRenderVector } from './renderSpace';
import { applyVehicleRig, resolveVehicleRig, type VehicleRig } from './vehicleRig';

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
  };
}

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
  private readonly roadValidation: { valid: boolean; issueCount: number; connectionCount: number } | null;
  private readonly cameraTarget = new Vector3();
  private overview = false;
  private rigRoot: Group | null = null;
  private rig: VehicleRig | null = null;
  private vehicleInFrustum = false;
  private roadInFrustum = false;
  private frameCount = 0;
  private started = false;

  constructor(simulation: GameSimulation, input: InputController, world: WorldDefinition) {
    this.simulation = simulation;
    this.input = input;
    this.world = world;
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

    const paused = useAppStore.getState().paused;
    const inputState: InputState = paused ? NEUTRAL_INPUT : this.input.sample();
    if (!paused) {
      this.simulation.update(frameSeconds, inputState);
    }
    const pose = this.simulation.getRenderState();

    const rig = this.resolveRig(vehicle);
    if (rig) applyVehicleRig(rig, pose, this.simulation.getRenderBody());

    if (this.overview) {
      // Development overview: a fixed pose, so the road layout can be checked at a glance. The chase state is
      // not advanced, and it snaps back on exit.
      if (camera.fov !== OVERVIEW_FOV_DEGREES) {
        camera.fov = OVERVIEW_FOV_DEGREES;
        camera.updateProjectionMatrix();
      }
      setRenderVector(camera.position, OVERVIEW_POSITION);
      camera.lookAt(setRenderVector(this.cameraTarget, OVERVIEW_TARGET));
    } else {
      // A zero step while paused freezes the camera. Reset snaps it because `initialized` was cleared.
      updateChaseCamera(this.chase, pose, CHASE_CAMERA_CONFIG, VEHICLE_CONFIG.maxForwardSpeedMps, paused ? 0 : frameSeconds);
      if (camera.fov !== this.chase.fovDegrees) {
        camera.fov = this.chase.fovDegrees;
        camera.updateProjectionMatrix();
      }
      setRenderVector(camera.position, this.chase.position);
      camera.lookAt(setRenderVector(this.cameraTarget, this.chase.target));
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
    switch (action) {
      case 'pause':
        useAppStore.getState().togglePause();
        break;
      case 'reset':
        this.simulation.reset();
        // The camera snaps on the next frame. Its heading, lag, and FOV reset with it.
        this.chase.initialized = false;
        // Show the reset speed on the next frame, not after the normal HUD interval.
        this.timers.hud = HUD_PUBLISH_INTERVAL_SECONDS;
        break;
      case 'debugPanel':
        if (DIAGNOSTICS_ENABLED) useDiagnosticsStore.getState().togglePanel();
        break;
      case 'roadDebug':
        if (DIAGNOSTICS_ENABLED) useDiagnosticsStore.getState().toggleRoadDebug();
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
      speedFraction: speedFraction(state.speed, VEHICLE_CONFIG.maxForwardSpeedMps),
      direction: getDriveDirection(state.speed),
      drifting: isDrifting(state, VEHICLE_CONFIG),
    });
  }

  /** Development only. Visibility is checked at a low rate, and the snapshot is published at a low rate. */
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
        nowMs: Date.now(),
        renderer: rendererStatusFrom(renderer, this.frameCount),
        cameraName: camera.name,
        cameraFovDegrees: camera.fov,
        cameraNear: camera.near,
        cameraFar: camera.far,
        chase: this.chase,
        vehicle: authoritative,
        body: this.simulation.body,
        drifting: isDrifting(authoritative, VEHICLE_CONFIG),
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
        },
      }),
    );
  }
}
