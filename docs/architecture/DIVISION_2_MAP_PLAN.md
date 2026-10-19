# Division 2 map: plan

Status: phases 0 to 5 are done in code and tests. The loop was widened from 2400 m to 2800 m (14 nodes per axis) after the user confirmed a bigger map. Cleanup pass (this session): tsc with --noUnusedLocals --noUnusedParameters is clean; eslint is clean on the Division 2 modules; the unused exports listed in the cleanup scan were made module-internal or removed (none were used by any other file or test); `npm run check` passes (156 files, 1,671 tests). The browser check is not done, and the user does not want one after phase 5. No commit, push or deploy. The push needs a file list: about 172 untracked, 87 deleted and 43 modified paths in `git status`.

## Decisions (answered by the user)

- **Loop period: 2800 m, not 2400 m.** The user chose "bigger loop (period changes)" over keeping the 2400 m period. The user then confirmed the 2800 m layout ("I plan for bigger and bigger maps"), and asked that the layout stay data-driven. The 12 km ETERNIX target still conflicts with the loop size. That is unresolved.
- **Maximum grade: 8 percent.** Set in `src/config/terrainConfig.ts` (`TERRAIN_CONFIG.maxRoadGrade = 0.08`). The steepest street is 3.3 percent (see Phase 3).
- **Order: phases 1 to 4 first.** No Division 2 race route work until the district is built and tested.
- **Browser check after phase 5: no.** Tests only. Revisit only if the user asks later.
- **"The mountain" is the hillside district.** It is part of the loop, and it wraps with the city.
- **Residential houses and other zones are not touched.** The user asked for a bigger map, not a change to the existing zones.

## What you asked for

- A new map for Division 2 (Urban Syndicate).
- It is a **new district on the loop city**, not a separate track.
- Style: **hillside switchbacks, with real elevation**.
- Size: **full district**, with several linked routes.

## Requirement: the hillside is part of the loop

The hillside district is part of the loop, not a separate map. It wraps with the rest of the city:

- Its roads join the loop's highways, so a car can drive from the city into the hillside and back.
- Its traffic, pursuit and lamps use the loop's period and wrap maths, like the rest of the city.
- Its chunks stream with the city chunks, and nothing special is done at its edges.
- Its race routes are checked on the loop, like the existing city routes.

Phase 4's regression pass includes a car that drives across the seam between the hillside and the city.

## The 2800 m layout (current)

- **Lattice.** `src/config/worldWrapConfig.ts` sets `periodNodes = 14` and `firstNodeIndex = -4`. `cityLayout.ts` derives `CITY_NODE_INDEX_MIN = -4` and `CITY_NODE_INDEX_MAX = 10` from them. That gives 15 x 15 nodes and 14 x 14 cells, 2.8 km square. The loop builds nodes -4 to 9, and node 10 is node -4 after wrapping.
- **Cells.** Residential ring cells -2..5 (and the core) are unchanged. Hillside cells are `HILLSIDE_CELL_COLUMNS = [-4, -3, 6, 7, 8, 9]`. Those six columns were the countryside cells at 2400 m. **Consequence:** every non-ring cell on the loop is now hillside, so the loop has no countryside district. The user confirmed this layout. Say so if the countryside look should come back.
- **Heights.** The mountain is a product of two profiles. Across the strip (the arc from node 6 to node 12, which is node -2) a half sine rises from zero to a crest. Along the strip a cosine in j peaks at row 2. `nodeHeightMeters(i, j)` gives 12 m at the crest, node (9, 2). Both ends of the arc are exactly zero, so node 6 and node -2 sit flat beside the residential ring.
- **Seam.** The seam is at x = 1600, which is node 10 and base x = -1200. It falls inside the mountain. The crest row climbs to the seam and comes down the far flank into the flat city at node -2 (x = -800).
- **Base domain.** The loop's base domain is `[origin, origin + period)` with `origin = baseOriginMeters = (firstNodeIndex - 2) * 200 = -1200`. It is aligned to the node grid. The old base was centred on zero, `[-P/2, P/2)`, which only lined up at 2400 m. `wrapToBase(value, period, origin)` in `src/world/wrap/worldWrap.ts` does the mapping. `baseImage`, roads, pursuit, traffic, navigation, the minimap, dev start, hillside ground and the chunk period all use it.
- **Chunks.** `chunkPeriodFor(period, size, origin)` accepts any whole number of chunks, so 7 chunks at 2800 m works. The origin is now a required argument (it used to default to a centred base, which was a trap). `worldIndex.ts` passes `baseOriginMeters`. The canonical chunks are -3..3. The old even-count rule came from the centred base, and it is gone.
- **Grade.** The steepest street is H--3-2 at 3.34 percent (east-west, about 180 m between pads). The north-south steepest is 1.5 percent. 144 streets carry a slope. The 8 percent limit holds everywhere, and the test checks it.

