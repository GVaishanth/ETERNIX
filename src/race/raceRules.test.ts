import { buildGridSlots } from './grid';
import { describe, expect, it } from 'vitest';
import { RACE_MIN_RACERS, RACE_OPPONENT_CAPACITY, RACE_PLAYER_GRID_POSITION } from '../config/raceConfig';
import { CAREER_CLOCK_RACE_ID, CAREER_RACE_EVENTS } from '../career/careerRaces';
import { buildCityNetwork } from '../world/city/cityNetwork';
import { buildLaneGraph, twinLaneId, type LaneGraph } from '../traffic/laneGraph';
import { buildRaceRoute, type RaceRoute } from './raceRoute';
import { LOOP_RACE_EVENTS, RACE_EVENTS, SPRINT_EASTSIDE } from './raceEvents';
import { RaceDirector, PLAYER_ID } from './raceDirector';
import { legProgressMeters } from './raceProgress';
import { RewardLedger } from './rewards';

/*
 * Race rules: the field size, the solo Clock Run, and the grid order. Every event is checked, so a new event that breaks
 * the full-field rule fails here.
 */

describe('race field rules', () => {
  it('a race has ten racers including the player, and the rival capacity is that minus the player', () => {
    expect(RACE_MIN_RACERS).toBe(10);
    expect(RACE_OPPONENT_CAPACITY).toBe(RACE_MIN_RACERS - 1);
    expect(RACE_PLAYER_GRID_POSITION).toBe(7);
  });

  it('every race event has a full field: the player plus the rival capacity, including the loop-only seam sprint', () => {
    for (const event of [...RACE_EVENTS, ...LOOP_RACE_EVENTS]) {
      expect(event.opponentCount + 1, event.id).toBe(RACE_MIN_RACERS);
    }
  });

  it('every career race is a full field, except the solo Clock Run', () => {
    const solo = CAREER_RACE_EVENTS.filter((event) => event.opponentCount === 0).map((event) => event.id);
    expect(solo).toEqual([CAREER_CLOCK_RACE_ID]);
    for (const event of CAREER_RACE_EVENTS) {
      if (event.id === CAREER_CLOCK_RACE_ID) continue;
      expect(event.opponentCount + 1, event.id).toBe(RACE_MIN_RACERS);
    }
  });

  it('no event asks for more rivals than the visual pool can hold', () => {
    for (const event of [...RACE_EVENTS, ...LOOP_RACE_EVENTS, ...CAREER_RACE_EVENTS]) {
      expect(event.opponentCount, event.id).toBeLessThanOrEqual(RACE_OPPONENT_CAPACITY);
    }
  });
});

describe('race grid order: the player starts 7th, with the faster rivals behind', () => {
  const graph: LaneGraph = buildLaneGraph(buildCityNetwork());
  const route = buildRaceRoute(SPRINT_EASTSIDE, graph).route as RaceRoute;
  /** The grid is built when the attempt starts, so each check starts one. */
  function startedDirector(): RaceDirector {
    const started = new RaceDirector(SPRINT_EASTSIDE, route, graph, new RewardLedger(), RACE_OPPONENT_CAPACITY);
    expect(started.openApproach()).toBe(true);
    expect(started.start()).toBe(true);
    return started;
  }

  it('the player takes the 7th slot, and the rivals fill the other nine in order', () => {
    const director = startedDirector();
    const slots = director.gridSlots;
    expect(slots).toHaveLength(RACE_MIN_RACERS);
    expect(slots.indexOf(director.playerSlot!)).toBe(RACE_PLAYER_GRID_POSITION - 1);
    // Rivals 1 to 6 start ahead of the player, rivals 7 to 9 behind.
    for (let k = 0; k < 6; k += 1) expect(director.opponentSlot(k), `rival ${k}`).toBe(slots[k]);
    for (let k = 6; k < 9; k += 1) expect(director.opponentSlot(k), `rival ${k}`).toBe(slots[k + 1]);
  });

  it('the player is in row 3 (grid positions 7 and 8): six cars are ahead of its row, two are behind', () => {
    const director = startedDirector();
    expect(director.playerSlot?.row).toBe(3);
    const ahead = director.gridSlots.filter((slot) => slot.row < 3);
    const behind = director.gridSlots.filter((slot) => slot.row > 3);
    expect(ahead).toHaveLength(6);
    expect(behind).toHaveLength(2);
    for (const slot of ahead) expect(slot.s, `ahead row ${slot.row}`).toBeGreaterThan(director.playerSlot!.s);
    for (const slot of behind) expect(slot.s, `behind row ${slot.row}`).toBeLessThan(director.playerSlot!.s);
  });

  it('each row is further back along the road than the one before it', () => {
    const slots = startedDirector().gridSlots;
    for (let i = 2; i < slots.length; i += 2) {
      expect(slots[i]!.s, `row ${slots[i]!.row}`).toBeLessThan(slots[i - 2]!.s);
    }
  });

  it('the first row is the start anchor, so the whole field sits behind the start line', () => {
    const director = startedDirector();
    expect(director.opponentSlot(0)?.s).toBe(route.grid.s);
    for (const slot of director.gridSlots) expect(slot.s).toBeGreaterThanOrEqual(0);
  });

  it('once the attempt is built, the player is 7th in the standings, with the faster rivals behind', () => {
    const director = startedDirector();
    const order = director.standings.map((row) => row.id);
    expect(order).toHaveLength(RACE_MIN_RACERS);
    expect(order[RACE_PLAYER_GRID_POSITION - 1]).toBe(PLAYER_ID);
  });
});

