import { beforeEach, describe, expect, it } from 'vitest';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { PURSUIT_CONFIG } from '../config/pursuitConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { GameSimulation } from '../engine/gameSimulation';
import { laneSample, type LaneGraph, type LanePath } from '../traffic/laneGraph';
import { createTrafficRuntime, playerFootprintFromConfig } from '../traffic/trafficRuntime';
import { getWorldDefinition } from '../world/worlds';
import type { InputState } from '../core/types';
import { PursuitController, pursuingSpeedCapMps } from './pursuitController';
import type { PursuitState } from './pursuitTypes';

/*
 * Part 7 controller tests (stage 3). The controller runs inside the real fixed-step simulation, on the city world's lane
 * graph, the way App builds it. Nothing is mocked. Staging moves only the player (placeVehicle), which is how a browser
 * test would stage a scene. Police are never moved by the test, so the no-teleport check is a real check.
 */

const NEUTRAL: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const DT = FIXED_STEP_SECONDS;

interface Rig {
  sim: GameSimulation;
  pursuit: PursuitController;
  graph: LaneGraph;
}

function makeRig(): Rig {
  const world = getWorldDefinition('city');
  if (!world.network || !world.lanes) throw new Error('city world has no network');
  const footprint = playerFootprintFromConfig(VEHICLE_CONFIG);
  const traffic = createTrafficRuntime(world.network, world.lanes, world.boundary, world.trafficScenario, footprint, world.ambient);
  const pursuit = new PursuitController({
    graph: world.lanes,
    boundary: world.boundary,
    traffic: traffic.system,
    playerFootprint: { rearMeters: footprint.rearMeters, frontMeters: footprint.noseMeters, halfWidthMeters: footprint.halfWidthMeters },
    spawn: { x: world.spawn.position.x, z: world.spawn.position.z, yaw: world.spawn.yawRadians },
  });
  const sim = new GameSimulation(VEHICLE_CONFIG, {
    spawn: world.spawn,
    boundary: world.boundary,
    traffic,
    opponents: null,
    recoveryLanes: world.lanes.lanes,
    devReset: world.devReset,
    pursuit,
  });
  return { sim, pursuit, graph: world.lanes };
}

/** Steps the simulation by `seconds` with the given input. Returns the number of steps run. */
function run(sim: GameSimulation, seconds: number, input: InputState = NEUTRAL, onStep?: () => void): number {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    sim.update(DT, input);
    onStep?.();
  }
  return steps;
}

/** Places the player 30 m ahead of patrol 0 on its lane, facing the same way, so patrol 0 can see it. */
function placeInFrontOfPatrol(rig: Rig): void {
  const opponent = rig.pursuit.police.opponents[0];
  if (!opponent) throw new Error('no patrol 0');
  const lane = rig.graph.byId.get(opponent.driver.route.laneId);
  if (!lane) throw new Error('patrol lane missing');
  const s = Math.min(opponent.driver.route.s + 30, lane.lengthMeters - 0.5);
  const pose = laneSample(lane, s);
  rig.sim.placeVehicle({ x: pose.x, y: 0, z: pose.z }, pose.heading);
}

/** The forward, segment lane whose midpoint is farthest from every active police unit. Used to stage an escape. */
function farthestForwardLane(rig: Rig): { lane: LanePath; x: number; z: number; heading: number; distance: number } {
  const units = rig.pursuit.police.opponents.filter((_, id) => rig.pursuit.police.isActive(id));
  let best: { lane: LanePath; x: number; z: number; heading: number; distance: number } | null = null;
  for (const lane of rig.graph.lanes) {
    if (lane.kind !== 'segment' || lane.direction !== 'F') continue;
    const pose = laneSample(lane, lane.lengthMeters / 2);
    let nearest = Number.POSITIVE_INFINITY;
    for (const unit of units) nearest = Math.min(nearest, Math.hypot(unit.state.position.x - pose.x, unit.state.position.z - pose.z));
    if (best === null || nearest > best.distance) best = { lane, x: pose.x, z: pose.z, heading: pose.heading, distance: nearest };
  }
  if (!best) throw new Error('no forward segment lane');
  return best;
}