## Why this was a large change

These facts come from reading the code, not from a test run.

- **Roads were flat by design.** `roadTypes.ts` said every road has elevation 0. `roadBuilders.ts` set `elevationMeters: 0` everywhere. The road validator checked that elevations match at joins. Vehicles were placed at `y: 0`. Elevation touched the road model, the validator, the vehicle physics, the camera, road meshes, the lane graph and the road boundary.
- **The city is a fixed lattice.** Lane ids such as `H-0-0:F:0` depend on it. The highway row and column run the full grid.
- **The city wraps as a loop.** Traffic, pursuit, races and the minimap all use the period and the network.
- **Streaming uses 400 m chunks.** Each chunk owns 2 x 2 cells (`streaming/chunkGrid.ts`).

## Risks

1. **Changing the loop period** changes distances for traffic, pursuit, races and the minimap. Existing tests and routes needed updating (done).
2. **Elevation in physics** changes handling on every road, not just the new district, unless the slope is zero outside it.
3. **Wrap and streaming** must stay correct across the district boundary.
4. **Existing race routes** (Divisions 1 and 2, and the rival races) must keep their meaning.

## Phases

Each phase ends with `npm run check` passing before the next one starts.

0. **Decide the layout.** Done. Decided at 2400 m first. The user then chose a bigger loop, and the layout is at 2800 m (above).
1. **Elevation model.** Done. Road validator and grade limit.
2. **Physics and rendering.** Done. Slope in acceleration and braking, and vehicle `y` follows the road.
3. **District geometry.** Done. The hill cells, the arc profile, the terrain and the chunk ownership.
4. **Regression.** Done. Traffic, pursuit, the minimap, scenery and existing race routes pass on the loop.
5. **Division 2 routes.** Done. Four races on the hillside, each with its own path and marker.
6. **Browser check (optional).** Not done. The user does not want it after phase 5.

## Phase 0 finding: where the district can go

- At 2400 m the 12 x 12 cell torus was fully used. Six hillside columns could not fit without replacing residential cells. At 2800 m the grid has 14 columns: 8 are the residential ring and 6 are hillside. Nothing else is free.
- The east-west highway (row 6) and north-south highway (column 4) run through the whole grid, so a district must join one of them.
- The user confirmed the east strip (`confirm_east`). The grid change supersedes the count, not the east-strip placement.

## Mountain fixes (before the grid change)

These changed the mountain, which is the same district:

