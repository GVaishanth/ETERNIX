import { beforeEach, describe, expect, it } from 'vitest';
import { CAREER_RACE_EVENTS } from '../career/careerRaces';
import { FIXED_STEP_SECONDS } from '../config/simulationConfig';
import { VEHICLE_CONFIG } from '../config/vehicleConfig';
import { GameSimulation } from '../engine/gameSimulation';
import { createTrafficRuntime, playerFootprintFromConfig } from '../traffic/trafficRuntime';
import { getWorldDefinition } from '../world/worlds';
import { useRaceStore } from '../state/raceStore';
import { RaceController } from './raceController';
import { RACE_EVENTS, SPRINT_EASTSIDE } from './raceEvents';
import type { RaceEventDefinition } from './raceTypes';
import { RACE_CONFIG, RACE_PLAYER_GRID_POSITION } from '../config/raceConfig';
import { twinLaneId } from '../traffic/laneGraph';
import { eventRivalPaceMps, rivalSpeedCapMps } from './pace';
import type { InputState } from '../core/types';

/*
 * Controller tests against a real simulation built the same way App builds the city world. Automated: they run the
 * fixed-step simulation, so the race hooks run on the same steps as the car.
 */

const NEUTRAL: InputState = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const THROTTLE: InputState = { steer: 0, throttle: 1, brake: 0, handbrake: 0 };

function makeRig() {
  const world = getWorldDefinition('city');
  if (!world.network || !world.lanes) throw new Error('city world has no network');
  const traffic = createTrafficRuntime(world.network, world.lanes, world.boundary, world.trafficScenario, playerFootprintFromConfig(VEHICLE_CONFIG), world.ambient);
  const sim = new GameSimulation(VEHICLE_CONFIG, {
    spawn: world.spawn,
    boundary: world.boundary,
    traffic,
    opponents: null,
    recoveryLanes: world.lanes.lanes,
    devReset: world.devReset,
  });
  const race = new RaceController(sim, world.lanes, world.boundary, RACE_EVENTS);
  race.attach();
  return { sim, race };
}

/** Advances the simulation by exactly `steps` fixed steps, with the given input. */
function runSteps(sim: GameSimulation, steps: number, input: InputState = NEUTRAL): void {
  const target = sim.stepCount + steps;
  while (sim.stepCount < target) sim.update(FIXED_STEP_SECONDS, input);
}

describe('race controller: approach card', () => {
  let rig: ReturnType<typeof makeRig>;
  beforeEach(() => {
    rig = makeRig();
  });

  it('opens the card inside the approach radius and closes it outside the exit radius', () => {
    const { sim, race } = rig;
    const grid = race.entries[0]!.route.grid;
    expect(race.phase).toBe('FREE_ROAM');
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.phase).toBe('EVENT_APPROACH');
    expect(race.activeIndex()).toBe(0);

    // A point along the route, past the marker's exit radius. The marker sits beside the start, so the first such point
    // is found from the route rather than by a fixed index.
    const route = race.entries[0]!.route;
    const marker = route.marker;
    let index = route.polyline.xs.length - 1;
    for (let i = 0; i < route.polyline.xs.length; i += 1) {
      if (Math.hypot(route.polyline.xs[i]! - marker.x, route.polyline.zs[i]! - marker.z) > RACE_CONFIG.exitRadiusMeters + 5) {
        index = i;
        break;
      }
    }
    sim.placeVehicle({ x: route.polyline.xs[index]!, y: 0, z: route.polyline.zs[index]! }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.phase).toBe('FREE_ROAM');
    expect(race.activeIndex()).toBe(-1);
  });

  it('cancel on the card dismisses it, and the marker re-arms only after leaving the exit radius', () => {
    const { sim, race } = rig;
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.phase).toBe('EVENT_APPROACH');
    race.cancel();
    expect(race.phase).toBe('FREE_ROAM');
    runSteps(sim, 5);
    expect(race.phase).toBe('FREE_ROAM');
  });

  it('is not an action when no marker is in range: E is refused with a message', () => {
    const { race } = rig;
    expect(race.confirm()).toBe(false);
    race.publish();
    expect(useRaceStore.getState().snapshot.refusal).toBe('Drive to a race marker to start.');
  });
});

