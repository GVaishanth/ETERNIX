# Open-world expansion and chunk streaming: assessment and plan

Status: planning record for the streaming phase. Sections 1 to 4 were written before code changes. Section 5 records
what was implemented and what was not. PROJECT_CONTEXT.md section 26 is the authoritative status.

## 1. Audit of the existing world (as found)

| Area | Finding |
| --- | --- |
| Construction | `src/world/city/cityNetwork.ts` builds a fixed 5 x 5 node grid (800 m square) from `cityLayout.ts`. Ids are `J-i-j`, `H-i-j`, `V-i-j`. Lane ids use `H-0-0:F:0`. |
| Road representation | Logical graph of segments and connections (`RoadNetwork`). Segments are straights and junction pads from `roadBuilders.ts`. Shared ports, validated by `roadValidation.ts`. Not meshes. |
| Boundaries | Connections are explicit port pairs. Adjacent streets meet at junction pads. Positions coincide by construction. |
| Terrain | Flat. One `NetworkGround` plane. No elevation anywhere in the road model (`elevationMeters` always 0). |
| Buildings | `cityScenery.ts` is already seeded per cell (`CITY_SCENERY_SEED` mixed with cell index). Output for one cell does not depend on other cells. Built once for the whole city. |
| Collision | `buildRoadBoundary` makes one union of all segment shapes. `signedDistance` scans every shape (with a bounding-box prune). Cheap at this size, global by nature. |
| Traffic | Lane graph built once for all segments (`buildLaneGraph`). Ambient spawns pick random lanes, filtered by distance. Vehicles beyond 300 m are recycled. |
| Police and race | Use the global lane graph and routes (`policeRouting.ts`, `raceRoute.ts`). Race events and career races use fixed lane ids. |
| Player coordinates | Simulation space, metres, one global frame. Mirrored only at `SimRoot`. |
| Streaming | None. `grep` finds no chunk, pin, or LOD code. |
| Minimap | Static layer drawn once from the logical graph at 0.25 px/m (220 px). Fixed scale, so it shows only about 880 m. Assumes the city fits. |
| Rendering | `RoadNetworkScene` merges all segments into one geometry per layer. `CityScenery` creates four geometries and a material on every mount. `junctionEndsOf` rebuilds a kind map per segment, so the mesh build is quadratic. |
| Retained resources | The scenery list, road meshes, road boundary, lane graph, and minimap canvas all live for the whole session. Nothing is unloaded. |

Consequence: the logical graph and collision data are cheap enough to keep global. The costly parts are rendering
(one merged mesh and all scenery) and the quadratic mesh step. Those are what must stream.

## 2. Scale and coordinates

- Simulation space stays as in PROJECT_CONTEXT section 5: metres, +X right, +Z forward. No change.
- Lattice spacing: 200 m (unchanged). Node index `i` maps to `x = (i - 2) * 200`. Cell index `i` covers
  `x` in `[(i - 2) * 200, (i - 1) * 200)`. Index 0 is the original core's west edge, so the original ids keep their
  meaning.
- Populated grid: nodes `i` and `j` in `[-4, 8]`, that is 13 x 13 nodes and 12 x 12 cells. Span is 2.4 km square
  (x and z in `[-1200, 1200]`). This is the implemented extent.
- Target envelope: 12 km square (brief). Not implemented. The streaming code takes its extent from the graph, so the
  envelope grows by adding nodes. Scaling is measured in tests (see section 5).
- Chunk: 400 m square (2 x 2 cells). Chunk `(kx, kz)` covers `[400 kx, 400 kx + 400)` in x and z. Chunk edges fall on
  node lines, and every cell belongs to exactly one chunk.

## 3. Layout and district plan

- Core (original, unchanged): downtown, industrial, residential, and commercial in the 4 x 4 cells at the centre.
- Residential ring: two cells wide around the core. Smaller houses, trees.
- Countryside: the outer cells. Sparse farm buildings, dense tree clusters, no city towers.
- Highways: the north-south highway (column V-4-*) runs the full length. An east-west highway runs along node row
  j = 6 (z = 800). They meet at junction J-4-6, which is the interchange.
- Landmarks: the four original landmarks (tower, quay cranes, water tower, mall) are unchanged.
- Not implemented: mountain roads (no elevation), tunnels, bridges (no elevation or water), forest and coast
  (needs natural terrain and water), a secluded event road. Each is listed in PROJECT_CONTEXT as deferred.

## 4. Architecture

- Global persistent data (always loaded): `RoadNetwork` (graph), `RoadBoundary` (collision shapes), `LaneGraph`
  (traffic), minimap model, landmark and district tables, and a chunk index (chunk to owned segments, cells, and
  landmarks).
- Chunk lifecycle: UNLOADED to QUEUED to LOADING to ACTIVE to UNLOADING, with FAILED as an error state. The manager is
  pure TypeScript with no Three.js. Hysteresis uses separate load and unload radii.
- Ownership rule: each segment has one owning chunk, chosen from its centre (junction centre or street midpoint). The
  streaming rule is that a chunk is loaded if it is within the active radius of the player, and any segment whose
  bounding box touches an active chunk must have its owner loaded. This keeps shared roads and junction pads whole
  across boundaries without duplicating geometry.
- Rendering: per-chunk road mesh (built from the owned subset, emitting only owned segments) and per-chunk scenery
  instances. Materials and unit geometries are shared and created once. Chunk geometry is disposed on unload.
- Two detail tiers: full (roads and scenery) inside the scenery radius, roads only beyond it. Hysteresis on the
  boundary.
- Pins: race routes and police units keep their chunks loaded. Traffic beyond the active radius is not pinned (it
  is not visible there).