- **Green patches.** The ground was a bilinear patch that could sit up to 0.61 m above the asphalt beside flat roads. `src/world/hillsideGround.ts` carves the ground under each road. Test: asphalt is above ground across the full width of every hillside street.
- **Lights at ground level.** Lamp heights now follow the road height under them (`cityScenery.ts`, `loopScenery.ts`, `baseY`).
- **Pine trees.** `buildPineTrees` puts pines on hillside cells only, each on the ground under it, and clear of every road. The forest is dense: 40 pines per hillside cell (`PINES_PER_CELL`), and 120 per cell in the mountain centre (`CENTRE_PINES_PER_CELL`). The centre is `isMountainCentreCell`: the cells whose average height is at least 65 percent of the peak (`MOUNTAIN_CENTRE_HEIGHT_FRACTION`), which is 16 cells on the ridge. Placement uses 10 attempts per wanted tree, with 6 m minimum spacing (`PINE_SPACING_M`). `hillsidePines.test.ts` asserts at least 30 pines in every hillside cell, 100 to 150 in every centre cell, and at most 40 elsewhere. The instance budget in `cityScenery.test.ts` is 30,000 (24,850 at 2800 m).
- **Dirt roads.** Every second street row on the mountain is dirt (`isDirtStreet`, even rows in the hillside columns). Dirt cuts top speed and handling by `DIRT_DRY_REDUCTION = 0.05` (5 percent), and by `DIRT_WET_REDUCTION = 0.15` (15 percent) in rain. The wet penalty is a total, and it is pending the user's confirmation. Measured dry dirt top speed is 0.94 to 0.96 of asphalt.

## Traffic finding (found by the 2800 m change)

The ambient generator picked a lane uniformly from the whole network, then kept only the ones in the spawn band around the player. A bigger map therefore thinned the traffic near the player. The population test measured an average of 2.0 active cars at 14 nodes, and 4.0 at 12 nodes, with the same code and seed. The fix is in `src/traffic/trafficAmbient.ts`. The generator now picks only from lanes whose bounding box is within the maximum spawn distance of the player, checking the loop's neighbouring copies. Work per decision stays linear in the lane count. The population test passes again.

## Tests that changed with the 2800 m layout

- `src/world/city/hillside.test.ts`: the six-column layout, the arc profile, the 2800 m period, the seam joining both sides, and the chunk ownership (`kx = floor((i - 2) / 2)`).
- `src/world/wrap/worldWrap.test.ts`, `src/world/streaming/periodicChunks.test.ts`: seven chunks, -3..3, the aligned base. Generic maths tests keep their explicit period.
- `src/world/hillsideSeam.test.ts`: the seam is at x = 1600. The test drives over the crest and down the far flank to the flat city, which is about 450 m past the seam.
- `src/world/hillsideGround.test.ts`, `src/world/roadElevation.test.ts`: the seam and the crest at node (9, 2).
- Seam tests for navigation, pursuit, the boundary, traffic and the minimap: the east side is logical 1600, and the base origin is -1200.
- `src/traffic/trafficSystem.loop.test.ts`: the seam lanes are found at x in 1500..1610. The motion test asserts that the car reaches the far side, not a particular straight-on lane. Traffic turns at junctions are random.
- `src/world/streaming/streamer.test.ts`: the walk releases unloaded chunks each step, as the renderer does. Without that, unloading chunks fill the active budget.
- Node counts: the finite city has 15 nodes per side and 225 junctions. The loop builds 14 nodes per side and 196 junctions.

## Phase 3 status (done in code and tests)

- **Heights.** The arc profile at 2800 m, peak 12 m at node (9, 2). The layout is periodic in j with the 14-node period.
- **Streets.** `buildStraight` takes `endHeightMeters`. `riseAlong` raises the centreline by arc length, so a street climbs from its start pad to its end pad. Junctions sit at their node heights. `buildArc` stays level.
- **Cells and districts.** `districtOfCell` returns `hillside` for hill cells in the populated grid. `cityScenery` gives the hillside no buildings.
- **Terrain.** `src/world/hillsideTerrain.ts` builds per-vertex ground at 40 subdivisions per chunk. `StreamedWorld.tsx` mounts it in each chunk's group, with the image offset, and disposes it on unmount.
- **Race visuals.** `RaceVisualPool` takes the road elevation. Markers take the road height under them.
- **Chunk ownership.** The chunk grid is offset from the node grid, so the terrain code asks `chunkOfPoint` which chunk owns each cell centre. It does not assume `[2kx, 2kx+1]`.

## Phase 4 status (done in code and tests)

