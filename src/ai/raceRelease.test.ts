import { describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { AI_CONFIG } from '../config/aiConfig';
import { buildRoadBoundary } from '../simulation/roadBoundary';
import { groundBoxFromPose } from '../simulation/obb';
import { buildCircuitNetwork } from '../world/circuitNetwork';
import { buildLaneGraph, laneSample } from '../traffic/laneGraph';
import { trafficDimensions, findTrafficType } from '../traffic/trafficTypes';
import { OpponentSystem, type OpponentSpec } from './aiOpponents';
import type { AiObstacle } from './aiController';

/*
 * Race opponents cannot be recycled, so a long stop behind an obstacle must release (Part 6). Automated: real physics,
 * no mocks. A static car stands 12 m ahead on the lane. The opponent must not stay parked for ever.
 */

const network = buildCircuitNetwork();
const graph = buildLaneGraph(network);
const boundary = buildRoadBoundary(network);

function staticObstacleAhead(laneId: string, s: number): AiObstacle {
  const lane = graph.byId.get(laneId);
  if (!lane) throw new Error('lane');
  const pose = laneSample(lane, s);
  const dims = trafficDimensions(findTrafficType('sedan'));
  return { key: 'blocker', box: groundBoxFromPose(pose.x, pose.z, pose.heading, dims.rearMeters, dims.noseMeters, dims.halfWidthMeters), speedMps: 0 };
}

describe('race opponent release (Part 6)', () => {
  it('a non-recyclable opponent stopped behind a static obstacle is released and moves on', () => {
    const spec: OpponentSpec = { typeId: 'sedan', laneId: 'S1:F:0', s: 20, speedMps: 0, colourIndex: 0, speedCapMps: 12, recyclable: false };
    const system = new OpponentSystem(graph, boundary, [spec]);
    const blocker = staticObstacleAhead('S1:F:0', 32);
    const opponent = system.opponents[0];
    if (!opponent) throw new Error('no opponent');
    let stoppedAt: number | null = null;
    let movedAfterStop = false;
    const maxSteps = Math.round((AI_CONFIG.raceReleaseStallSeconds + AI_CONFIG.raceReleaseWindowSeconds + 25) / FIXED_STEP_SECONDS);
    for (let step = 0; step < maxSteps; step += 1) {
      system.integrate(FIXED_STEP_SECONDS, [blocker]);
      const t = (step + 1) * FIXED_STEP_SECONDS;
      if (stoppedAt === null && Math.abs(opponent.state.speed) < 0.3 && t > 3) stoppedAt = t;
      if (stoppedAt !== null && Math.abs(opponent.state.speed) > 0.5) {
        movedAfterStop = true;
        break;
      }
    }
    expect(stoppedAt, 'the opponent first stops behind the blocker').not.toBeNull();
    expect(movedAfterStop, 'the opponent moves on after the release window').toBe(true);
    expect(Number.isFinite(opponent.state.position.x) && Number.isFinite(opponent.state.position.z)).toBe(true);
  });

  it('a retired opponent (finished racer) is not stepped and is not an obstacle', () => {
    const specs: OpponentSpec[] = [
      { typeId: 'sedan', laneId: 'S1:F:0', s: 20, speedMps: 10, colourIndex: 0, speedCapMps: 12, recyclable: false },
      { typeId: 'sedan', laneId: 'S1:F:0', s: 60, speedMps: 10, colourIndex: 1, speedCapMps: 12, recyclable: false },
    ];
    const system = new OpponentSystem(graph, boundary, specs);
    system.retire(0);
    const retired = system.opponents[0];
    if (!retired) throw new Error('no opponent');
    const before = { x: retired.state.position.x, z: retired.state.position.z };
    for (let step = 0; step < 120; step += 1) system.integrate(FIXED_STEP_SECONDS, []);
    expect(retired.state.position.x).toBe(before.x);
    expect(retired.state.position.z).toBe(before.z);
    expect(retired.retired).toBe(true);
    // The other opponent still drives.
    expect(system.opponents[1]?.decision).not.toBeNull();
  });
});