describe('race controller: grid, hold, and traffic', () => {
  it('places the player on the grid, holds the car still for the countdown, and restores traffic on cancel', () => {
    const { sim, race } = makeRig();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.confirm()).toBe(true);
    expect(race.phase).toBe('COUNTDOWN');
    expect(sim.traffic!.spawner.isSuspended).toBe(true);

    // Full throttle during the hold must not move the car: the hold is handled in the step, not by a transform.
    const before = sim.state.position;
    runSteps(sim, 60, THROTTLE);
    const after = sim.state.position;
    expect(race.phase).toBe('COUNTDOWN');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(1e-6);
    expect(sim.state.speed).toBeCloseTo(0, 6);

    race.cancel();
    expect(race.phase).toBe('FREE_ROAM');
    expect(sim.traffic!.spawner.isSuspended).toBe(false);
  });

  it('starts the timer at GO, and the race clock does not run during the countdown', () => {
    const { sim, race } = makeRig();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    race.confirm();
    runSteps(sim, 120); // 2 s: still in the countdown
    const session = race.entries[0]!.director.session;
    expect(session.state).toBe('COUNTDOWN');
    expect(session.raceElapsed).toBe(0);
    runSteps(sim, 120); // past GO
    expect(session.state).toBe('RACING');
    expect(session.raceElapsed).toBeGreaterThan(0);
  });

  it('pause freezes race timing, and resume keeps the countdown rather than restarting it', () => {
    const { sim, race } = makeRig();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    race.confirm();
    runSteps(sim, 60); // 1 s into the countdown
    const session = race.entries[0]!.director.session;
    const remainingBefore = session.countdownRemaining;
    race.syncPaused(true);
    expect(race.phase).toBe('PAUSED');
    // While paused, the app does not step the simulation, so nothing advances.
    race.syncPaused(false);
    expect(race.phase).toBe('COUNTDOWN');
    expect(session.countdownRemaining).toBeCloseTo(remainingBefore, 9);
  });

  it('locks reset during a race, and tells the player why', () => {
    const { sim, race } = makeRig();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.blocksReset()).toBe(false);
    race.confirm();
    expect(race.blocksReset()).toBe(true);
    race.refuseReset();
    race.publish();
    expect(useRaceStore.getState().snapshot.refusal).toContain('Reset is locked');
  });

  it('abort after GO fails the attempt, and leave restores free roam with traffic back on', () => {
    const { sim, race } = makeRig();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    race.confirm();
    runSteps(sim, 200); // past GO
    expect(race.phase).toBe('RACING');
    race.cancel(); // Q while racing aborts
    expect(race.phase).toBe('FAILED');
    expect(race.entries[0]!.director.result?.outcome).toBe('aborted');
    race.cancel(); // Q on results leaves
    expect(race.phase).toBe('FREE_ROAM');
    expect(sim.traffic!.spawner.isSuspended).toBe(false);
  });

  it('retry after results resets the attempt and places the car on the grid again', () => {
    const { sim, race } = makeRig();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    race.confirm();
    runSteps(sim, 200);
    race.cancel(); // abort
    expect(race.phase).toBe('FAILED');
    expect(race.confirm()).toBe(true);
    expect(race.phase).toBe('COUNTDOWN');
    expect(race.entries[0]!.director.result).toBeNull();
    expect(race.entries[0]!.director.attemptId).toBeGreaterThanOrEqual(2);
    race.cancel();
    expect(race.phase).toBe('FREE_ROAM');
  });

  it('attaches the AI rivals for the event, from the grid slots, and removes them when the attempt ends', () => {
    expect(SPRINT_EASTSIDE.opponentCount).toBe(9);
    const { sim, race } = makeRig();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    race.confirm();
    expect(sim.opponents).not.toBeNull();
    expect(sim.opponents!.opponents).toHaveLength(9);
    // Rivals start on their own grid slots (the player's 7th-place slot is skipped), and do not move during the hold.
    const director = race.entries[0]!.director;
    for (const opponent of sim.opponents!.opponents) {
      const slot = director.opponentSlot(opponent.id)!;
      expect(Math.hypot(opponent.state.position.x - slot.x, opponent.state.position.z - slot.z)).toBeLessThan(0.05);
    }
    runSteps(sim, 60, THROTTLE);
    for (const opponent of sim.opponents!.opponents) expect(Math.abs(opponent.state.speed)).toBeLessThan(0.01);
    race.cancel();
    expect(sim.opponents).toBeNull();
  });
});