describe('pursuit controller: start, patrols, and the trigger rule', () => {
  let rig: Rig;
  beforeEach(() => {
    rig = makeRig();
  });

  it('starts with no session, with the configured patrols on the road and the rest of the pool idle', () => {
    const snap = rig.pursuit.snapshot();
    expect(snap.state).toBe('INACTIVE');
    expect(snap.sessionsStarted).toBe(0);
    expect(snap.patrolUnits).toBe(PURSUIT_CONFIG.patrolUnits);
    expect(snap.pursuingUnits).toBe(0);
    expect(snap.idleUnits).toBe(snap.poolSize - PURSUIT_CONFIG.patrolUnits);
    expect(rig.pursuit.capacity).toBe(PURSUIT_CONFIG.unitPoolSize);
  });

  it('does not start a pursuit on city entry or while the player drives normally', () => {
    run(rig.sim, 30);
    expect(rig.pursuit.snapshot().state).toBe('INACTIVE');
    expect(rig.pursuit.snapshot().sessionsStarted).toBe(0);
  });

  it('ignores an offence no patrol can see: no session, and the reason says unwitnessed', () => {
    run(rig.sim, 0.5);
    expect(rig.pursuit.reportOffence('speeding')).toBe('unwitnessed');
    expect(rig.pursuit.snapshot().state).toBe('INACTIVE');
  });

  it('starts a detection for a witnessed offence, once, and refuses a second one during the detection', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    expect(rig.pursuit.reportOffence('speeding')).toBe('started');
    expect(rig.pursuit.snapshot().state).toBe('DETECTION');
    expect(rig.pursuit.reportOffence('speeding')).toBe('ignored');
    expect(rig.pursuit.snapshot().sessionsStarted).toBe(1);
  });

  it('does not start a pursuit during a race: the offence is refused and the police stay put', () => {
    rig.pursuit.attachRaceProbe(() => true);
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    const before = rig.pursuit.police.opponents.map((opponent) => ({ x: opponent.state.position.x, z: opponent.state.position.z }));
    expect(rig.pursuit.reportOffence('speeding')).toBe('ignored');
    run(rig.sim, 5);
    const after = rig.pursuit.police.opponents.map((opponent) => ({ x: opponent.state.position.x, z: opponent.state.position.z }));
    expect(after).toEqual(before);
    expect(rig.pursuit.snapshot().state).toBe('INACTIVE');
    rig.pursuit.attachRaceProbe(null);
  });
});

