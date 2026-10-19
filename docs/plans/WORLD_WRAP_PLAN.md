# Infinite looping world: audit and plan

Status: **Stage A complete** (audit, wrap arithmetic, tests). Stages B to E not started. No gameplay behaviour has changed.

## 1. Decision

The wrapped world is the existing populated city, joined into a torus. The east edge joins the west edge, and the north
edge joins the south edge.

- Period: 12 lattice nodes, 2400 m on each axis (`src/config/worldWrapConfig.ts`).
- Chunks: 400 m (existing streaming size), so the period is six chunks on each axis, on chunk indices -3 to 2.
- Coordinates: the simulation's logical position is continuous and unbounded. It is never folded or teleported. Wrapped
  positions are used only for geometry lookups. Render positions are camera-relative (see section 3).

The paused 12 km open-world plan (`WORLD_STREAMING_PLAN.md`) is not the basis for this work. This work uses the 2.4 km
map, as the brief asks.

**Limitation to accept or change.** A 2.4 km loop repeats its geography every 2.4 km. At highway speed (30 m/s) that is
about 80 seconds. The brief asks for controlled reuse. Section 6 lists the variety options. This is the largest open
decision.

## 2. Audit: finite-world assumptions

Each row was checked in the code unless marked "inferred".

| Area | Assumption found | Where | Stage that fixes it |
| --- | --- | --- | --- |
| Lattice | Populated nodes -4..8 are 13 distinct nodes. Node 8 duplicates node -4 after wrapping. | `cityLayout.ts` (`CITY_NODE_INDEX_MIN/MAX`) | B |
| Lattice edge | Edge nodes have no arms that leave the grid, so the edge is a closed barrier. | `cityLayout.ts` header, `cityNetwork.ts` `junctionArms` | B |
| Highways | The north-south highway (column 4) and east-west highway (row 6) run the full length. On a torus they become ring roads. | `cityLayout.ts` header | B (check traffic and race routes) |
| Drivable boundary | Built from network segments. Point queries assume one copy of the geometry. A point near one edge needs the neighbour across the seam. | `simulation/roadBoundary.ts` (`buildRoadBoundary`, `signedDistance`) | B: nearest image over offsets of -P, 0, +P |
| Inside-world test | `insideWorld` checks the boundary's bounding box. A car outside the box triggers an "outside-bounds" recovery. This would fire at the seam or after one loop. | `engine/gameSimulation.ts` (`insideWorld`), `world/worldRecovery.ts` (`insideBounds`) | B (critical) |
| Minimap | View bounds come from the network extents. Routes and markers across the seam are not drawn. | `ui/minimapModel.ts` (`networkBounds`) | D |
| Chunk ids | Chunk ids are `floor(x / 400)`, unbounded. Streaming uses canonical ids, not the seam copy. | `streaming/chunkGrid.ts`, `config/worldStreamingConfig.ts` | C |
| Chunk comment | `cityLayout.ts` says chunk (kx) owns cells `2kx..2kx+1`. The real range is `-3..2` and the ownership is `2kx+2..2kx+3`. | `cityLayout.ts` header; verified by `worldWrap.test.ts` | C (fix the comment) |
| Stale note | Earlier notes give the chunk range as -2..2. The test shows -3..2. | `WORLD_STREAMING_PLAN.md` / notes | C |
| Districts | District ring is defined as cells near the core. Core is one copy. | `cityLayout.ts` (`districtOfCell`, `CITY_CELL_DISTRICTS`) | E |
| Landmarks and spawn | Fixed positions in the core. They are unique on a torus. | `cityLayout.ts` (`CITY_LANDMARKS`, `CITY_SPAWN`) | E |
| Race progress | Already measured along the route, and the route is a cycle: "the shorter way round". Compatible with a loop. | `race/raceProgress.ts` | D (verify routes across seams) |
| Race routes | Built on lane chains. A route across the seam is a lane chain across node 7 to node -4. | `race/raceRoute.ts` | C/D |
| Police and traffic | Lane-graph based. Recycling and "near player" checks may use straight-line distance. | inferred; `traffic/`, `pursuit/` | D |
| Rendering | Scene objects appear to use world coordinates directly. Float32 precision degrades far from the origin. | inferred from `position={[...]}` use in `render/` | B (camera-relative render) |
| Save data | Stores ids and numbers. Whether it stores positions is not verified. | `README.md` save section; inferred | D (verify) |