describe('race controller: pursuit entry gate (Part 7)', () => {
  it('refuses to start with the entry block reason, and starts once the block clears', () => {
    const world = getWorldDefinition('city');
    if (!world.network || !world.lanes) throw new Error('city world has no network');
    const traffic = createTrafficRuntime(world.network, world.lanes, world.boundary, world.trafficScenario, playerFootprintFromConfig(VEHICLE_CONFIG), world.ambient);
    const sim = new GameSimulation(VEHICLE_CONFIG, { spawn: world.spawn, boundary: world.boundary, traffic, opponents: null, recoveryLanes: world.lanes.lanes, devReset: world.devReset });
    let blocked: string | null = 'Lose the police before starting a race.';
    const race = new RaceController(sim, world.lanes, world.boundary, RACE_EVENTS, () => blocked);
    race.attach();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.phase).toBe('EVENT_APPROACH');

    expect(race.confirm()).toBe(false);
    race.publish();
    expect(useRaceStore.getState().snapshot.refusal).toBe('Lose the police before starting a race.');
    expect(race.phase).toBe('EVENT_APPROACH');
    expect(sim.traffic!.spawner.isSuspended).toBe(false);

    blocked = null;
    expect(race.confirm()).toBe(true);
    expect(race.phase).toBe('COUNTDOWN');
    race.detach();
  });
});

/** A rig whose race start can be blocked by `block`, as a pursuit does in App. */
function makeBlockedRig(block: string | null) {
  const world = getWorldDefinition('city');
  if (!world.network || !world.lanes) throw new Error('city world has no network');
  const traffic = createTrafficRuntime(world.network, world.lanes, world.boundary, world.trafficScenario, playerFootprintFromConfig(VEHICLE_CONFIG), world.ambient);
  const sim = new GameSimulation(VEHICLE_CONFIG, {
    spawn: world.spawn,
    boundary: world.boundary,
    traffic,
    opponents: null,
    recoveryLanes: world.lanes.lanes,
    devReset: world.devReset,
  });
  const race = new RaceController(sim, world.lanes, world.boundary, RACE_EVENTS, () => block);
  race.attach();
  return { sim, race };
}

describe('race controller: a hidden race never opens its approach card', () => {
  it('a locked (hidden) event shows no approach card and cannot be started from its grid', () => {
    const world = getWorldDefinition('city');
    if (!world.network || !world.lanes) throw new Error('city world has no network');
    const traffic = createTrafficRuntime(world.network, world.lanes, world.boundary, world.trafficScenario, playerFootprintFromConfig(VEHICLE_CONFIG), world.ambient);
    const sim = new GameSimulation(VEHICLE_CONFIG, {
      spawn: world.spawn,
      boundary: world.boundary,
      traffic,
      opponents: null,
      recoveryLanes: world.lanes.lanes,
      devReset: world.devReset,
    });
    const hiddenId = RACE_EVENTS[0]!.id;
    const race = new RaceController(sim, world.lanes, world.boundary, RACE_EVENTS, () => null, null, null, (eventId) => eventId !== hiddenId);
    race.attach();
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    race.publish();
    expect(race.phase).not.toBe('EVENT_APPROACH');
    expect(race.activeIndex()).toBe(-1);
    expect(useRaceStore.getState().snapshot.approach).toBeNull();
    race.detach();
  });
});

