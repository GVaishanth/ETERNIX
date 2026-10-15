import type { Group, Object3D } from 'three';
import type { BodyState, VehicleState } from '../core/types';

/*
 * Applies simulation output to the visual rig. Every value is written as an absolute value each frame,
 * never accumulated, so rotation error cannot build up.
 *
 * Sign conventions (simulation axes, applied inside the mirrored SimRoot):
 *   root      yaw about +Y. Positive turns right.
 *   pitch     about +X. Positive is nose down.
 *   roll      about +Z. Positive lifts the right side.
 *   steer     about +Y on the wheel steer group. Positive turns right.
 *   spin      about +X on the wheel spin group. Positive rolls forward.
 */

interface WheelRig {
  steer: Object3D;
  spin: Object3D;
  steered: boolean;
}

export interface VehicleRig {
  root: Group;
  bodyPivot: Object3D;
  /** Resting height of the body pivot. Heave is added to this each frame. */
  pivotRestY: number;
  wheels: WheelRig[];
}

/**
 * Resolves the named nodes once. Must not be called per frame. The steer and spin nodes are found by name,
 * and the steered flag is read from userData set by the visual.
 */
export function resolveVehicleRig(root: Group): VehicleRig | null {
  const bodyPivot = root.getObjectByName('BodyPivot');
  if (!bodyPivot) return null;

  const wheels: WheelRig[] = [];
  for (const child of root.children) {
    if (!child.name.startsWith('WheelSteer')) continue;
    const suffix = child.name.slice('WheelSteer'.length);
    const spin = child.getObjectByName(`WheelSpin${suffix}`);
    if (!spin) return null;
    const steered = child.userData.steered === true;
    wheels.push({ steer: child, spin, steered });
  }
  if (wheels.length === 0) return null;

  return { root, bodyPivot, pivotRestY: bodyPivot.position.y, wheels };
}

/** Writes the authoritative pose and the cosmetic body and wheel state to the rig. */
export function applyVehicleRig(rig: VehicleRig, pose: VehicleState, body: BodyState): void {
  rig.root.position.set(pose.position.x, pose.position.y, pose.position.z);
  rig.root.rotation.set(0, pose.yaw, 0);

  rig.bodyPivot.position.y = rig.pivotRestY + body.heave;
  rig.bodyPivot.rotation.set(body.pitch, 0, body.roll);

  for (const wheel of rig.wheels) {
    wheel.steer.rotation.set(0, wheel.steered ? pose.steerAngle : 0, 0);
    wheel.spin.rotation.set(pose.wheelSpin, 0, 0);
  }
}
