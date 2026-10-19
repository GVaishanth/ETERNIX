# Loop growth (toward 12 km) and Division 3: plan

Status: PLAN ONLY for Division 3 and for the growth steps. No Division 3 code exists yet. Nothing is committed, pushed or deployed. Division 3 was rewritten this session (crew boss Karen, highway race); the open design questions are under "Design choices needed before build".

## Decisions (answered by the user)

- **Growth path: toward 12 km, in steps.** First target: **6 km**. Growth is data-driven, so each later step is a data change, not a rewrite.
- **New cells are countryside.** The user chose countryside for the new area. The existing residential and other zones are not touched.
- **Order.** The map and district come first, then routes. No browser check after the route phase (tests only), unless the user asks for one.
- **Max grade stays 8 percent.**
- **Division 3 crew boss is Karen (a woman).** Replaces the earlier "name still to be given".
- **Division 3 is a highway race.** Complete highway racing, with bridges, a tunnel under the mountain, and a pond with a bridge above it, plus other features the user has not yet named ("etc"). This replaces the earlier "same district pattern as Division 2" wording.

## What the growth touches (audit)

- `src/config/worldWrapConfig.ts`: `periodNodes` (14 now, 30 at 6 km), `baseOriginMeters` (derived), `loopGroundSizeMeters` (7200, must stay above the period and the streaming reach).
- `src/world/city/cityLayout.ts`: `CITY_CELL_DISTRICTS` is a hand-written 14 x 14 table. It needs a 30 x 30 table (or a generator that keeps the existing cells exactly). `CITY_HIGHWAY_COLUMN`, `CITY_HIGHWAY_ROW`, `HILLSIDE_CELL_COLUMNS`, `HILLSIDE_FIRST_NODE`, `CITY_RESIDENTIAL_RING_CELLS`, `CITY_CORE_NODE_*` and the landmarks are all in the same file. Each must be checked against the new period.
- `src/world/city/cityNetwork.ts`: builds roads from the layout. The new countryside cells need roads only where the layout puts them.
- `src/world/streaming/periodicChunks.ts` and `src/world/worldIndex.ts`: chunk size must divide the period (6000 m / chunk size must be whole). `chunkPeriodFor` now takes the origin explicitly.
- Traffic, pursuit, lamps, races and navigation all read the loop period through `wrapToBase`. They should not need changes, but the tests must run at the new period.
- Existing tests with hard-coded 2800 m or 14-node values: `hillside.test.ts`, `hillsideSeam.test.ts`, `hillsideGround.test.ts`, `roadElevation.test.ts`, `loopNetwork.test.ts`, `cityScenery.test.ts` (instance budget 25,000 at 2800 m), `periodicChunks.test.ts`.

## Steps for the 6 km target

1. Make the layout's period a single source (already mostly true: `WORLD_WRAP_CONFIG.periodNodes`). Find every place that still hard-codes 14 or 2800 and move it to that source.
2. Add the new countryside cells to the district table. Existing cells keep their districts.
3. Update the chunk period and the ground plane check. Run `worldWrap.test.ts`, `periodicChunks.test.ts`, `hillside*.test.ts`.
4. Run `npm run check`. Save the log.
5. Only then start the next 6 km step, if the user asks.

Expected cost: a 30 x 30 cell table. The instance budget test in `cityScenery.test.ts` will need a new value (countryside adds few objects).

## Division 3: highway race (plan, not started)

### What the user asked for

- Crew boss: **Karen** (woman). The Syndicate crew-boss pattern from Division 2 still applies (a boss, a district, traffic on its routes), but the district is a highway, not a hillside.
- A **complete highway race**: the race runs on a highway from start to finish with traffic on it.
- Map features: **bridges**, a **tunnel under the mountain**, and a **pond with a bridge above it**. The user said "etc", so more features may come; the plan should not assume the list is complete.

### What the current code gives us (checked by reading, not by running)