describe('race controller: block reason on the card', () => {
  it('puts the block reason on the approach card and refuses the start with it', () => {
    const { sim, race } = makeBlockedRig('Lose the police before starting a race.');
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    race.publish();
    const approach = useRaceStore.getState().snapshot.approach;
    expect(race.phase).toBe('EVENT_APPROACH');
    expect(approach?.blocked).toBe('Lose the police before starting a race.');
    expect(race.confirm()).toBe(false);
    expect(race.phase).toBe('EVENT_APPROACH');
    race.detach();
  });

  it('reports no block when the start is allowed', () => {
    const { sim, race } = makeBlockedRig(null);
    const grid = race.entries[0]!.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    race.publish();
    expect(useRaceStore.getState().snapshot.approach?.blocked).toBeNull();
    race.detach();
  });
});

describe('race controller: results do not hold the next marker', () => {
  it('leaves failed results when another marker is in range, so its card opens', () => {
    const { sim, race } = makeBlockedRig(null);
    const first = race.entries[0]!;
    const second = race.entries[1]!;
    expect(second.route.marker.x).not.toBe(first.route.marker.x);

    sim.placeVehicle({ x: first.route.marker.x, y: 0, z: first.route.marker.z }, 0);
    runSteps(sim, 1);
    expect(race.phase).toBe('EVENT_APPROACH');
    expect(race.confirm()).toBe(true);
    // Abort during RACING: the race fails and its results are on screen.
    for (let guard = 0; guard < 2000 && first.director.state !== 'RACING'; guard += 1) runSteps(sim, 1);
    expect(first.director.state).toBe('RACING');
    race.cancel();
    expect(first.director.state).toBe('FAILED');

    // Drive to the next marker without pressing Q.
    sim.placeVehicle({ x: second.route.marker.x, y: 0, z: second.route.marker.z }, 0);
    runSteps(sim, 1);
    expect(first.director.state).toBe('FREE_ROAM');
    expect(race.activeIndex()).toBe(1);
    expect(race.phase).toBe('EVENT_APPROACH');
    expect(race.confirm()).toBe(true);
    expect(second.director.state).toBe('COUNTDOWN');
    race.detach();
  });

  it('keeps failed results while the car is far from every marker (a finish line is often far from its marker)', () => {
    const { sim, race } = makeBlockedRig(null);
    const first = race.entries[0]!;
    sim.placeVehicle({ x: first.route.marker.x, y: 0, z: first.route.marker.z }, 0);
    runSteps(sim, 1);
    expect(race.confirm()).toBe(true);
    for (let guard = 0; guard < 2000 && first.director.state !== 'RACING'; guard += 1) runSteps(sim, 1);
    race.cancel();
    expect(first.director.state).toBe('FAILED');

    const far = first.route.polyline;
    const last = far.xs.length - 1;
    sim.placeVehicle({ x: far.xs[last]!, y: 0, z: far.zs[last]! }, 0);
    runSteps(sim, 5);
    expect(first.director.state).toBe('FAILED');
    expect(race.activeIndex()).toBe(0);
    race.detach();
  });
});

describe('race controller: an abort inside another marker range keeps its own results', () => {
  it('keeps FAILED results where the race was aborted, even when another marker is in range there', () => {
    const { sim, race } = makeBlockedRig(null);
    const first = race.entries[0]!;
    const second = race.entries[1]!;
    sim.placeVehicle({ x: first.route.marker.x, y: 0, z: first.route.marker.z }, 0);
    runSteps(sim, 1);
    expect(race.confirm()).toBe(true);
    for (let guard = 0; guard < 2000 && first.director.state !== 'RACING'; guard += 1) runSteps(sim, 1);
    expect(first.director.state).toBe('RACING');
    // Abort while standing in the second marker's range: the results start here, so they stay on screen.
    sim.placeVehicle({ x: second.route.marker.x, y: 0, z: second.route.marker.z }, 0);
    runSteps(sim, 1);
    race.cancel();
    expect(first.director.state).toBe('FAILED');
    runSteps(sim, 3);
    expect(first.director.state).toBe('FAILED');
    expect(race.activeIndex()).toBe(0);
    race.detach();
  });
});

