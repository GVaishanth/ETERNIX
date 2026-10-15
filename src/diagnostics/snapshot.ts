import type { ChaseCameraState } from '../camera/chaseCamera';
import { forwardFromYaw, toRenderSpace } from '../core/coordinates';
import { metersPerSecondToKph, RAD_TO_DEG } from '../core/units';
import type { InputState, Vec3, VehicleState } from '../core/types';
import { getDriveDirection, type DriveDirection } from '../simulation/vehicle';

/** A plain, serializable view of the simulation and renderer state for the debug panel. */

export interface RendererStatus {
  status: 'initializing' | 'ready';
  backend: 'WebGL2' | 'WebGL1' | 'unknown';
  drawCallsLastFrame: number;
  triangles: number;
}

export interface DiagnosticsSnapshot {
  capturedAtMs: number;
  renderer: RendererStatus;
  camera: {
    name: string;
    positionSim: Vec3;
    targetSim: Vec3;
    fovDegrees: number;
    nearMeters: number;
    farMeters: number;
  };
  vehicle: {
    positionSim: Vec3;
    yawDegrees: number;
    forwardSim: Vec3;
    forwardRender: Vec3;
    speedMps: number;
    speedKph: number;
    steerAngleDegrees: number;
    yawRateDegPerSec: number;
  };
  input: InputState & { pressedKeys: string[] };
  control: {
    paused: boolean;
    direction: DriveDirection;
  };
  physics: {
    mode: string;
    fixedStepSeconds: number;
    stepCount: number;
    droppedSeconds: number;
    interpolationAlpha: number;
  };
  assets: {
    mode: string;
    externalModelsLoaded: number;
    externalTexturesLoaded: number;
  };
  visibility: {
    vehicleInFrustum: boolean;
    roadInFrustum: boolean;
  };
}

export interface SnapshotInput {
  nowMs: number;
  renderer: RendererStatus;
  cameraName: string;
  cameraFovDegrees: number;
  cameraNear: number;
  cameraFar: number;
  chase: ChaseCameraState;
  vehicle: VehicleState;
  input: InputState;
  pressedKeys: string[];
  paused: boolean;
  physics: DiagnosticsSnapshot['physics'];
  vehicleInFrustum: boolean;
  roadInFrustum: boolean;
}

export const PHYSICS_MODE_LABEL = 'custom kinematic bicycle (Rapier not installed)';
export const ASSET_MODE_LABEL = 'procedural placeholders only';

export function buildDiagnosticsSnapshot(input: SnapshotInput): DiagnosticsSnapshot {
  const { vehicle } = input;
  const forward = forwardFromYaw(vehicle.yaw);
  return {
    capturedAtMs: input.nowMs,
    renderer: input.renderer,
    camera: {
      name: input.cameraName,
      positionSim: input.chase.position,
      targetSim: input.chase.target,
      fovDegrees: input.cameraFovDegrees,
      nearMeters: input.cameraNear,
      farMeters: input.cameraFar,
    },
    vehicle: {
      positionSim: vehicle.position,
      yawDegrees: vehicle.yaw * RAD_TO_DEG,
      forwardSim: forward,
      forwardRender: toRenderSpace(forward),
      speedMps: vehicle.speed,
      speedKph: metersPerSecondToKph(vehicle.speed),
      steerAngleDegrees: vehicle.steerAngle * RAD_TO_DEG,
      yawRateDegPerSec: vehicle.yawRate * RAD_TO_DEG,
    },
    input: { ...input.input, pressedKeys: input.pressedKeys },
    control: {
      paused: input.paused,
      direction: getDriveDirection(vehicle.speed),
    },
    physics: input.physics,
    assets: {
      mode: ASSET_MODE_LABEL,
      externalModelsLoaded: 0,
      externalTexturesLoaded: 0,
    },
    visibility: {
      vehicleInFrustum: input.vehicleInFrustum,
      roadInFrustum: input.roadInFrustum,
    },
  };
}