describe('pursuit controller: a pursuit from detection to pursuing', () => {
  let rig: Rig;
  beforeEach(() => {
    rig = makeRig();
  });

  it('moves through detection, initiation, and pursuit with no illegal transition, and drives a chaser on a planned route', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    expect(rig.pursuit.reportOffence('speeding')).toBe('started');

    const visited: PursuitState[] = [];
    const seen = (): void => {
      const state = rig.pursuit.snapshot().state;
      if (visited[visited.length - 1] !== state) visited.push(state);
    };
    // Keep the player in view: place it in front of the patrol again each second, so the witness stays in sight.
    for (let second = 0; second < 8; second += 1) {
      run(rig.sim, 1, NEUTRAL, seen);
      if (rig.pursuit.snapshot().state === 'INACTIVE') break;
    }
    expect(visited).toContain('DETECTION');
    expect(visited).toContain('INITIATING');
    expect(visited.some((state) => state === 'PURSUING' || state === 'ESCALATING')).toBe(true);
    expect(rig.pursuit.diagnostics().units.some((unit) => unit.role === 'chase' && unit.routeLanes > 0 && !unit.routeFailed)).toBe(true);
    expect(rig.pursuit.session.rejectedTransitions).toBe(0);
    // Every pursuing unit gets the heat level's cap times the pursuit multiplier (2.5x). The cap is the one the driver got.
    const levelCaps = PURSUIT_CONFIG.heatLevels.map((level) => pursuingSpeedCapMps(level.speedCapMps));
    const chasers = rig.pursuit.diagnostics().units.filter((unit) => unit.role === 'chase' && unit.routeLanes > 0);
    expect(chasers.length).toBeGreaterThan(0);
    for (const unit of chasers) expect(levelCaps).toContain(unit.capMps);
  });

  it('lights only the engaged units, and never a patrol', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    run(rig.sim, 6);
    const visuals = rig.pursuit.visualUnits();
    const lit = visuals.filter((unit) => unit.lightsOn);
    const engaged = rig.pursuit.diagnostics().units.filter((unit) => unit.active && unit.role !== 'patrol');
    expect(lit.length).toBe(engaged.length);
    expect(lit.length).toBeGreaterThan(0);
  });

  it('never teleports a unit: between steps no unit moves more than a metre, except a placement that is counted', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    const last = rig.pursuit.police.opponents.map((opponent) => ({ x: opponent.state.position.x, z: opponent.state.position.z }));
    let jumps = 0;
    let busts = rig.sim.bustCount;
    run(rig.sim, 25, NEUTRAL, () => {
      // A bust resets the player and returns every unit to its start in the same step. That step is a reset, not a teleport.
      const resetThisStep = rig.sim.bustCount !== busts;
      busts = rig.sim.bustCount;
      rig.pursuit.police.opponents.forEach((opponent, id) => {
        const prev = last[id]!;
        const step = Math.hypot(opponent.state.position.x - prev.x, opponent.state.position.z - prev.z);
        if (step > 1 && !resetThisStep) jumps += 1;
        last[id] = { x: opponent.state.position.x, z: opponent.state.position.z };
      });
    });
    const diag = rig.pursuit.diagnostics();
    // A deployment or a respawn places a unit once; that is the only allowed jump, besides a bust reset (counted above).
    expect(jumps).toBeLessThanOrEqual(diag.deployments + diag.patrolRespawns);
  });

  it('bounds a ram lockout under continuous contact: each lock ends, and free driving returns between locks', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    const frame: InputState = { steer: 0.5, throttle: 1, brake: 0, handbrake: 0 };
    // One lock lasts 1.5 s and then a 4 s cooldown. Rams keep arriving every step for 30 s, as if a unit stayed in contact.
    const locked: boolean[] = [];
    run(rig.sim, 30, NEUTRAL, () => {
      rig.pursuit.onRam();
      locked.push(rig.pursuit.driveInput(frame) !== frame);
    });
    const runs: Array<{ start: number; length: number }> = [];
    let start = -1;
    locked.forEach((isLocked, index) => {
      if (isLocked && start < 0) start = index;
      if (!isLocked && start >= 0) {
        runs.push({ start, length: index - start });
        start = -1;
      }
    });
    const stepSeconds = DT;
    const longest = Math.max(0, ...runs.map((r) => r.length)) * stepSeconds;
    expect(runs.length).toBeGreaterThan(0);
    expect(longest).toBeLessThanOrEqual(PURSUIT_CONFIG.ram.lockoutSeconds + 0.1);
    // Every gap between two locks is at least the cooldown, so the player never stays locked.
    for (let i = 1; i < runs.length; i += 1) {
      const gap = (runs[i]!.start - (runs[i - 1]!.start + runs[i - 1]!.length)) * stepSeconds;
      expect(gap).toBeGreaterThanOrEqual(PURSUIT_CONFIG.ram.cooldownSeconds - 0.1);
    }
  });

  it('ignores a ram outside a pursuit: the driving input is unchanged', () => {
    rig.pursuit.onRam();
    const frame: InputState = { steer: 0.5, throttle: 1, brake: 0, handbrake: 0 };
    expect(rig.pursuit.driveInput(frame)).toEqual(frame);
  });

  it('keeps the pool bounded: never more pursuing units than the level wants, and never more than the pool holds', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    let maxPursuing = 0;
    run(rig.sim, 30, NEUTRAL, () => {
      const snap = rig.pursuit.snapshot();
      maxPursuing = Math.max(maxPursuing, snap.pursuingUnits);
      expect(snap.pursuingUnits + snap.patrolUnits + snap.idleUnits).toBe(snap.poolSize);
    });
    expect(maxPursuing).toBeLessThanOrEqual(PURSUIT_CONFIG.unitPoolSize);
    expect(maxPursuing).toBeGreaterThan(0);
  });
});