describe('race controller: rival pace from the grid place', () => {
  it('each rival keeps the cap of the grid place it starts in, so the cars behind the player are the faster ones', () => {
    const { sim, race } = makeRig();
    const entry = race.entries[0]!;
    const grid = entry.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.confirm()).toBe(true);
    const opponents = sim.opponents;
    expect(opponents).not.toBeNull();
    const base = eventRivalPaceMps(entry.event);
    const capsAtStart = new Map<number, number | null>(opponents!.opponents.map((opponent) => [opponent.id, opponent.driver.capMps]));
    // Countdown (3 s) and GO, then some racing. The player holds still on the grid; the rivals drive off.
    runSteps(sim, 60 * 6);
    expect(race.phase).toBe('RACING');

    const rows = opponents!.opponents.map((opponent) => ({
      id: opponent.id,
      cap: opponent.driver.capMps,
      expected: rivalSpeedCapMps(base, entry.director.startingPlaceOf(opponent.id)),
      place: entry.director.startingPlaceOf(opponent.id),
    }));
    for (const row of rows) {
      expect(row.cap).toBeCloseTo(row.expected, 9);
      // The cap is not re-read from the standings: it is the same as at the start.
      expect(row.cap).toBe(capsAtStart.get(row.id));
    }

    // The caps follow the grid places: the rival that starts at the back has the highest cap, the one at the front the
    // lowest, and the caps are not all one value.
    const byPlace = [...rows].sort((a, b) => a.place - b.place);
    for (let i = 1; i < byPlace.length; i += 1) expect(byPlace[i]!.cap!).toBeGreaterThanOrEqual(byPlace[i - 1]!.cap! - 1e-9);
    expect(new Set(rows.map((row) => row.cap)).size).toBeGreaterThan(1);
    race.cancel();
  });
});

describe('race controller: traffic on the route (Division 2)', () => {
  function rigWith(events: readonly RaceEventDefinition[]) {
    const world = getWorldDefinition('city');
    if (!world.network || !world.lanes) throw new Error('city world has no network');
    const traffic = createTrafficRuntime(world.network, world.lanes, world.boundary, world.trafficScenario, playerFootprintFromConfig(VEHICLE_CONFIG), world.ambient);
    const sim = new GameSimulation(VEHICLE_CONFIG, { spawn: world.spawn, boundary: world.boundary, traffic, opponents: null, recoveryLanes: world.lanes.lanes, devReset: world.devReset });
    const race = new RaceController(sim, world.lanes, world.boundary, events);
    race.attach();
    return { sim, race };
  }

  it('keeps the traffic spawner running for a trafficOnRoute race, and still holds it for an ordinary race', () => {
    const warehouse = CAREER_RACE_EVENTS.find((event) => event.id === 'career-warehouse-race');
    expect(warehouse?.trafficOnRoute).toBe(true);
    const withTraffic = rigWith([warehouse!]);
    // The car must be at the marker to start, as in the game (placeForTest puts it there).
    const markerA = withTraffic.race.entries[0]!.route.marker;
    withTraffic.sim.placeVehicle({ x: markerA.x, y: 0, z: markerA.z }, markerA.yawRadians);
    runSteps(withTraffic.sim, 1);
    expect(withTraffic.race.confirm()).toBe(true);
    expect(withTraffic.race.phase).toBe('COUNTDOWN');
    expect(withTraffic.sim.traffic!.spawner.isSuspended).toBe(false);
    withTraffic.race.cancel();

    const ordinary = rigWith(RACE_EVENTS);
    const markerB = ordinary.race.entries[0]!.route.marker;
    ordinary.sim.placeVehicle({ x: markerB.x, y: 0, z: markerB.z }, markerB.yawRadians);
    runSteps(ordinary.sim, 1);
    expect(ordinary.race.confirm()).toBe(true);
    expect(ordinary.sim.traffic!.spawner.isSuspended).toBe(true);
    ordinary.race.cancel();
  });
});

