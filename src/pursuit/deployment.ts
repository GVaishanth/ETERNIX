import { groundBoxFromPose, groundBoxOverlap, type GroundBox } from '../simulation/obb';
import { laneSample, type LaneGraph } from '../traffic/laneGraph';
import { imageNear } from '../world/wrap/worldWrap';
import { offAxisAngle, type SightSource } from './sight';

/*
 * Deployment spawn choice (Part 7). Finds where a new police unit can appear. Pure. A candidate must be:
 *   - on a straight or arc segment lane, never a junction connector, so it sits on a legal driving lane;
 *   - inside the distance band from the player;
 *   - not ahead of the player (inside the forbidden cone), and preferably out of the player's view;
 *   - clear of every other body, with a clearance margin.
 * If no candidate passes, the caller postpones and retries later. A spawn is never forced onto a body.
 */

export interface DeployFootprint {
  rearMeters: number;
  frontMeters: number;
  halfWidthMeters: number;
}

export interface DeployRules {
  minDistanceMeters: number;
  maxDistanceMeters: number;
  preferredDistanceMeters: number;
  forbiddenAheadRadians: number;
  preferredOutOfViewRadians: number;
  clearanceMeters: number;
  sampleStepMeters: number;
}

/**
 * A candidate on a lane that another unit already uses costs this much in the choice. It is ranked after being out of
 * view, and before the distance. So the units spread over the road's lanes, and a lane is reused only when no other fits.
 */
export const LANE_REUSE_PENALTY = 300;

export interface DeployRequest {
  graph: LaneGraph;
  player: SightSource;
  /** Every other body the unit must not overlap: the player, the police, and the traffic. */
  bodies: readonly GroundBox[];
  footprint: DeployFootprint;
  rules: DeployRules;
  /** Loop period, or null. Distances and view angles use the image nearest the player. */
  period?: number | null;
  /** Lanes that other units already use. A candidate on one of them is passed over when another lane fits. Optional. */
  usedLaneIds?: ReadonlySet<string> | null;
}

export interface DeployCandidate {
  laneId: string;
  s: number;
  x: number;
  z: number;
  yaw: number;
  distanceMeters: number;
  outOfView: boolean;
}

export function chooseDeployment(request: DeployRequest): DeployCandidate | null {
  const { graph, player, bodies, footprint, rules } = request;
  const period = request.period ?? null;
  const used = request.usedLaneIds ?? null;
  let best: DeployCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const lane of graph.lanes) {
    if (lane.kind !== 'segment') continue;
    for (let s = 0; s <= lane.lengthMeters; s += rules.sampleStepMeters) {
      const pose = laneSample(lane, s);
      const distance = Math.hypot(imageNear(player.x, pose.x, period) - player.x, imageNear(player.z, pose.z, period) - player.z);
      if (distance < rules.minDistanceMeters || distance > rules.maxDistanceMeters) continue;
      const offAxis = offAxisAngle(player, pose, period);
      if (offAxis < rules.forbiddenAheadRadians) continue;
      const outOfView = offAxis >= rules.preferredOutOfViewRadians;
      // Outside the view is worth far more than any distance difference. Within a class, nearer the ideal distance wins.
      const reuse = used !== null && used.has(lane.id) ? LANE_REUSE_PENALTY : 0;
      const score = (outOfView ? 0 : 1000) + reuse + Math.abs(distance - rules.preferredDistanceMeters);
      if (score >= bestScore) continue;
      const box = groundBoxFromPose(
        pose.x,
        pose.z,
        pose.heading,
        footprint.rearMeters + rules.clearanceMeters,
        footprint.frontMeters + rules.clearanceMeters,
        footprint.halfWidthMeters + rules.clearanceMeters,
      );
      if (bodies.some((body) => groundBoxOverlap(box, body).overlapping)) continue;
      bestScore = score;
      best = { laneId: lane.id, s, x: pose.x, z: pose.z, yaw: pose.heading, distanceMeters: distance, outOfView };
    }
  }
  return best;
}

/** Ground box of a unit at a pose, from the police footprint. Used for the other bodies in deployment checks. */
export function boxAt(x: number, z: number, yaw: number, footprint: DeployFootprint): GroundBox {
  return groundBoxFromPose(x, z, yaw, footprint.rearMeters, footprint.frontMeters, footprint.halfWidthMeters);
}