- Collision: the road boundary stays global, so a car cannot fall through a road whose visuals are late. Its memory
  is per shape, with no geometry.
- Minimap: static layer built once at a higher resolution, with a local view centred on the player and a whole-map
  view.

## 5. Implementation status (filled in during the phase)

See PROJECT_CONTEXT.md section 26. Summary of what was built, measured, and deferred is recorded there.

## Status at review gate (verified this session)

- `npm run` type check: `tsc --noEmit` exit 0, zero errors. Covers the Stage A edits and the new pure modules.
- Vitest on `src/world` and `src/ui/minimapModel.test.ts`: 90 passed, 11 failed (10 files ran, 3 failed).
- Failures, grouped:
  - Stale count expectations (25 junctions, 40 streets, 160 lanes, 4 landmarks, 3000 scenery instances, minimap tile area, minimap canvas bounds). Expected by design of the 13×13 layout, but must be updated, not waved through.
  - **Real defect:** Countryside is not reachable from the spawn (district connectivity test C). Cause not yet diagnosed.
  - **Real defect:** houses-only pitched-roof rule fails (test E). Some non-house object has a pitched roof.
  - **Performance concern:** the drivable-area test (test D) takes about 5.8 s, over its 5 s timeout. Boundary build cost at 169 junctions must be measured before streaming.
  - Scenery instance count is 10,126 for the whole populated grid (old bound 3,000). Relevant to the streaming budget.
- Stage B pure modules written before the review gate, unwired into the game: `src/config/worldStreamingConfig.ts`, `src/world/streaming/{chunkGrid,worldIndex,wantedChunks,chunkManager,streamer}.ts`. `roadMeshData.ts` gained `emitIds`, `blocks`, and `prepareRoadInput` options (defaults keep the old output).

## Stage B status (streaming prototype)

Verified in this session (logs in `/home/user/verification/`):

- `npm run check` exit 0 (`check_stageB.log`): typecheck, `eslint .`, 92 test files and 1,050 tests passing, production build.
- Build output: `index` JS 1,454.00 kB (gzip 409.70 kB). Earlier Part 11 figure was 1,400.58 kB, so streaming and the expanded layout added about 53 kB.
- Chunk assignment (`src/world/city/cityChunks.test.ts`, 8 tests): every scenery object and test block is in exactly one chunk. Landmark parts share their building's chunk. Summed per-chunk road triangles and vertices equal the whole-network build exactly, so no segment is drawn twice or missed.

Measured timings (Node, from the probe runs recorded in this section's sources):

- Road network build: 233 ms.
- Boundary build: 0.9 ms. 481 shapes.
- Linear `signedDistance`: 21.8 µs per query. The grid `signedDistance` agrees with the reference within 1e-9 m on 4,000 fixed-seed points (`roadBoundary.grid.test.ts`).

Pursuit finding and fix:

- Profile before the fix: `planTo` self time 15.5 s and `nearestLane` 1.2 s, of about 20 s total in `pursuitController.test.ts`.
- Fix in `src/pursuit/policeRouting.ts`: per-lane bounding boxes with a distance skip, and a binary heap with lazy deletion. The tie rule is unchanged. The 5 s test timeout was not loosened.
- Result: `pursuitController.test.ts` 17/17 in 2.9 s (was 19.3 s). `policeRouting.equivalence.test.ts` checks heap search and nearest-lane results against an O(V²) reference and brute force on 60 fixed pairs.

Design decisions made in code:

- Urgent tier: the chunk holding the player, and the owner of any footprint containing the player's point, load first, ahead of the normal priority order. Without this, a road owned by a chunk behind the start budget was missing on the first frame.
- Deviation from section 4: lamps and signs are assigned to chunks by their own position, not by cell. Buildings and trees follow the cell plan. Landmark parts follow their landmark.
- Test D (`cityNetwork.test.ts`, drivable centreline) now samples every centreline point with seven offsets per side. It runs in about 1.8 s with the grid distance, so the earlier stride is removed.

Open gate: browser verification of the streamed path is NOT passed.

- `tools/browser-city.py` was run against the dev server: 18/24 checks passed (`/home/user/verification/streamB_city/`). The boot, spawn, minimap, junction, reset and error checks pass, but several checks are stale or timing-bound:
  - Stale expectations from the Stage A layout: "65 segments" (the validator reports 481, `issues=0`), the east-edge window of 380–412 m (the grid runs to about ±1.2 km), and the 4×4 district table.
  - Timing-bound: the W-acceleration, traffic-spawn and east-edge checks depend on wall-clock progress.
- Frame rate in headless Chromium (SwiftShader, 2 cores) is about 1 fps with or without streaming, and about 1.1 fps at 480×300. A CPU profile shows 98.6% of time in native work and 0.5% in JavaScript. Streaming's `update` used 1.7 ms over an 8 s profile.
- Likely cause, not profiled on a GPU: the expanded layout has about 547k road triangles across five layers, 18,720 post instances, and about 10k scenery instances. The Part 5 layout was much smaller. This is a Stage D concern (LOD and measured performance). It is not a claim about real-GPU performance.
- Headless frame rate is therefore not used as a performance figure anywhere in this plan.

Still to do before the streamed path can be called working in the browser:

- Update the stale expectations in `tools/browser-city.py` to the Stage A layout, and make the timed checks use simulated time or a longer budget.
- Run the browser check on a machine with a real GPU, or after Stage D reduces the mounted geometry, and record the result.
- Keep the whole-network path as the fallback until that run passes. It is selected by `WORLD_STREAMING_CONFIG.enabled = false` (`RenderLayer.tsx`), which renders `RoadNetworkScene` and `CityScenery` as before streaming.
