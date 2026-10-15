import type { Vec3 } from '../core/types';
import type { DiagnosticsSnapshot } from './snapshot';

/** Turns a snapshot into labeled text rows for the debug panel. Pure, so it is testable. */

export interface DebugRow {
  label: string;
  value: string;
}

export interface DebugSection {
  title: string;
  rows: DebugRow[];
}

function fixed(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function vec(value: Vec3, digits = 2): string {
  return `${fixed(value.x, digits)}, ${fixed(value.y, digits)}, ${fixed(value.z, digits)}`;
}

function flag(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function formatSnapshot(snapshot: DiagnosticsSnapshot): DebugSection[] {
  const { renderer, camera, vehicle, input, control, physics, assets, visibility } = snapshot;
  return [
    {
      title: 'Renderer',
      rows: [
        { label: 'status', value: renderer.status },
        { label: 'backend', value: renderer.backend },
        { label: 'draw calls', value: String(renderer.drawCallsLastFrame) },
        { label: 'triangles', value: String(renderer.triangles) },
      ],
    },
    {
      title: 'Camera (sim space)',
      rows: [
        { label: 'active', value: camera.name },
        { label: 'position', value: vec(camera.positionSim) },
        { label: 'look at', value: vec(camera.targetSim) },
        { label: 'fov / near / far', value: `${fixed(camera.fovDegrees, 0)} / ${fixed(camera.nearMeters, 1)} / ${fixed(camera.farMeters, 0)}` },
      ],
    },
    {
      title: 'Vehicle',
      rows: [
        { label: 'position (m)', value: vec(vehicle.positionSim) },
        { label: 'yaw (deg)', value: fixed(vehicle.yawDegrees, 1) },
        { label: 'forward (sim)', value: vec(vehicle.forwardSim, 3) },
        { label: 'forward (render)', value: vec(vehicle.forwardRender, 3) },
        { label: 'speed', value: `${fixed(vehicle.speedKph, 1)} km/h (${fixed(vehicle.speedMps, 2)} m/s)` },
        { label: 'wheel angle (deg)', value: fixed(vehicle.steerAngleDegrees, 1) },
        { label: 'yaw rate (deg/s)', value: fixed(vehicle.yawRateDegPerSec, 1) },
      ],
    },
    {
      title: 'Input',
      rows: [
        { label: 'steer (-1 L .. +1 R)', value: fixed(input.steer, 2) },
        { label: 'throttle / brake', value: `${fixed(input.throttle, 2)} / ${fixed(input.brake, 2)}` },
        { label: 'handbrake', value: flag(input.handbrake > 0) },
        { label: 'keys held', value: input.pressedKeys.length > 0 ? input.pressedKeys.join(' ') : '(none)' },
      ],
    },
    {
      title: 'Control',
      rows: [
        { label: 'paused', value: flag(control.paused) },
        { label: 'direction', value: control.direction },
      ],
    },
    {
      title: 'Physics / loop',
      rows: [
        { label: 'mode', value: physics.mode },
        { label: 'fixed step (s)', value: fixed(physics.fixedStepSeconds, 4) },
        { label: 'steps run', value: String(physics.stepCount) },
        { label: 'dropped (s)', value: fixed(physics.droppedSeconds, 3) },
        { label: 'interp alpha', value: fixed(physics.interpolationAlpha, 2) },
      ],
    },
    {
      title: 'Assets',
      rows: [
        { label: 'mode', value: assets.mode },
        { label: 'external models', value: String(assets.externalModelsLoaded) },
        { label: 'external textures', value: String(assets.externalTexturesLoaded) },
      ],
    },
    {
      title: 'Visibility (frustum)',
      rows: [
        { label: 'vehicle in view', value: flag(visibility.vehicleInFrustum) },
        { label: 'road in view', value: flag(visibility.roadInFrustum) },
      ],
    },
  ];
}