- **Seam regression** (`src/world/hillsideSeam.test.ts`). A car drives east along the crest row (H-9-2), across the seam at node 10 (x = 1600, which is -1200 on the base), and down the far flank into the flat city. It stays on the road (within 0.6 m of the surface). Past the seam it reads zero. The wrap images of the lookup agree.
- **Known limit, found by this test.** Where a street meets a junction pad, the height lookup can pick the pad connector (height zero) over the street a few centimetres away. The car then steps down up to about 9.6 cm in one step. The seam test bounds this at 12 cm. A fix would blend the two lanes at the crease. It is not done.

## Phase 5 status (done in code and tests)

The four Division 2 races are on the hillside, each with its own path and marker. Each keeps its traffic and time limit.

| Race (id) | Layout | Path |
|---|---|---|
| Warehouse Circuit (`career-warehouse-race`) | `LAYOUT_WAREHOUSE`, 2 laps, traffic | Block of columns 6 to 7, rows 0 to 1 |
| Seam Run (`career-seam-race`) | `LAYOUT_SEAM_RIDGE`, traffic | Along the crest row H-6-2 to H--3-2, across the seam (J--4-2) |
| Tight Corners (`career-tight-race`) | `LAYOUT_TIGHT_CORNERS`, 140 s limit, traffic | Up the switchbacks from V-6--3 to V-7-3 (15 lanes) |
| Ren Adair (`rival-adair-race`) | `LAYOUT_REN_TOWER`, 2 laps, traffic | Block of columns 6 to 7, rows 4 to 5 |

- `src/race/division2Routes.test.ts`: each route validates on the loop, starts on the hillside, climbs above 3 m, stays within 8 percent, keeps traffic and time limits, and the Seam Run crosses the seam.
- `src/race/raceRouteDiversity.test.ts`: no two races share a path.

## Car stance on the slope (fixed)

- **Symptom.** The car sometimes went into the road and came back out at once, near the mountain's junctions.
- **Cause.** The rig's root sits on the rear axle at the road height there, and the wheels are children of the root. Body pitch came only from acceleration, so the front axle stayed at rear height. Where a street leaves a flat junction pad, the rear was on the pad (grade zero) while the front was already on the slope. The front then sank up to 0.088 m below the road, and the sink ended as the car moved on.
- **Fix.** `GameSimulation.getRenderRoadPitch()` reads the road height at both axles and returns the pitch between them. `applyVehicleRig` pitches the root about the rear axle (YXZ order, pitch then yaw), so the front axle sits on the road. The physics is unchanged.
- **Test.** `src/world/hillsideStance.test.ts` drives 12 hillside lanes and checks the rendered front axle against the road under it. Worst case after the fix: 3e-17 m (limit 0.03 m).
- **Not covered.** Traffic and AI cars are drawn by other paths. This fix applies to the player's car only.

## Phase 6 (not done)

The browser check is not done, and the user does not want one after phase 5. The dev server is running (`game-preview-21479d83`, port 5173) and serves the current code. The hillside has not been looked at in a browser. In headless Chromium the game stays on "Preparing the road" under software WebGL, so a screenshot does not show the hill.

## Known limits and open points

- The seam step at junction pads (up to about 9.6 cm, see Phase 4).
- Road edges on the ridge's cross slope may sit up to about 0.5 m off the terrain. Not checked by eye.
- The height lookup is by plan position. Two roads that cross in plan at different heights are not told apart. The district has none.
- No countryside cells remain on the loop (see the 2800 m layout). That follows from the confirmed layout.
- The ETERNIX 12 km target still conflicts with the loop size. The user has not resolved it.
- Device and gamepad testing has not happened.

## Next steps

1. The user checks the hillside in the running dev server (lamps, pines, dirt, no green patches). This is the only visual check.
2. Decide whether the seam step at junction pads needs the lookup fix.
3. Division 2 traffic and pursuit on the hill: no test yet beyond the loop-wide tests.