Distances were checked for the lattice: nodes at x = (i - 2) × 200 m. Cells are centred at (i - 1.5) × 200 m. Cell -4
spans -1200 to -1000 m. Cell 7 spans 1000 to 1200 m, so the seam between cell 7 and cell -4 is at x = 1200 m (≡ -1200 m).

## 3. Coordinate model (implemented in Stage A)

`src/world/wrap/worldWrap.ts` (pure arithmetic):

- `wrapScalar(v, P)`: maps any finite value into [0, P). A multiple of P maps to 0. Values just below a boundary stay
  just below P.
- `wrapDelta(from, to, P)`: shortest signed displacement, in [-P/2, P/2). Sums along a path to the net movement, so the
  motion is continuous across a seam.
- `boundaryCrossings(prev, next, P)`: signed count of cell changes. Handles several seams in one fast step.
- `renderOffset(camera, logical, P)`: camera-relative offset on the shortest wrapped path. Continuous across seams.
- `wrappedDistance(a, b, P)`: distance on the torus.
- `wrapIndex(i, min, count)`: integer lattice or chunk index in [min, min + count).
- `wrappedChunkOf(x, z, geometry)`: canonical chunk id.
- `validateWrapGeometry(g)`: period must be a whole number of chunks, and the chunk count must match.

`src/world/wrap/wrapGeometry.ts`: `currentWrapGeometry()` derives the geometry from the config and the city layout, and
throws if it is invalid.

Rules for the later stages:

1. Physics, velocity, heading, race progress, career, and save state use logical values only.
2. Geometry queries use the wrapped point, or the nearest image of it (offsets of -P, 0, +P, for distances under P/2).
3. Rendering uses camera-relative offsets, so GPU values stay small after long sessions.
4. A seam crossing changes no simulation value. A test must fail if one does.

## 4. Stage plan

- **Stage A: architecture and wrap math. Done.** Audit above. `worldWrap.ts`, `wrapGeometry.ts`,
  `worldWrapConfig.ts`, and `worldWrap.test.ts` (30 tests, all passing). `tsc` and `eslint` pass on the new files.
- **Stage B: minimal playable prototype.** Make the lattice periodic. Replace the closed edge with periodic arms, and
  remove the duplicate node 8. Use nearest-image boundary queries. Replace `insideWorld` with a wrap-aware test, so that
  the seam cannot trigger a recovery. Use camera-relative rendering. Gate: a car crosses all four edges in the running
  game, with physics and camera continuous.
- **Stage C: road and chunk integration.** Periodic road graph validator (continuity across every seam). Canonical chunk
  ids with copy offsets. Activation ahead of the car. Gate: high-speed driving across seams with no unloaded gaps.
- **Stage D: gameplay integration.** Traffic, police, races (lap counting, checkpoints, finish), minimap and navigation,
  and career event markers across seams. Gate: regression tests for each system at a seam.
- **Stage E: visual polish and optimisation.** Remove visible seams, add variety, check memory over repeated loops. Gate:
  measured results only.

Stage gates are verified by tests and by browser runs. Each stage is reported when it is done, and the next stage does
not start until the previous one is verified.

## 5. Browser feasibility

The sandbox renders at about 1 frame per second. A full loop (2.4 km at 30 m/s) is about 80 seconds of simulated time,
which is too slow to drive in the browser at that frame rate. Plan for it:

- Stage B and C browser checks use staging through the DEV API (placing the car 20 m before an edge). Driving across the
  seam is then keyboard input, and only a few seconds long.
