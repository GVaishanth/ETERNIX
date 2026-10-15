import { Box3, Frustum, PerspectiveCamera, Vector3, type Group, type WebGLRenderer } from 'three';
import { createChaseCameraState, updateChaseCamera, type ChaseCameraState } from '../camera/chaseCamera';
import { CHASE_CAMERA_CONFIG } from '../config/cameraConfig';
import {
  DIAGNOSTICS_PUBLISH_INTERVAL_SECONDS,
  FIXED_STEP_SECONDS,
  HUD_PUBLISH_INTERVAL_SECONDS,
  VISIBILITY_CHECK_INTERVAL_SECONDS,
} from '../config/simulationConfig';
import type { InputState, VehicleState } from '../core/types';
import { metersPerSecondToKph } from '../core/units';
import { GameSimulation } from '../engine/gameSimulation';
import type { InputController } from '../input/inputController';
import { useAppStore } from '../state/appStore';
import { useDiagnosticsStore } from '../diagnostics/diagnosticsStore';
import { buildDiagnosticsSnapshot, PHYSICS_MODE_LABEL, type RendererStatus } from '../diagnostics/snapshot';
import { isBoundsInFrustum, updateFrustumFromCamera } from '../diagnostics/visibility';
import { getRoadBoundsSim } from '../world/roadLayout';
import { renderBoundsFromSim, setRenderVector } from './renderSpace';

/*
 * The per-frame orchestration for the single authoritative game loop. Each tick:
 *   1. samples input once
 *   2. advances the fixed-step simulation (the only place simulation state changes)
 *   3. writes the interpolated pose to the vehicle object and camera (render-only)
 *   4. publishes HUD speed at about 10 Hz, and dev diagnostics at a few Hz
 * React is not involved per frame. This class is owned by GameLoopDriver and driven by R3F's useFrame.
 */

const DIAGNOSTICS_ENABLED = import.meta.env.DEV;
const CHASE_CAMERA_NAME = 'ChaseCamera';

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

function applyPoseToVehicle(group: Group | null, pose: VehicleState): void {
  if (!group) return;
  group.position.set(pose.position.x, pose.position.y, pose.position.z);
  group.rotation.set(0, pose.yaw, 0);
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
  private readonly roadBounds: Box3 = renderBoundsFromSim(getRoadBoundsSim());
  private readonly cameraTarget = new Vector3();
  private vehicleInFrustum = false;
  private roadInFrustum = false;
  private frameCount = 0;
  private started = false;

  constructor(simulation: GameSimulation, input: InputController) {
    this.simulation = simulation;
    this.input = input;
  }

  tick(context: RenderTickContext): void {
    const { deltaSeconds, camera, vehicle } = context;
    camera.name = CHASE_CAMERA_NAME;

    const inputState: InputState = this.input.sample();
    this.simulation.update(deltaSeconds, inputState);
    const pose = this.simulation.getRenderState();

    applyPoseToVehicle(vehicle, pose);
    updateChaseCamera(this.chase, pose, CHASE_CAMERA_CONFIG, deltaSeconds);
    setRenderVector(camera.position, this.chase.position);
    camera.lookAt(setRenderVector(this.cameraTarget, this.chase.target));

    if (!this.started) {
      this.started = true;
      useAppStore.getState().setStatus('running');
    }
    this.publishHud(deltaSeconds, pose);

    if (DIAGNOSTICS_ENABLED) {
      this.publishDiagnostics(context, pose, inputState);
    }
    this.frameCount += 1;
  }

  private publishHud(deltaSeconds: number, pose: VehicleState): void {
    const timer = advanceInterval(this.timers.hud, deltaSeconds, HUD_PUBLISH_INTERVAL_SECONDS);
    this.timers.hud = timer.elapsed;
    if (timer.fired) {
      useAppStore.getState().setHudSpeedKph(metersPerSecondToKph(pose.speed));
    }
  }

  /** Development only. Visibility is checked at a low rate, and the snapshot is published at a low rate. */
  private publishDiagnostics(context: RenderTickContext, pose: VehicleState, inputState: InputState): void {
    const { deltaSeconds, camera, renderer, vehicle } = context;

    const visibilityTimer = advanceInterval(this.timers.visibility, deltaSeconds, VISIBILITY_CHECK_INTERVAL_SECONDS);
    this.timers.visibility = visibilityTimer.elapsed;
    if (visibilityTimer.fired && vehicle) {
      updateFrustumFromCamera(this.frustum, camera);
      this.vehicleBounds.setFromObject(vehicle);
      this.vehicleInFrustum = isBoundsInFrustum(this.frustum, this.vehicleBounds);
      this.roadInFrustum = isBoundsInFrustum(this.frustum, this.roadBounds);
    }

    const publishTimer = advanceInterval(this.timers.diagnostics, deltaSeconds, DIAGNOSTICS_PUBLISH_INTERVAL_SECONDS);
    this.timers.diagnostics = publishTimer.elapsed;
    if (!publishTimer.fired) return;

    useDiagnosticsStore.getState().setSnapshot(
      buildDiagnosticsSnapshot({
        nowMs: Date.now(),
        renderer: rendererStatusFrom(renderer, this.frameCount),
        cameraName: camera.name,
        cameraFovDegrees: camera.fov,
        cameraNear: camera.near,
        cameraFar: camera.far,
        chase: this.chase,
        vehicle: pose,
        input: inputState,
        pressedKeys: this.input.pressedKeys,
        physics: {
          mode: PHYSICS_MODE_LABEL,
          fixedStepSeconds: FIXED_STEP_SECONDS,
          stepCount: this.simulation.stepCount,
          droppedSeconds: this.simulation.droppedSeconds,
          interpolationAlpha: this.simulation.interpolationAlpha,
        },
        vehicleInFrustum: this.vehicleInFrustum,
        roadInFrustum: this.roadInFrustum,
      }),
    );
  }
}