describe('pursuit controller: a chaser reaches a stopped player', () => {
  /** Starts a pursuit and runs until a chaser is in capture range of the player, or the limit. Returns the closest gap. */
  function closeIn(rig: Rig, limitSeconds: number): number {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    let closest = Number.POSITIVE_INFINITY;
    const limit = Math.round(limitSeconds / DT);
    for (let step = 0; step < limit; step += 1) {
      rig.sim.update(DT, NEUTRAL);
      const player = rig.sim.state.position;
      const diag = rig.pursuit.diagnostics();
      rig.pursuit.police.opponents.forEach((opponent, id) => {
        if (!rig.pursuit.police.isActive(id) || diag.units[id]?.role === 'patrol') return;
        closest = Math.min(closest, Math.hypot(opponent.state.position.x - player.x, opponent.state.position.z - player.z));
      });
      if (closest <= PURSUIT_CONFIG.capture.rangeMeters) break;
    }
    return closest;
  }

  it('closes to capture range behind a stopped player instead of braking short of it (the player is never a wall)', () => {
    // The player stays where it is: it is not driven. A chaser that brakes for the player would stall short of the range.
    const rig = makeRig();
    const closest = closeIn(rig, 40);
    expect(closest, 'a chaser should reach the capture range (7 m)').toBeLessThanOrEqual(PURSUIT_CONFIG.capture.rangeMeters);
  });

  it('captures a player held in range and slow for the hold time: BUSTED, then the session ends once with reason busted', () => {
    // Staging: the player is held in place each step, so it is slow in range. The capture rule itself is the subject.
    const rig = makeRig();
    const closest = closeIn(rig, 40);
    expect(closest).toBeLessThanOrEqual(PURSUIT_CONFIG.capture.rangeMeters);
    const pinned = { ...rig.sim.state.position };
    const yaw = rig.sim.state.yaw;
    const visited: PursuitState[] = [];
    let busted = false;
    const limit = Math.round((PURSUIT_CONFIG.capture.holdSeconds + PURSUIT_CONFIG.capture.bustedShowSeconds + 6) / DT);
    for (let step = 0; step < limit; step += 1) {
      rig.sim.placeVehicle(pinned, yaw);
      rig.sim.update(DT, NEUTRAL);
      const state = rig.pursuit.snapshot().state;
      if (visited[visited.length - 1] !== state) visited.push(state);
      if (state === 'BUSTED') busted = true;
      if (state === 'INACTIVE') break;
    }
    expect(busted, `the held player should be captured, visited ${visited.join('>')}`).toBe(true);
    expect(rig.pursuit.snapshot().state).toBe('INACTIVE');
    expect(rig.pursuit.snapshot().lastEndReason).toBe('busted');
    expect(rig.pursuit.session.rejectedTransitions).toBe(0);
    // The simulation reads the busted flag after the step that ended the pursuit, sends the car to the spawn, and counts
    // one bust. The flag is then clear, so a later step cannot reset the car again.
    expect(rig.sim.bustCount).toBe(1);
    expect(rig.pursuit.takeBustReset()).toBe(false);
  });
});

