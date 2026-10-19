import { describe, expect, it } from 'vitest';
import { buildLoopCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, laneSample, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import { canSee, offAxisAngle } from './sight';
import { chooseDeployment, type DeployRules } from './deployment';
import { LaneRouter } from './policeRouting';

/*
 * Stage D step 3: police on the loop. Sight, deployment and routing compare points that can lie on opposite sides of a
 * seam. Each test places the two points across the seam and checks the short way round. The finite city is the control.
 */

const network = buildLoopCityNetwork();
const PERIOD = network.periodMeters ?? Number.NaN;
const graph: LaneGraph = buildLaneGraph(network);

/** An eastbound segment that starts just past the seam (base x near -1200, logical x near 1600). */
function eastboundAfterSeam(): LanePath {
  const lane = graph.lanes.find((candidate) => {
    const start = candidate.points[0];
    return candidate.kind === 'segment' && candidate.direction === 'F' && !!start && start.x < -1100 && start.x > -1210 && Math.sin(candidate.headings[0] ?? 0) > 0.99;
  });
  if (!lane) throw new Error('no eastbound segment just past the seam');
  return lane;
}

const AFTER = eastboundAfterSeam();
const AFTER_INDEX = graph.lanes.indexOf(AFTER);
const SIGHT = { radiusMeters: 60, halfAngleDegrees: 45 };
const HALF_PI = Math.PI / 2;

describe('police sight across the seam', () => {
  it('sees a target that is 7 m ahead across the seam, and not without the period', () => {
    // A unit at logical x 1596 facing east. The target is at logical x -1197: 2793 m away raw, 7 m ahead on the loop.
    const unit = { x: 1596, z: -401.8, yaw: HALF_PI };
    const target = { x: -1197, z: -401.8 };
    expect(canSee(unit, target, SIGHT, PERIOD)).toBe(true);
    expect(canSee(unit, target, SIGHT, null)).toBe(false);
    // The view angle is measured the same way: straight ahead across the seam.
    expect(offAxisAngle(unit, target, PERIOD)).toBeLessThan(1e-6);
    expect(offAxisAngle(unit, target, null)).toBeGreaterThan(1);
  });

  it('does not see a target behind the unit across the seam', () => {
    const unit = { x: -1196, z: -401.8, yaw: HALF_PI };
    // A target 7 m behind, across the seam (logical x 1597, the seam being at 1600).
    expect(canSee(unit, { x: 1597, z: -401.8 }, SIGHT, PERIOD)).toBe(false);
  });
});

describe('police routing across the seam', () => {
  const router = new LaneRouter(graph);

  it('routes to a target across the seam: the target on the far side is the lane just past the seam', () => {
    // The target is the lane's own point, shifted one period east (logical). The route must find that lane.
    const lane = AFTER;
    const pose = laneSample(lane, 20);
    const plan = router.planTo(AFTER_INDEX, pose.x + PERIOD, pose.z, { maxTargetMeters: 12, preferHeading: pose.heading });
    expect(plan).not.toBeNull();
    expect(plan?.targetDistanceMeters ?? Number.NaN).toBeLessThan(1);
  });

  it('plans from the west of the seam to a target just east of it', () => {
    // From the lane just past the seam, to a point 8 m before the seam, expressed on the far side (logical +1592).
    const pose = laneSample(AFTER, 5);
    const target = { x: pose.x - 8 + PERIOD, z: pose.z };
    const plan = router.planTo(AFTER_INDEX, target.x, target.z, { maxTargetMeters: 12 });
    expect(plan).not.toBeNull();
    expect(plan?.targetDistanceMeters ?? Number.NaN).toBeLessThan(1);
  });
});

describe('police deployment across the seam', () => {
  const rules: DeployRules = {
    minDistanceMeters: 60,
    maxDistanceMeters: 140,
    preferredDistanceMeters: 100,
    forbiddenAheadRadians: Math.PI / 3,
    preferredOutOfViewRadians: Math.PI / 2,
    clearanceMeters: 2,
    sampleStepMeters: 5,
  };
  const footprint = { rearMeters: 2.3, frontMeters: 2.3, halfWidthMeters: 0.95 };

  // Note: this does not discriminate the period. A mutant that ignores the period also passes, because the same-side road
  // always supplies a valid candidate. The period is covered by the sight and routing tests.
  it('returns an in-band spawn for a player just east of the seam when the loop period is passed', () => {
    // The player sits at logical x 1610, on the far side of the seam from the lanes just past it.
    const player = { x: AFTER.points[0]!.x + PERIOD + 10, z: AFTER.points[0]!.z, yaw: 0 };
    const candidate = chooseDeployment({ graph, player, bodies: [], footprint, rules, period: PERIOD });
    expect(candidate).not.toBeNull();
    // The candidate is within the deployment band of the player, measured across the seam.
    const dx = candidate!.x - player.x;
    const wrappedDx = ((dx + PERIOD / 2) % PERIOD + PERIOD) % PERIOD - PERIOD / 2;
    expect(Math.hypot(wrappedDx, candidate!.z - player.z)).toBeGreaterThanOrEqual(rules.minDistanceMeters - 1e-6);
    expect(Math.hypot(wrappedDx, candidate!.z - player.z)).toBeLessThanOrEqual(rules.maxDistanceMeters + 1e-6);
  });

  it('finds a spawn for a player in the base domain (sanity, no seam involved)', () => {
    const player = { x: AFTER.points[0]!.x + 10, z: AFTER.points[0]!.z, yaw: 0 };
    const candidate = chooseDeployment({ graph, player, bodies: [], footprint, rules, period: PERIOD });
    expect(candidate).not.toBeNull();
  });
});