- Long-run tests (repeated loops, memory) run as unit or simulation tests, not in the browser.

## 6. Decisions needed (for the user)

1. **Loop length and variety.** The 2.4 km torus repeats. Options:
   - (a) Accept the 2.4 km loop, and add variety through district and landmark choice per cell (cheap, but the same
     blocks repeat every loop).
   - (b) Enlarge the torus (for example 4.8 km or 12 km). This needs more generated content and more chunks.
   - (c) Non-periodic generation, with seeds per region. This is a different architecture and is not planned here.
2. **Sign-off on the 2.4 km map.** The brief says to use the existing expanded map. This plan does that.

## 7. What is not claimed

- No seamless driving has been verified. Stage A changed no gameplay.
- No performance or memory figure is claimed. None has been measured for the wrapped world.
- The world is not "infinite" in content. It is a loop of the existing map.


## 8. Stage status

- **Stage A: done.** Wrap math and the torus over the populated lattice. See `PROJECT_CONTEXT.md` section 27.
- **Stage B: done, verified.** `?world=loop` prototype (opt-in at the time; the loop is the default since `PROJECT_CONTEXT.md` section 32). Browser crossings at all four edges (34/34 at the time). See `PROJECT_CONTEXT.md` section 28.
- **Stage C: done, verified in simulation and at low speed in the browser. Not verified at high speed in a browser.** Gap probe,
  streamer stats, 16 seam streaming tests, a measured build-latency sweep, and browser streaming checks (50/50). The gate
  "high-speed driving across seams with no unloaded gaps" is met in simulation at 30 and 60 m/s. The measured tolerance is
  about 8 s to 15 s of build per chunk at 60 m/s. See `PROJECT_CONTEXT.md` section 29.