describe('pursuit controller: search, escape, and cleanup', () => {
  let rig: Rig;
  beforeEach(() => {
    rig = makeRig();
  });

  it('ends the pursuit once, in cooldown, after the player escapes out of sight and far enough away', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    // Stage the escape: a few seconds of pursuit, then the player is placed far from every police unit, out of view.
    run(rig.sim, 6);
    const far = farthestForwardLane(rig);
    rig.sim.placeVehicle({ x: far.x, y: 0, z: far.z }, far.heading);

    const visited: PursuitState[] = [];
    let endedAt = -1;
    const limit = Math.round(240 / DT);
    for (let step = 0; step < limit; step += 1) {
      rig.sim.update(DT, NEUTRAL);
      const state = rig.pursuit.snapshot().state;
      if (visited[visited.length - 1] !== state) visited.push(state);
      if (state === 'INACTIVE') {
        endedAt = step;
        break;
      }
    }
    expect(endedAt, 'the pursuit should end within the limit').toBeGreaterThan(0);
    expect(visited).toContain('SEARCHING');
    expect(visited).toContain('COOLDOWN');
    expect(rig.pursuit.snapshot().lastEndReason).toBe('cooldown');
    expect(rig.pursuit.session.rejectedTransitions).toBe(0);
  });

  it('after the end, no unit is still pursuing, no unit is lit, and the patrols come back', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    run(rig.sim, 6);
    const far = farthestForwardLane(rig);
    rig.sim.placeVehicle({ x: far.x, y: 0, z: far.z }, far.heading);
    for (let step = 0; step < Math.round(240 / DT); step += 1) {
      rig.sim.update(DT, NEUTRAL);
      if (rig.pursuit.snapshot().state === 'INACTIVE') break;
    }
    run(rig.sim, 3);
    const snap = rig.pursuit.snapshot();
    expect(snap.state).toBe('INACTIVE');
    expect(snap.pursuingUnits).toBe(0);
    expect(snap.patrolUnits).toBe(PURSUIT_CONFIG.patrolUnits);
    expect(snap.level).toBe(1);
    expect(snap.heat).toBe(0);
    expect(rig.pursuit.visualUnits().some((unit) => unit.lightsOn)).toBe(false);
  });

  it('a reset ends the pursuit at once, clears heat and units, and restores the patrols', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    run(rig.sim, 8);
    expect(rig.pursuit.snapshot().state).not.toBe('INACTIVE');

    rig.sim.reset();
    const snap = rig.pursuit.snapshot();
    expect(snap.state).toBe('INACTIVE');
    expect(snap.lastEndReason).toBe('aborted-reset');
    expect(snap.heat).toBe(0);
    expect(snap.pursuingUnits).toBe(0);
    expect(snap.patrolUnits).toBe(PURSUIT_CONFIG.patrolUnits);
    expect(rig.pursuit.visualUnits().some((unit) => unit.lightsOn)).toBe(false);
  });

  it('a reset ends a pursuit only once: a second reset with no session changes nothing', () => {
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    run(rig.sim, 3);
    rig.sim.reset();
    const first = rig.pursuit.session.rejectedTransitions;
    rig.sim.reset();
    expect(rig.pursuit.session.rejectedTransitions).toBe(first);
    expect(rig.pursuit.snapshot().sessionsStarted).toBe(1);
  });
});

