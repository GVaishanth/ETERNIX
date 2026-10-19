/*
 * Phase 4 regression: a car drives across the hillside-to-city seam on the real loop. At 2800 m the seam is node column 10
 * at x = 1600, which is also the period wrap (x = 1600 is the same place as x = -1200). The mountain straddles it: the
 * crest row climbs to the seam and comes down the far flank into the flat city at node -2. Heights, grades and the car's
 * standing height must stay continuous across it, and the flat city beyond must read zero.
 */
import { describe, expect, it } from 'vitest';
import { WORLD_WRAP_CONFIG } from '../config/worldWrapConfig';
import { GameSimulation } from '../engine/gameSimulation';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import type { InputState, Vec3 } from '../core/types';
import { buildLaneGraph, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import { buildLoopCityNetwork } from './city/cityNetwork';
import { roadElevationFor, type RoadElevation } from './roadElevation';

const GRADE_LIMIT = 0.08;
const SEAM_X = 1600;
/** A point this far past the seam is on the flat city's side: node -2 is at x = -800, which is 2000 logical. */
const PAST_FLAT_METERS = 450;
/** Largest one-step height change allowed at the seam: the junction-pad crease (see the drive test). */
const SNAP_LIMIT_METERS = 0.12;
const GAS: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };

const graph: LaneGraph = buildLaneGraph(buildLoopCityNetwork());
const elevation: RoadElevation = roadElevationFor(graph);

/** The east-bound lane of the crest row, H-9-2. It runs from the crest, across the seam, and down the far flank. */
function crestLane(): LanePath {
  const lane = graph.lanes.find(
    (candidate) => candidate.kind === 'segment' && candidate.ownerId === 'H-9-2' && candidate.direction === 'F' && candidate.laneIndex === 0,
  );
  if (!lane) throw new Error('no east-bound lane on H-9-2');
  const first = lane.points[0];
  const last = lane.points[lane.points.length - 1];
  if (!first || !last || last.x <= first.x) throw new Error('H-9-2 lane 0 does not run east');
  return lane;
}

describe('the hillside-to-city seam on the loop', () => {
  const lane = crestLane();

  it('every lane near the seam is continuous in height, with no grade over the limit, and one crosses x = 1600', () => {
    let worst = 0;
    let atSeamJunction = 0;
    for (const lane of graph.lanes) {
      const near = lane.points.some((p) => p.x >= 1550 && p.x <= 1650);
      if (!near) continue;
      for (let k = 1; k < lane.points.length; k += 1) {
        const a = lane.points[k - 1] as Vec3;
        const b = lane.points[k] as Vec3;
        const run = (lane.s[k] ?? 0) - (lane.s[k - 1] ?? 0);
        if (run > 0) worst = Math.max(worst, Math.abs(b.y - a.y) / run);
      }
      // The seam junction is node 10 (x = 1600), which is node -4 (x = -1200) in the base domain. Check both images.
      if (lane.points.some((p) => (p.x >= 1580 && p.x <= 1620) || (p.x >= -1220 && p.x <= -1180))) atSeamJunction += 1;
    }
    expect(worst).toBeLessThanOrEqual(GRADE_LIMIT + 1e-6);
    // Lanes run through the junction that sits on the seam (node 10, x = 1600), so the test really covers the seam.
    expect(atSeamJunction).toBeGreaterThan(0);
  });

  it('a car drives across the seam: its height stays continuous and reads the road the whole way', () => {
    const sim = new GameSimulation(VEHICLE_CONFIG, { elevation });
    // Start on the crest's east slope, about 100 m before the seam.
    let start = 0;
    for (let k = 0; k < lane.points.length; k += 1) {
      if ((lane.points[k]?.x ?? 0) >= 1500) {
        start = k;
        break;
      }
    }
    const at = lane.points[start] as Vec3;
    sim.placeVehicle({ x: at.x, y: 0, z: at.z }, lane.headings[start] ?? 0);

    let previous = { x: sim.state.position.x, y: sim.state.position.y, z: sim.state.position.z };
    let crossed = false;
    let steps = 0;
    let worstJump = 0;
    let worstFromRoad = 0;
    let heightAfterSeam = Number.NaN;
    const maxSteps = 60 * 90;
    while (steps < maxSteps && !crossed) {
      sim.update(1 / 60, GAS);
      steps += 1;
      const p = sim.state.position;
      // Largest height change in one step. Limit: where a street meets a junction pad, the lookup can pick the pad
      // connector (height zero) over the street a few centimetres away, so a step may snap by up to about 10 cm.
      worstJump = Math.max(worstJump, Math.abs(p.y - previous.y));
      const surface = elevation.surfaceAt(p.x, p.z, sim.state.yaw);
      if (surface) worstFromRoad = Math.max(worstFromRoad, Math.abs(p.y - surface.heightMeters));
      previous = { x: p.x, y: p.y, z: p.z };
      if (p.x > SEAM_X + PAST_FLAT_METERS) {
        crossed = true;
        heightAfterSeam = p.y;
      }
    }

    expect(crossed, 'the car reached the flat city beyond the seam').toBe(true);
    // No step snaps by more than 12 cm (see above). A grade of 8 percent over a 0.5 m step would be 4 cm.
    expect(worstJump).toBeLessThanOrEqual(SNAP_LIMIT_METERS);
    // The car stands on the road the whole way. A bounce of a few centimetres is allowed.
    expect(worstFromRoad).toBeLessThan(0.6);
    // Past the seam the car has come down the far flank into the flat city, which reads zero.
    expect(Math.abs(heightAfterSeam)).toBeLessThan(0.3);
  });

  it('the wrap images agree: the surface one period east of the seam equals the surface at the seam', () => {
    const period = WORLD_WRAP_CONFIG.periodNodes * WORLD_WRAP_CONFIG.nodeSpacingMeters;
    for (const z of [0, 300, 700]) {
      const east = elevation.surfaceAt(SEAM_X + 40, z, Math.PI / 2)?.heightMeters ?? 0;
      const wrapped = elevation.surfaceAt(SEAM_X + 40 - period, z, Math.PI / 2)?.heightMeters ?? 0;
      expect(Math.abs(east - wrapped)).toBeLessThan(0.05);
    }
  });
});