describe('grid rows: every row sits on the route, on one of its two grid lanes', () => {
  const graph: LaneGraph = buildLaneGraph(buildCityNetwork());
  for (const event of RACE_EVENTS) {
    it(`${event.id}: each grid row is on the route's forward lane or its twin, at or after the lane start`, () => {
      const route = buildRaceRoute(event, graph).route as RaceRoute;
      const started = new RaceDirector(event, route, graph, new RewardLedger(), event.opponentCount);
      expect(started.openApproach()).toBe(true);
      expect(started.start()).toBe(true);
      expect(started.gridSlots).toHaveLength(RACE_MIN_RACERS);
      for (const slot of started.gridSlots) {
        const column = slot.laneId === route.grid.laneId ? 0 : 1;
        expect(slot.laneId, `row ${slot.row} lane`).toBe(column === 0 ? route.grid.laneId : twinLaneId(route.grid.laneId, 1));
        expect(graph.byId.has(slot.laneId), `row ${slot.row} lane exists`).toBe(true);
        expect(slot.s, `row ${slot.row} s`).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

describe('grid order on every race: the player is 7th at the start', () => {
  const graph: LaneGraph = buildLaneGraph(buildCityNetwork());
  // Circuits start and finish on one line, so their grid runs back past the origin. Every race must still start in order.
  for (const event of [...RACE_EVENTS, ...LOOP_RACE_EVENTS, ...CAREER_RACE_EVENTS]) {
    if (event.opponentCount === 0) continue;
    it(`${event.id}: the player is 7th in the standings, and the rivals fill the places around it`, () => {
      const route = buildRaceRoute(event, graph).route as RaceRoute;
      const director = new RaceDirector(event, route, graph, new RewardLedger(), event.opponentCount);
      expect(director.openApproach()).toBe(true);
      expect(director.start()).toBe(true);
      const order = director.standings.map((row) => row.id);
      expect(order[RACE_PLAYER_GRID_POSITION - 1], event.id).toBe(PLAYER_ID);
      // Every rival ahead of the player is in a row ahead of it, and every rival behind it in a row behind it.
      const player = director.playerSlot!;
      const playerRow = director.racerList.find((r) => r.id === PLAYER_ID);
      if (!playerRow) throw new Error('no player row');
      const playerLeg = legProgressMeters(playerRow, route);
      for (const id of order.slice(0, RACE_PLAYER_GRID_POSITION - 1)) {
        const row = director.racerList.find((r) => r.id === id);
        if (!row) throw new Error(`no row for ${id}`);
        expect(legProgressMeters(row, route), id).toBeGreaterThanOrEqual(playerLeg - 1e-6);
      }
      expect(player.row).toBe(3);
    });
  }
});

describe('race grid: the two forward lanes', () => {
  const graph: LaneGraph = buildLaneGraph(buildCityNetwork());
  // The grid uses the two lanes of the race direction, as the brief requires: F:0 and F:1 for an eastward or northward
  // start, R:0 and R:1 for a westward or southward one. Route lanes are not checked here.
  for (const event of [...RACE_EVENTS, ...LOOP_RACE_EVENTS, ...CAREER_RACE_EVENTS]) {
    if (event.opponentCount === 0) continue;
    it(`${event.id}: every grid slot is on a lane of the race direction`, () => {
      const route = buildRaceRoute(event, graph).route as RaceRoute;
      const slots = buildGridSlots(route, graph, event.opponentCount + 1);
      expect(slots.length).toBe(event.opponentCount + 1);
      const direction = route.grid.laneId.split(':')[1];
      for (const slot of slots) expect(slot.laneId, slot.laneId).toMatch(new RegExp(`:${direction}:[01]$`));
    });
  }
});