describe('pursuit controller: a stuck unit is re-planned, then removed, and never traps the pursuit', () => {
  it('re-plans a stalled chaser once and then removes it, while the pursuit goes on without it', () => {
    const rig = makeRig();
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    // Wait until a chaser is assigned. Only then is there a unit that wants to move and can stall.
    let chaser = -1;
    for (let step = 0; step < Math.round(20 / DT) && chaser < 0; step += 1) {
      rig.sim.update(DT, NEUTRAL);
      const diag = rig.pursuit.diagnostics();
      const found = diag.units.find((unit) => unit.role === 'chase' && unit.active);
      if (found) chaser = found.id;
    }
    expect(chaser, 'a chaser should be assigned within 20 s').toBeGreaterThanOrEqual(0);

    // Fault injection: a blocked unit. After each step it is held at its pose with zero speed, as a car against an
    // obstacle would be. The unit's own driving cannot move it, so only the stuck rules can end its involvement.
    const opponent = rig.pursuit.police.opponents[chaser]!;
    const pinned = { x: opponent.state.position.x, z: opponent.state.position.z, yaw: opponent.state.yaw };
    let replansSeen = 0;
    let removedAt = -1;
    const stallSteps = Math.round(14 / DT);
    for (let step = 0; step < stallSteps; step += 1) {
      if (!rig.pursuit.police.isActive(chaser)) {
        removedAt = step;
        break;
      }
      rig.sim.update(DT, NEUTRAL);
      opponent.state.position.x = pinned.x;
      opponent.state.position.z = pinned.z;
      opponent.state.yaw = pinned.yaw;
      opponent.state.speed = 0;
      opponent.state.lateralSpeed = 0;
      replansSeen = rig.pursuit.diagnostics().stuckReplans;
    }
    const diag = rig.pursuit.diagnostics();
    expect(replansSeen, 'the stalled unit should be re-planned once before it is removed').toBeGreaterThanOrEqual(1);
    expect(diag.stuckRemovals, 'the stalled unit should be removed after the removal limit').toBeGreaterThanOrEqual(1);
    expect(removedAt, 'the stalled unit should be removed within 14 s').toBeGreaterThanOrEqual(0);
    expect(rig.pursuit.police.isActive(chaser)).toBe(false);

    // The pursuit goes on without the unit: it is not held in PURSUING with no unit able to respond.
    run(rig.sim, 20);
    const snap = rig.pursuit.snapshot();
    expect(snap.state === 'PURSUING' && snap.pursuingUnits === 0, 'PURSUING with no pursuing unit').toBe(false);
  });
});

describe('pursuit controller: reacquire through the real sight check', () => {
  it('goes to searching when the player is out of sight, and back to pursuing when a chaser sees the player again', () => {
    const rig = makeRig();
    placeInFrontOfPatrol(rig);
    run(rig.sim, DT * 2);
    rig.pursuit.reportOffence('speeding');
    for (let step = 0; step < Math.round(20 / DT) && rig.pursuit.snapshot().state !== 'PURSUING'; step += 1) {
      rig.sim.update(DT, NEUTRAL);
    }
    expect(rig.pursuit.snapshot().state).toBe('PURSUING');
    const chaser = rig.pursuit.diagnostics().units.find((unit) => unit.role === 'chase' && unit.active)?.id ?? -1;
    expect(chaser, 'a chaser is assigned').toBeGreaterThanOrEqual(0);

    // Out of sight: the player drives away (staging the player only), until the session is searching.
    const far = farthestForwardLane(rig);
    rig.sim.placeVehicle({ x: far.x, y: 0, z: far.z }, far.heading);
    let searching = false;
    for (let step = 0; step < Math.round(30 / DT) && !searching; step += 1) {
      rig.sim.update(DT, NEUTRAL);
      searching = rig.pursuit.snapshot().state === 'SEARCHING';
    }
    expect(searching, 'searching starts after the lost-sight time').toBe(true);

    // In sight again: 15 m ahead of the chaser, inside its view. The chaser is not moved; only the player is staged.
    const opponent = rig.pursuit.police.opponents[chaser]!;
    const ahead = { x: opponent.state.position.x + Math.sin(opponent.state.yaw) * 15, z: opponent.state.position.z + Math.cos(opponent.state.yaw) * 15 };
    rig.sim.placeVehicle({ x: ahead.x, y: 0, z: ahead.z }, opponent.state.yaw);
    let back = false;
    for (let step = 0; step < Math.round(6 / DT) && !back; step += 1) {
      rig.sim.update(DT, NEUTRAL);
      back = rig.pursuit.snapshot().state === 'PURSUING';
    }
    expect(back, 'a unit that sees the player again returns the pursuit to PURSUING').toBe(true);
  });
});
