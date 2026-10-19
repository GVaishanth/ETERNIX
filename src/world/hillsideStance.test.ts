/*
 * The car stands on the hillside road at both axles. The rig's root sits on the rear axle; the front axle is found from the
 * rig's world matrix after applyVehicleRig, and compared with the road under it.
 *
 * Found by this test: with the pitch read from the rear axle only, the front axle sank up to 0.088 m below the road where
 * a street leaves a flat junction pad (H--4-0, about 14 m before the junction at x = -1000). The rear was on the pad (grade
 * zero) while the front was already on the slope. The pitch now comes from both axles.
 */
import { Group, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../engine/gameSimulation';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState, VehicleState } from '../core/types';
import { buildLaneGraph } from '../traffic/laneGraph';
import { applyVehicleRig, type VehicleRig } from '../render/vehicleRig';
import { buildLoopCityNetwork } from './city/cityNetwork';
import { roadElevationFor } from './roadElevation';

const GAS: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };
/** Largest gap allowed between the rendered front axle and the road under it, metres. */
const STANCE_LIMIT_METERS = 0.03;

const graph = buildLaneGraph(buildLoopCityNetwork());
const elevation = roadElevationFor(graph);

function emptyRig(root: Group): VehicleRig {
  return { root, bodyPivot: new Object3D(), pivotRestY: 0, wheels: [] };
}

/** Rendered world height of the front axle, after the rig is applied to the pose. */
function renderedFrontAxleY(pose: VehicleState, pitch: number): number {
  const root = new Group();
  applyVehicleRig(emptyRig(root), pose, { pitch: 0, pitchRate: 0, roll: 0, rollRate: 0, heave: 0, heaveRate: 0 }, pitch);
  root.updateMatrixWorld(true);
  return new Vector3(0, 0, VEHICLE_CONFIG.wheelbaseMeters).applyMatrix4(root.matrixWorld).y;
}

describe('the car stands on the hillside road at the front axle', () => {
  it('the rendered front axle stays on the road, within the stance limit, while driving the hillside', { timeout: 120000 }, () => {
    const lanes = graph.lanes.filter(
      (lane) => lane.kind === 'segment' && lane.direction === 'F' && lane.laneIndex === 0 && lane.points.some((p) => p.y > 3),
    );
    expect(lanes.length).toBeGreaterThan(8);
    let worst = 0;
    let samples = 0;
    for (const lane of lanes.slice(0, 12)) {
      const first = lane.points[0];
      if (!first) continue;
      const sim = new GameSimulation(VEHICLE_CONFIG, { elevation });
      sim.placeVehicle({ x: first.x, y: 0, z: first.z }, lane.headings[0] ?? 0);
      for (let frame = 0; frame < 60 * 15; frame += 1) {
        sim.update(1 / 60, GAS);
        const pose = sim.getRenderState();
        // Only while the car is moving: a parked car at a junction pad is not what this test is about.
        if (Math.abs(pose.speed) < 5) continue;
        const pitch = sim.getRenderRoadPitch();
        const frontY = renderedFrontAxleY(pose, pitch);
        const surface = elevation.surfaceAt(
          pose.position.x + Math.sin(pose.yaw) * VEHICLE_CONFIG.wheelbaseMeters,
          pose.position.z + Math.cos(pose.yaw) * VEHICLE_CONFIG.wheelbaseMeters,
          pose.yaw,
        );
        if (!surface) continue;
        worst = Math.max(worst, Math.abs(frontY - surface.heightMeters));
        samples += 1;
      }
    }
    expect(samples).toBeGreaterThan(1000);
    expect(worst).toBeLessThanOrEqual(STANCE_LIMIT_METERS);
  });

  it('a flat road keeps the rig level', () => {
    const root = new Group();
    applyVehicleRig(emptyRig(root), { position: { x: 0, y: 0, z: 0 }, yaw: 0.4, speed: 0, lateralSpeed: 0, steerAngle: 0, yawRate: 0 } as VehicleState, { pitch: 0, pitchRate: 0, roll: 0, rollRate: 0, heave: 0, heaveRate: 0 }, 0);
    expect(root.rotation.x).toBe(0);
    expect(root.rotation.y).toBeCloseTo(0.4, 9);
  });
});