describe('race controller: a hidden race never pops up', () => {
  it('does not open the approach card for an event that is not shown, and does for one that is', () => {
    const world = getWorldDefinition('city');
    if (!world.network || !world.lanes) throw new Error('city world has no network');
    const hidden = RACE_EVENTS[0]!.id;
    const traffic = createTrafficRuntime(world.network, world.lanes, world.boundary, world.trafficScenario, playerFootprintFromConfig(VEHICLE_CONFIG), world.ambient);
    const sim = new GameSimulation(VEHICLE_CONFIG, { spawn: world.spawn, boundary: world.boundary, traffic, opponents: null, recoveryLanes: world.lanes.lanes, devReset: world.devReset });
    const race = new RaceController(sim, world.lanes, world.boundary, RACE_EVENTS, () => null, null, null, (eventId) => eventId !== hidden);
    race.attach();
    const grid = race.entries[0]!.route.grid;
    expect(race.routeVisible(0)).toBe(false);
    expect(race.routeVisible(1)).toBe(true);

    // Standing on the hidden marker's grid point (inside the approach radius) opens no card.
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 3);
    expect(race.phase).toBe('FREE_ROAM');
    expect(race.confirm()).toBe(false);
    race.detach();
  });
});

describe('race controller: the grid and the rivals on two lanes', () => {
  it('seats the player 7th, with the rivals on the grid, in two lanes', () => {
    expect(RACE_PLAYER_GRID_POSITION).toBe(7);
    const { sim, race } = makeRig();
    const entry = race.entries[0]!;
    const grid = entry.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.confirm()).toBe(true);
    const slots = entry.director.gridSlots;
    expect(slots).toHaveLength(10);
    const player = entry.director.playerSlot!;
    expect(slots.indexOf(player)).toBe(RACE_PLAYER_GRID_POSITION - 1);
    // Both grid lanes are used: the forward lane of the route and its neighbour.
    const laneIds = new Set(slots.map((slot) => slot.laneId));
    expect(laneIds).toEqual(new Set([entry.route.grid.laneId, twinLaneId(entry.route.grid.laneId, 1)]));
    race.cancel();
  });

  it('keeps every rival on the route, on its own lane index, so the second lane is driven, not just placed', () => {
    const { sim, race } = makeRig();
    const entry = race.entries[0]!;
    const grid = entry.route.grid;
    sim.placeVehicle({ x: grid.x, y: 0, z: grid.z }, grid.yawRadians);
    runSteps(sim, 1);
    expect(race.confirm()).toBe(true);
    // The rivals' own lane index, from where each starts (0 or 1). A rival never changes index.
    const spawnIndex = new Map(sim.opponents!.opponents.map((opponent) => [opponent.id, opponent.spec.laneId.endsWith(':1') ? 1 : 0]));
    expect([...spawnIndex.values()].filter((index) => index === 1).length).toBeGreaterThan(0);
    // Each route lane, and its twin on the second lane, is a lane a rival may drive.
    const allowed = new Set(entry.route.laneIds.flatMap((id) => [twinLaneId(id, 0), twinLaneId(id, 1)]));
    runSteps(sim, 60 * 8, THROTTLE);
    for (const opponent of sim.opponents!.opponents) {
      const laneId = opponent.driver.route.laneId;
      expect(allowed.has(laneId), `rival ${opponent.id} on ${laneId}`).toBe(true);
      expect(laneId.endsWith(':1') ? 1 : 0, `rival ${opponent.id} lane index`).toBe(spawnIndex.get(opponent.id));
    }
    race.cancel();
  });
});