- **The highway already exists.** `CITY_HIGHWAY_ROW = 6` is the east-west highway (streets `H-i-6`, full width). `CITY_HIGHWAY_COLUMN = 4` is the north-south highway (`V-4-j`). Both are asphalt, both wrap with the loop, and both have `CITY_HIGHWAY_SPEED_MPS = 30` (108 km/h) for traffic.
- **The highway row is a closed loop.** At 2800 m it is one lap of 2800 m, with no start or finish built in.
- **The mountain is small.** `HILLSIDE_PEAK_METERS = 12`. Along the highway row (row 6), the mountain height is about 4.7 m at its highest (node 9). This is a hand calculation from `nodeHeightMeters`. It has not been run.
- **Height lookup is by plan position.** `src/world/roadElevation.ts` cannot tell two roads apart when they cross in plan at different heights. The file says so, and the Division 2 road validator forbids such crossings. An overpass therefore needs a change to the lookup. A bridge over water does not, because water is not a road.
- **No water, bridge or tunnel system exists.** A pond needs a water surface, a basin in the terrain, and no-drive edges. A bridge needs a deck above the water. A tunnel needs portals and an opening in the terrain.
- **Dirt streets.** Even rows in the hillside columns are dirt (`isDirtStreet`). The highway row is excluded, so it stays asphalt.
- **Speed.** The speed envelope (150 to 300 km/h, done this session) is the car side. A highway race at 250 to 300 km/h needs the highway speed limits and the race speeds checked against it. The traffic speed (108 km/h) is separate.

### Design decisions (answered by the user, this session)

- **Highway: a new highway in countryside cells** (the growth path), not the loop highway. Built as a later growth step.
- **Tunnel: raise the mountain at that spot.** Grades must stay under 8 percent, and the dirt-road grades are re-checked.
- **Bridges: over water and over roads (overpasses).** This needs `roadElevation.ts` to tell roads apart by height, not only by plan position. That is a larger change, and it must be designed and tested before any overpass is built. Until then the Division 2 validator still forbids plan crossings.
- The pond is still open: its site must avoid residential cells.

### Design choices (as they were asked; kept for the record)

1. **Where the highway race runs.**
   - (a) Reuse the existing loop highway, row 6, as the Division 3 race, with bridges, tunnel and pond added along it. Smallest change.
   - (b) Build a new highway into countryside cells (the growth path). Bigger change, but it fits the growth plan.
   - Recommended: (a) first, then (b) as a later growth step if the user wants a longer highway.
2. **Tunnel.** The mountain is 4.7 m high on the highway row, too low for a tunnel with headroom. Options: (a) raise the mountain at that spot (a data change to `HILLSIDE_PEAK_METERS` or a local bump, then re-check grades under 8 percent and the dirt-road grades); (b) a short cut-and-cover tunnel with portals, built into the terrain without a height change; (c) move the tunnel to a new ridge in countryside cells.
3. **Bridges.** (a) Bridges over water only (pond and similar). This works with the current height lookup. (b) Overpasses too (a road over a road). This needs a height lookup that can tell roads apart, which is a larger change to `roadElevation.ts`.
4. **Pond.** The pond needs a flat or depressed site. The site must not cut a residential cell (residential zones are not touched).

### Steps (once the choices are made)

1. Data first: highway race route, its start and finish, and its lanes (4 lanes, per the race rules).
2. Bridge and pond map data, with a water surface and terrain basin. Test the deck height above the water.
3. Tunnel data and terrain portals. Test the grade, the headroom and the terrain at the portal.
4. Traffic on the highway at the chosen speeds. Test the speed limit against the car top speeds.
5. Division 3 race route, with Karen as the crew boss in the career data. Test that it is locked and hidden until Division 3 opens, under the race-visibility rule (locked races are not shown).
6. Seam regression across the loop wrap, as in Division 2.
7. `npm run check` with a log file. No browser check after the route phase unless the user asks.

## Open items from before (unchanged)

- ETERNIX 12 km target: now addressed by the growth path above. The brief itself is not in the repo.
- Hillside: the user must check the hill in a real browser (the headless browser could not get past loading). Pines were raised to 40 per hillside cell and have not been seen in a browser.
- Race visibility, navigation shortest path, 4-lane races, pace rules: from the earlier brief. Their status is in `docs/BUG_FIX_LOG.md`.