- **Stage D: close-out items (a)-(e) are closed or honestly reported. (a)-(d) resolved; (e) partly diagnosed.** Each system has seam
  tests. See `PROJECT_CONTEXT.md` section 31 for the close-out table.
  - Traffic: 6 seam tests, two mutants, browser 6/6 on the loop with one observed crossing (`loop_stageD3`). The three
    recycles in run 2 were far-from-player culling. Traffic image (`traffic_loop.png`) inspected: no traffic vehicle is
    clearly in frame, so the crossing is evidenced by the harness data, not the image.
  - Police: 6 seam tests. Sight and routing fail under a period mutation. The deployment test does not discriminate.
    Browser (`browser-pursuit.py`, loop and finite): 34/34 each. (a) was a harness fault, not a rule fault. The speeding
    rule is 1.4 x the 14 m/s street limit (19.6 m/s) for 2 s in view. Headless game time runs at about 0.3 to 0.5 of wall
    time, and the 14 s wall budget ended before the car reached 19.6 m/s. The budget is now 60 s and ends on a cancelled
    detection. Reset staging read the state after a fixed 1 s wait, while the session applies on a later step. It now
    waits up to 8 s for the state. Rule and tuning are unchanged.
  - Races: 13 progress tests (mutants fail 2, 1 and 1; the seam-sprint step rule fails 1), 4 marker-placement tests (a mutant fails 1).
    The seam sprint (loop only, user-approved new content) crosses the seam; browser `browser-race.py S` 10/10. (b) was a harness budget
    fault: game time at 32 steps per second is about 0.53 game seconds per wall second, so the 3-2-1 countdown (3 game
    seconds) outlasted the 6 to 8 s wall budgets. Budgets now 40 s for GO, a clock poll, and a 1200 s drive budget. Loop
    browser: C, D, E pass (`loop_race3`); J (two laps) passes 11/11 standalone (`loop_race4`). Finite browser: J passes
    11/11 standalone after a reward check fix (`finite_race3`); the full finite run before that fix was 43/44 (the one
    failure was the J reward check comparing the session total, not the step's reward). A full clean finite run has not
    been repeated.
  - Minimap and navigation: 8 seam tests, `tsc` clean. Browser 6/6 on the loop after the bounds change, with the car
    crossing the east seam (`loop_minimap4`). The empty-share metric reads 0.000 at centre and is a weak check. The
    navigation was later added (section 32), so this item is superseded.
  - Career markers share the race visuals and the minimap marks, so they use the same placement.
  - Grey blocks: `ROAD_TEST_BLOCKS` were rendered on the road. No longer rendered. 7 clearance tests and a mutant.
  - Open:
    - (c) Resolved. New loop-only route `seam-sprint`. Two seam bugs fixed: the nearest-segment search matched the
      period-length seam segment, and a seam step counted as a relocation with a gate test across the map.
    - (d) Resolved. `loop_race/seam_marker_closeup.png` and `loop_race/seam_marker_closeup12m.png`.
    - (e) Partly diagnosed. In the loop Sprint run (`loop_race2`) the car wedged at the corner of junction J-3-1 (about
      x 188 to 210, z -190 to -193), with the footprint off the surface and speed under 0.5 m/s. `WORLD_RECOVERY` `stuck`
      fired after 20 s and moved the car to the nearest lane. The race counted that as a relocation. The same boundary
      shapes exist in the finite city, so the geometry is not loop-specific. The wedge did not recur in the next Sprint
      run (`loop_race3`). Whether the cause is the harness turn speed or the product corner geometry is not confirmed.
- **Stage E: measured, not closed.** Memory flat over about 11 loops (headless); seams checked on two frames; precision measured by arithmetic; variety measured per period, no per-copy variety by design. Open items: a 20-loop soak, FPS on real hardware, and two unexplained one-off heap samples. See `/home/user/verification/stage_e/RESULTS.md`.

The README wrap section is still pending.

## 9. Stage D plan: gameplay integration

Gate (from section 4): regression tests for each system at a seam, plus a browser check. Systems: traffic, police, races,
minimap and navigation, career event markers.

Frame rule. Every distance between two world objects uses the shortest wrapped displacement (`wrapDelta`, via a helper that
is the identity on finite worlds). Lanes stay in their base domain. A query point is mapped to the image nearest its
reference. Nothing is unwrapped into state, so no lane transition needs an offset. Only rendering picks the image nearest
the camera.

Audit (raw coordinates found, before this stage):
- `laneGraph.nearestOnLane` compares raw coordinates. Used by traffic, police routing, world recovery and AI. Fix once here:
  each lane knows its period, and the query is mapped to the image nearest the lane start.
- `trafficSystem`: spawn ahead/lateral test, junction reach, overlap with the player box, recycling by distance.
- `trafficAmbient`: distance from the player when proposing ambient spawns.
- `trafficVisuals` and `TrafficLayer`: positions drawn at base coordinates, so a car across a seam would be drawn 2.4 km away.
- Police, races, minimap, career markers: to audit per system before changing it.

Order (each step has a test before the next):
1. Lane period and nearest-on-lane. Test: every successor joins its predecessor across the seam (within 0.5 m).
2. Traffic on the loop: spawn, recycling, ambient, visuals, collision. Test: traffic runs at a seam.
3. Police on the loop: sight, routing bounding box, deployment. Test: a pursuit across a seam.
4. Races on the loop: gates, progress, lap and finish. Test: no finish from wrapping near the start.
5. Minimap, navigation, career markers. Test: marks at the nearest image.
6. Browser: low-speed drive across a seam with traffic on, a minimap check, and the existing regression suites.

Not claimed until verified: high-speed behaviour in a browser, FPS, and any change to finite-world behaviour.

### Navigation and default world (after Stage D close-out)

- The loop is the default world (user decision). The finite city is `?world=city`.
- Navigation: a route on the lane graph to the career target, else the garage. Ground ribbon and minimap line. The
  route and garage are verified in the browser (`tools/browser-navigation.py`, 8/8) and in unit tests. Open: the garage
  hint and the career route can disagree in the HUD (see `PROJECT_CONTEXT.md` section 32.3).
