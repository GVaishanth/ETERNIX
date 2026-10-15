import type { ChaseCameraState } from '../camera/chaseCamera';
import { forwardFromYaw, toRenderSpace } from '../core/coordinates';
import { metersPerSecondToKph, metersPerSecondToMph, RAD_TO_DEG } from '../core/units';
import type { BodyState, InputState, Vec3, VehicleState } from '../core/types';
import { getDriveDirection, slipAngleRadians, type DriveDirection } from '../simulation/vehicle';

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
    headingLagDegrees: number;
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
    speedMph: number;
    lateralSpeedMps: number;
    slipAngleDegrees: number;
    drifting: boolean;
    steerAngleDegrees: number;
    yawRateDegPerSec: number;
    longitudinalAccel: number;
    lateralAccel: number;
    throttlePedal: number;
    brakePedal: number;
    handbrakeLevel: number;
    wheelSpinDegrees: number;
  };
  body: {
    pitchDegrees: number;
    rollDegrees: number;
    heaveMeters: number;
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
  road: RoadDiagnostics;
}

/** Road network state for the debug panel. Read-only. */
export interface RoadDiagnostics {
  worldId: string;
  worldLabel: string;
  segmentCount: number;
  connectionCount: number;
  validationValid: boolean;
  validationIssueCount: number;
  currentSegmentId: string | null;
  contact: boolean;
  contactSteps: number;
  cameraMode: 'chase' | 'overview';
  roadDebugVisible: boolean;
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
  body: BodyState;
  drifting: boolean;
  input: InputState;
  pressedKeys: string[];
  paused: boolean;
  physics: DiagnosticsSnapshot['physics'];
  vehicleInFrustum: boolean;
  roadInFrustum: boolean;
  road: RoadDiagnostics;
}

/** Signed difference a - b in degrees, on the shortest arc, in (-180, 180]. */
function shortestSignedDegrees(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b)) * RAD_TO_DEG;
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
      headingLagDegrees: shortestSignedDegrees(input.vehicle.yaw, input.chase.headingYaw),
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
      speedMph: metersPerSecondToMph(vehicle.speed),
      lateralSpeedMps: vehicle.lateralSpeed,
      slipAngleDegrees: slipAngleRadians(vehicle) * RAD_TO_DEG,
      drifting: input.drifting,
      steerAngleDegrees: vehicle.steerAngle * RAD_TO_DEG,
      yawRateDegPerSec: vehicle.yawRate * RAD_TO_DEG,
      longitudinalAccel: vehicle.longitudinalAccel,
      lateralAccel: vehicle.lateralAccel,
      throttlePedal: vehicle.throttlePedal,
      brakePedal: vehicle.brakePedal,
      handbrakeLevel: vehicle.handbrakeLevel,
      wheelSpinDegrees: vehicle.wheelSpin * RAD_TO_DEG,
    },
    body: {
      pitchDegrees: input.body.pitch * RAD_TO_DEG,
      rollDegrees: input.body.roll * RAD_TO_DEG,
      heaveMeters: input.body.heave,
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
    road: input.road,
  };
}
