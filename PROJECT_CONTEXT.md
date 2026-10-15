# PROJECT_CONTEXT.md

Living document. Update it at the end of every development phase.

## 1. Project objective

A browser-based 3D open-world street racing game inspired by Need for Speed: Most Wanted (2005).
The goal of the whole project is a stable, extensible foundation for later phases: vehicle handling,
world content, traffic, police AI, progression, UI, audio, and presentation.

**Current phase: Part 3 (road network), built on Part 2, Part 1 and Phase 0.** The scene has a procedural
car with Part 2 handling, and two roads. The **test circuit** (default, `/`) is a connected 12-segment road network
with junctions, arcs, validated connections, guardrails, and a DEV road debug view. The **legacy straight road**
is still reachable with `?world=legacy` and is kept as the reference. Traffic, police, a city, progression, and
purchasing are out of scope and do not exist yet. The full city phase has not been started.

## 2. Audit summary (as found at Phase 0)

- The project directory was empty at Phase 0: a greenfield scaffold. No pre-existing failures to record.
- Node 20.20.2 and npm 10.8.2 are present. Vitest 5.x requires Node 22.12+, so Vitest is pinned to
  4.1.11. TypeScript 7.x conflicts with typescript-eslint 8.71.2 (which requires `<6.1`), so TypeScript
  is pinned to 5.9.3.
- Skills requested in the brief were installed into `.claude/skills/`.
- Reference URLs from the brief (impeccable.style, transitions.dev, gsap-skills,
  make-interfaces-feel-better) were NOT reviewed. They concern presentation, which is later-phase work.

## 3. Technology stack (installed versions, exact pins)

| Package | Version | Role |
|---|---|---|
| react / react-dom | 19.3.1 | UI shell only (not per-frame) |
| three | 0.186.1 | Rendering |
| @react-three/fiber | 9.8.2 | React binding; supplies the single `useFrame` loop |
| zustand | 5.0.15 | Low-frequency shared app state and dev diagnostics |
| typescript | 5.9.3 | Strict type checking |
| vite | 8.3.4 | Dev server and bundler |
| @vitejs/plugin-react | 6.1.2 | React Fast Refresh |
| vitest | 4.1.11 | Unit tests (node environment) |
| eslint | 10.12.0 | Linting (flat config) |
| typescript-eslint | 8.71.2 | TS lint rules |
| eslint-plugin-react-hooks | 7.1.1 | Hook rules, including React Compiler checks |
| eslint-plugin-react-refresh | 0.5.7 | Export hygiene for Fast Refresh |
| @eslint/js / globals | 10.0.1 / 17.13.0 | ESLint base config |
| @types/react / react-dom / three | 19.3.0 / 19.3.0 / 0.186.0 | Type definitions |

Deliberately NOT installed yet:

- **Rapier** (`@react-three/rapier` 2.2.0 / `@dimforge/rapier3d-compat` 0.19.2 were checked for compatibility).
  Vehicle motion is a custom kinematic model. Rapier will be added with collision work.
- **GSAP** (3.15.0 available). Reserved for presentation work.
- **@react-three/drei**. Not needed; keep the dependency surface small.

Browser verification (Part 1) uses Python Playwright with system Chromium. It lives outside the project
dependencies and is driven by `tools/browser-smoke.py`.

## 4. Project directory structure

```
street-racer/
  .claude/skills/          Installed agent skills
  tools/browser-smoke.py   Playwright end-to-end check of the running dev app (see section 14)
  index.html               Entry HTML, mounts #root
  vite.config.ts           Vite + Vitest config; dev/preview bind 0.0.0.0
  eslint.config.js         ESLint flat config
  tsconfig.json            Strict TS config
  PROJECT_CONTEXT.md       This document
  src/
    main.tsx               Entry: mounts <App/>; installs dev-only error capture and dev hooks
    App.tsx                Canvas, HUD, one input attach(window, document), dev-only DebugPanel (lazy)
    styles.css
    core/                  Pure, framework-free building blocks
      types.ts             Vec3, InputState (steer/throttle/brake/handbrake), VehicleState
      math.ts              clamp, lerp, moveTowards, wrapAngle, damp
      coordinates.ts       THE coordinate convention + forward/right helpers + toRenderSpace
      units.ts             Display-unit conversions
    config/                All tuning values (single source of truth)
      vehicleConfig.ts     VehicleConfig + VEHICLE_CONFIG (SI units, placeholders)
      cameraConfig.ts      CHASE_CAMERA_CONFIG (base distance, speed pull-back, damping)
      simulationConfig.ts  Fixed step, frame clamp, substep cap, publish intervals, spawn, road-check segment
      worldConfig.ts       Two lanes, shoulders, lines, markers, props, road extent, ground size
    engine/
      fixedStep.ts         Pure fixed-timestep planner (accumulator + alpha)
      gameSimulation.ts    Owns authoritative VehicleState; update(), reset(), interpolated getRenderState()
    simulation/
      vehicle.ts           Pure kinematic bicycle model: stepVehicle(), getDriveDirection()
    input/
      keyBindings.ts       Held-key bindings, action bindings, keysToInput() (pure)
      inputController.ts   THE keyboard system: held keys, action queue, form-control suppression, cleanup
    camera/
      chaseCamera.ts       Pure chase-camera goals (speed-dependent distance) and damped update
    world/
      roadLayout.ts        Pure road geometry data: lanes, lines, shoulders, props, arrows, bounds
    render/                Everything that touches Three.js
      SimRoot.tsx          The single mirror group (scale 1,1,-1) that hosts sim-space objects
      RenderLayer.tsx      Lights + SimRoot content + GameLoopDriver
      GameLoopDriver.tsx   Thin R3F adapter: the ONLY useFrame in the app
      renderLoop.ts        RenderLoop class: actions, pause, simulation step, pose, camera, HUD and diagnostics publishing
      renderSpace.ts       Render helpers for objects outside SimRoot (camera) and bounds conversion
      vehicleLayout.ts     Pure car part layout (nose at +Z, origin at rear axle on the ground)
      VehicleVisual.tsx    Procedural car meshes built from vehicleLayout (replaces the Phase 0 model)
      WorldGeometry.tsx    Ground, road surface, shoulders, edge and double-yellow lines, markers, arrows
      Scenery.tsx          Instanced roadside posts and trees
    state/
      appStore.ts          Zustand: app status, paused flag, HUD values (about 10 Hz)
    ui/
      Hud.tsx              Speed, D/R/N readout, pause status, Pause and Reset buttons, control hints
    diagnostics/           Development-only instrumentation
      diagnosticsStore.ts  Zustand: snapshot, errors, panel visibility
      snapshot.ts          Serializable snapshot builder (includes paused and direction)
      format.ts            Snapshot -> labeled rows (pure)
      visibility.ts        Frustum checks
      errorCapture.ts      Observe-only window error / unhandledrejection capture
      devHooks.ts          window.__STREET_RACER_DEBUG__ read-only API (DEV only)
      DebugPanel.tsx       Overlay; its visibility is toggled by the input controller's debugPanel action
```

Test files live beside their sources as `*.test.ts`.

## 5. Coordinate convention (authoritative)

Simulation and world space (used by simulation, camera math, road data, input, and future AI):

- **+X = right, +Y = up, +Z = forward.** Units: meters. Angles: radians. Time: seconds.
- **Vehicle local forward = +Z**, local right = +X. The vehicle origin is the **rear-axle center on the
  ground**. The visual is built with the nose at +Z, so it needs no rotation fix.
- **Yaw θ** rotates about +Y. θ = 0 faces +Z. **θ increases when turning right.**
  - `forward(θ) = (sin θ, 0, cos θ)`
  - `right(θ)   = (cos θ, 0, -sin θ)`
- **Steering:** D / ArrowRight → steer = +1 (right). A / ArrowLeft → steer = −1 (left).
  Positive steer produces positive yaw rate while moving forward, so the nose moves toward +X.
  While reversing the turn direction flips, as with a real car.
- **Camera:** behind the rear axle along −forward, raised, looking ahead of the vehicle.
- **Spawn:** right lane, x = +1.8 m, z = 0, yaw 0, speed 0.

### Why the render layer mirrors Z

The brief's axes form a **left-handed** frame. Three.js is **right-handed**. Taken literally, a camera
behind a car facing +Z would show the car's right side on the screen's left.

1. Simulation keeps the brief's convention exactly.
2. All sim-space objects live under `SimRoot`, a `<group scale={[1, 1, -1]}>`. This is the **only** mirror.
3. The camera sits outside `SimRoot`. Its free points are converted with `toRenderSpace()` (`z → −z`).

Rules:
- Never apply a Z flip anywhere else. Never add a second mirror group.
- Never fix orientation with camera or input compensation. Fix model orientation in the visual wrapper.
  Steering sign corrections belong only at the vehicle-control boundary.
- Objects inside `SimRoot` use simulation coordinates directly.

## 6. Physics and the vehicle model

- **One authoritative loop.** R3F's `useFrame` (via `GameLoopDriver`) is the only per-frame callback. It calls
  `RenderLoop.tick()`, which:
  1. consumes queued actions (pause, reset, debug panel)
  2. samples held input once for the frame
  3. if not paused, calls `GameSimulation.update(frameSeconds, input)`
  4. writes the interpolated pose to the vehicle object, and updates the camera (frozen while paused)
  5. publishes HUD values (about 10 Hz) and dev diagnostics (about 5 Hz)
- **Fixed timestep:** `FIXED_STEP_SECONDS = 1/60`. Frames are clamped to `MAX_FRAME_SECONDS = 0.25`, and at
  most `MAX_SUBSTEPS_PER_FRAME = 8` steps run per frame. Excess time is dropped and reported as `dropped`.
  Each frame delta is applied once, through the accumulator. It is never multiplied by dt a second time.
- **Interpolation:** rendering uses `lerp(previous, current, alpha)`. Yaw uses the shortest angular path.
- **React never drives simulation.** HUD and diagnostics values are published to stores at low rates.
- **Vehicle model (Part 2):** one movement system, `simulation/vehicle.ts` `stepVehicle()`. No physics engine
  is installed, and no second movement system exists. Tuning lives in `config/vehicleConfig.ts`.
  - **State:** `position` (rear axle, ground plane), `yaw`, signed `speed` (forward), `lateralSpeed` (right is +),
    `steerAngle`, `yawRate`, pedal levels (`throttlePedal`, `brakePedal`, `handbrakeLevel`), `longitudinalAccel`,
    `lateralAccel`, and `wheelSpin`. Plus a separate cosmetic `BodyState`. Velocity is never stored in world space.
  - **Pedals:** the throttle rises at 3.0/s and releases at 5.0/s. The brake rises at 6/s and releases at 8/s. Brake
    overrides throttle when both are held. The handbrake overrides both.
  - **Longitudinal:** engine `a = 9·(1 − v/79.4)·throttle`. Rolling resistance 1.2 m/s² plus aero `0.0002·v²` oppose
    motion. Forward brake is 18 m/s², and it stops exactly at zero. Reverse starts only at standstill with brake held
    (4 m/s², cap 12 m/s). Throttle while reversing brakes at 18 m/s². Hard forward cap 62 m/s. The equilibrium is about
    62 m/s, which the tests verify. The handbrake decelerates at **6 m/s²** (Part 1 used 12; see section 13).
  - **Steering:** the commanded angle is `steer × lerp(0.55, 0.20 rad, |v|/62)`. The front-wheel angle moves toward it at
    2.8 rad/s. Standstill has no rotation.
  - **Yaw:** the kinematic target is `v·tan(δ)/L`, capped at `lateralLimit/max(|v|, 0.5)`. The yaw rate follows that
    target with a first-order lag of 0.12 s (`yawResponseSeconds`). That lag is the effective yaw inertia. There is no
    slip feedback into yaw, so the car cannot spin without steering.
  - **Lateral grip and drift:** `dvLat/dt = clamp(−grip·vLat, ±aLimit) − v·yawRate`. Normal grip is 8 /s and 14 m/s²
    of limit. The drift grip is 1.6 /s and 10 m/s². The reduction is `handbrakeLevel × clamp((|v| − 8)/4, 0, 1)`, so the
    handbrake cannot start a drift below 8 m/s. Handbrake engagement ramps over 0.25 s and releases over 0.5 s. The
    slip is clamped to `|vLat| ≤ |v|·tan(50°)`.
  - **Drift state:** `isDrifting` is true when `|v| > 5`, `|slip| > 6°`, and the handbrake is reducing grip. Ordinary
    full-lock cornering therefore does not light the DRIFT badge.
  - **Integration:** fixed 1/60 s steps. Position uses the midpoint heading with averaged velocities. Each frame delta
    passes through the accumulator once. Angles are wrapped to [−π, π).
  - **Wheel spin:** `spin += avgForward·dt / wheelRadius`. It is driven by distance, not by frame count. Reverse gives
    negative spin.
  - **Body (cosmetic, `simulation/bodyState.ts`):** three damped springs (ω 9 rad/s, ζ 0.7) chase targets derived from
    the accelerations. Pitch target = `−longAccel·0.0025` (positive is nose down). Roll target = `+latAccel·0.0025`
    (positive lifts the right side). Heave target = `−longAccel·0.001` m. Limits are pitch ±2.0°, roll ±2.9°, and
    heave ±0.02 m. The body is stepped in the same fixed loop, but it never writes to the vehicle state.
  - **Render interpolation:** `interpolateVehicleState` and `getRenderBody` blend the last two steps. Angles take the
    shortest arc.
  - Drive direction readout: `drive` above 0.1 m/s forward, `reverse` below −0.1 m/s, `neutral` otherwise. The HUD
    shows D, R, or N only. No RPM and no gear are simulated or displayed.

### Road boundary (Part 3, test circuit only)

- `simulation/roadBoundary.ts` holds the drivable region as a signed distance field (SDF). Negative inside.
- The car footprint is four corners (rear 0.8 m, front 3.7 m, half-width 0.925 m). A corner outside the region is
  pushed out along the numeric SDF gradient (epsilon 0.02 m), for up to 3 iterations, to a clearance of 0.002 m.
- The velocity component along the boundary normal is removed. Tangential speed is kept at 0.999 per contact step
  (`wallTangentialRetentionPerStep`).
- The boundary never adds force. It does not use a physics engine, and there are no custom forces on top of
  physics. There is one movement system (`stepVehicle`).
- The contact flag lives in `GameSimulation`, not in `VehicleState`.
- The guardrails are visual, built from the same SDF samples (|sdf| < 0.01 for rail points, tested).
- Open junctions have no walls across the pad mouth, so the car can pass through them.

## 7. Input

- `input/inputController.ts` is the **only** keyboard system. `attach(window, document)` registers the
  listeners (keydown, keyup, window blur, visibilitychange) and returns a cleanup that removes them all.
  `App` calls it inside a `useEffect`, so StrictMode's double-mount leaves exactly one set of listeners.
- **Held keys** (driving): added on keydown, removed on keyup. Cleared on window blur, and when the document
  becomes hidden. Driving keys call `preventDefault` so the page does not scroll.
- **Actions** (once per press, auto-repeat ignored): queued and consumed by the loop.
- **Form-control suppression:** keystrokes whose target is INPUT, TEXTAREA, SELECT, BUTTON, or
  contenteditable are ignored for driving and actions. The exception is Escape, which still pauses.
  HUD buttons blur after a click, so Space keeps working as the handbrake.
- **Reset** restores simulation state only. Held keys are physical and remain as they are.
- The controller holds no React state. `sample()` and `consumeActions()` are called once per frame.

| Action | Keys / control |
|---|---|
| Throttle | W / ArrowUp |
| Brake / reverse | S / ArrowDown |
| Steer left | A / ArrowLeft |
| Steer right | D / ArrowRight |
| Handbrake | Space |
| Pause / resume | Escape (or the HUD Pause button) |
| Reset | R (or the HUD Reset button) |
| Toggle debug panel (dev only) | Backtick |

## 8. Camera

- Part 3 adds an overview camera (DEV only, `O`) that looks at the whole circuit from a fixed point. Toggling it back
  resets the chase state. The chase camera follows heading and never reads road geometry to correct orientation.
  Road errors are fixed in the road, not by rotating the camera.

- Chase-camera math (`camera/chaseCamera.ts`) is pure and runs in simulation space. Tuning is in
  `config/cameraConfig.ts`.
- **Heading:** the camera has its own heading, which lags the vehicle yaw with a 5 /s damped follow along the
  shortest arc. It never rolls and never reads steering input. The car stays in front of the camera (tests and the
  browser check verify this).
- **Distance behind the rear axle:** 7.5 m at standstill, plus 0.05 m per m/s of speed (capped at +3 m), plus an
  acceleration lag of 0.04 m per m/s² (capped at ±0.8 m, smoothed at 3 /s). Braking brings the camera in.
- **Height** 2.8 m. **Look-at** 12 m ahead along the camera heading, 1.0 m high.
- **FOV:** 62° at standstill, widening linearly to 74° at top speed, eased at 4 /s.
- **Shake:** vertical only. Zero below 60% of top speed, then up to ±0.035 m at top speed. Deterministic, driven by
  camera time, which advances only with dt.
- All smoothing is delta-time corrected. A zero step (paused) freezes everything. The first update, and any update
  after reset, snaps to the goal.
- Camera name `ChaseCamera`. Near 0.1 m, far 3000 m. Fog 180 m to 1500 m.

## 9. Scene and assets

- **No external assets.** Everything is procedural: road, shoulders, markings, ground, car, posts, trees, arrows.
- **Car:** built from `vehicleLayout.ts` with a body, cabin, glass, headlights and tail lights (emissive boxes),
  amber indicator markers (static, not blinking), and four wheels. It is a placeholder, not a real model.
- **Legacy road** (`?world=legacy`, kept as the reference): two lanes of 3.6 m, a double yellow center line, white
  edge lines, 3 m shoulders, distance markers every 100 m (major every 1000 m), and forward arrows on the right
  lane every 120 m. The road runs from z = −100 to z = 4000 m. It has no collider and no boundary.
- **Test circuit road network** (default world, Part 3). Flat, 4 lanes two-way (2 per direction, 3.6 m each,
  14.4 m total), 3 m shoulders, right-hand traffic. Boundary half-width 10.2 m. Spawn on the inner right lane at
  (1.8, 0, 6), yaw 0.
  - Data model in `world/roadTypes.ts`: `RoadSegment` (kinds `straight`, `arc`, `junction`), `RoadPort` (position,
    outward heading, width, elevation), `RoadConnection` (explicit port pair), `RoadNetwork` (segments, connections,
    spawn). Builders are pure and deterministic (`world/roadBuilders.ts`, `world/circuitNetwork.ts`).
  - Validation (`world/roadValidation.ts`): a connection is valid when its ports are within 0.01 m, outward headings
    are opposite (dot ≤ −0.999), and width and elevation match. Dangling ports must be terminal. Mismatches are
    reported with segment ids. Nothing is snapped silently.
  - Geometry (`world/roadGeometry.ts`, `world/roadMeshData.ts`): one mesh build per network. Asphalt ribbons,
    shoulders, markings at y 0.012 with polygon offset (no z-fighting), dashed lane dividers, double yellow center,
    solid edges, direction arrows, stop lines at junction arms, guardrails on the outer shoulder edge, posts every
    6 m, and dead-end cap rails. Built from shared materials. No material per marking.
  - Circuit layout (counter-clockwise rounded rectangle): S1 north on x = 0 from z 0 to 200; T1 left arc (R 60) to
    (−60, 260); S2 west at z 260, split by the junction pad at (−180, 260) into S2a and S2b; T2 to (−360, 200); S3
    south to (−360, 0); T3 to (−300, −60); S4 east to (−60, −60); T4 back to (0, 0). The pad has spurs N (150 m,
    terminal) and S (150 m, terminal). Lane length of the loop is about 1,267 m including the pad.
  - Ground is a finite patch (half-extent 700 m). Static blocks and posts are simple validation props.
  - Edge boundary: a signed-distance union of rectangles (straights), annular sectors (arcs), and boxes (pad). See
    section 6, Road boundary.
- **Props:** instanced roadside posts every 25 m and trees every 60 m, outside the shoulders.
- Planned convention for later phases: `public/assets/{models,textures,audio}/`, loaded through a single loader
  that caches by URL and disposes on unload. Diagnostics currently report `external models: 0`.

## 10. Diagnostics (development only)

- Enabled only when `import.meta.env.DEV` is true. Error capture, dev hooks, and the debug panel are DEV-only.
- `window.__STREET_RACER_DEBUG__` (DEV only) gives read access to the snapshot, errors, HUD values, and pause state.
  It is used by `tools/browser-smoke.py`.
- The debug panel reports renderer status, camera, vehicle state (authoritative sim values), input, handbrake,
  pause and direction, physics and loop counters (including `dropped`), frustum visibility of the vehicle and of
  the road segment around the car, and captured runtime errors.
- The panel's visibility is toggled through the input controller's `debugPanel` action. It has no listener of
  its own.

## 11. Engineering standards

- TypeScript `strict`, plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, and
  `verbatimModuleSyntax`. No `any` (lint-enforced).
- Tuning values live only in `src/config/`. Components do not hardcode gameplay numbers.
- Simulation values use SI units. Convert to display units only at presentation boundaries.
- Simulation modules do not import Three.js or React. Render modules do not own simulation state.
- No circular imports.
- Dispose: R3F disposes JSX-declared geometries and materials on unmount. Manually created geometry is disposed
  in an effect cleanup (the arrow geometry). Input listeners are removed by the function returned from `attach()`.
- Keep `RenderLoop`, which orchestrates the frame, separate from the thin React adapter.
- Road network: data model, builders, validation, and geometry are pure. Meshes and materials are created once.
  No per-frame mesh rebuilds, no material per marking, and every geometry and material is disposed on unmount.
- No physics engine for road collision. Do not add Rapier or custom forces to the same vehicle.
- Layout values that are pure functions of config are computed at module scope. The React Compiler lint rule
  rejects `useMemo` around them.

## 12. Current implementation status

Implemented and verified (see sections 14 and 15):
- Project scaffold, pinned versions, strict TypeScript, ESLint, Vitest, Vite
- Coordinate convention with the documented render-side mirror
- Fixed-timestep simulation with interpolation and a single R3F frame driver
- Part 1: playable driving scene with keyboard controls, pause, reset, chase camera, road, and HUD
- Part 2: vehicle driving quality (see section 6):
  - progressive throttle and brake with pedal ramps, configurable top speed (62 m/s) and reverse limit (12 m/s)
  - speed-dependent steering, with yaw inertia and a lateral-acceleration cap
  - lateral grip with a handbrake drift (start above 8 m/s) and smooth recovery
  - cosmetic body pitch, roll, and heave on a separate pivot
  - wheel spin from distance traveled, and front-wheel steer visuals
  - chase camera with heading lag, acceleration lag, speed FOV, speed shake, and safe reset
  - HUD: arc gauge, km/h and mph (one conversion function), D/R/N, DRIFT badge
  - central typed tuning, plus a debug snapshot with slip, body, and wheel telemetry (dev only)

- Part 3: road network on the test circuit (see section 9):
  - typed road data model (segments, ports, connections, network), deterministic builders
  - programmatic connection validation; mismatches are reported by segment id, never snapped
  - segment kinds: straight, arc, junction (pad with two terminal spurs)
  - markings and stop lines from the same centerline samples, with polygon offset
  - custom SDF boundary with footprint push-out and no added forces; guardrails on the outer shoulder edge
  - pure pursuit driver used in node tests to drive the full loop
  - DEV-only overview camera (`O`) and road debug view (`G`): centerlines, segment ids, ports, lane lines,
    collision rails, junction outlines, connection errors in red. Neither changes geometry or behaviour.
  - legacy straight road kept behind `?world=legacy`

Not implemented (do not describe as done):
- Road constraints on the legacy straight road. It has no boundary. The car can leave it, as before.
- Physics engine (Rapier). Not installed, and not needed for the custom model.
- Traffic, police AI, AI opponents, a city, career, progression, missions, vehicle purchasing
- Drift scoring, race events, and the open-world city (explicitly out of scope for Parts 2 and 3)
- Menus beyond the HUD buttons; audio; persistent data (save, settings)
- External assets, an asset loader, and real vehicle models
- Blinking indicators and real light sources
- GSAP presentation work; mobile or touch input

## 13. Known issues

- **Steering does nothing at standstill** (by design: speed-sensitive steering). A car that is not moving cannot be
  turned in place. This is a gameplay decision to confirm.
- **Handbrake deceleration changed in Part 2** from 12 to 6 m/s², so drifts are viable. It still stops the car from
  low speed and still blocks reverse creep at standstill.
- **Speed readout overlaps the gauge (Part 2, not fixed).** The "km/h" unit and the mph line sit over the ends of the arc gauge at the
  default size. Cosmetic. Not yet fixed.
- **Wheel-steer and wheel-spin visuals are verified by unit tests only.** The rig math is tested in Three.js
  (`render/vehicleRig.test.ts`). The browser check confirms the telemetry, but the wheel angles were not visually
  inspected at chase distance.
- **Tire model is a placeholder.** Grip is linear with a saturating force limit, and the tuning is not measured
  data. The single-track model has no load transfer. Body roll and pitch are cosmetic only.
- **Mass is not a parameter.** Accelerations are specified in m/s², so mass would cancel. Yaw inertia is the yaw
  response lag (0.12 s) instead.
- **Vehicle leaves the road (legacy road only).** `?world=legacy` has no boundary, by design: it is the reference.
- **Keyboard lap lane tracking is about 3 m.** The browser lap uses binary keys at about 20 fps (800×475). Peak lane
  error was 2.85 m and 2.96 m over two runs, against a 3.0 m limit. The node drivers hold the road to 1.1 m (analog)
  and 1.44 m (binary). The gap is the control rate of the test driver, not the road: no contact, no stall, and
  control kept through the junction. Smoother steering needs analog input, which the keyboard does not provide.
- **Brake-pedal release roll-back.** Releasing S and Space together lets the car roll back about 0.1 m/s while the
  brake pedal ramp finishes. The handbrake check reads speed while both keys are held, which is what the check
  names. Not fixed.
- **Overview panel label.** With the overview camera on, the debug panel's "camera mode" reads `overview`, but
  "active" still reads `ChaseCamera` (the sim camera, which keeps running). Cosmetic.
- **Dev names remain in the production bundle as dead code.** `toggleRoadDebug`, `roadDebugVisible`, `togglePanel`,
  `panelVisible`, and `vehicleInFrustum` appear in `dist/`. The overlay and panel UI are not emitted (no
  `__STREET_RACER_DEBUG__`, `DEV DIAGNOSTICS`, or road overlay code). These names were already in the Part 2 bundle.
  Pre-existing.
- **Junction visuals.** Stop lines, the pad, and arrows were checked in the chase-camera and overview screenshots.
  They were not checked at close range in a browser.
- **Spawn marker.** A distance marker sits on z = 0, under the spawn position, so it appears beneath the car at launch.
- **Simulated time falls behind wall time on slow renderers.** The software WebGL used in this sandbox runs at about
  5 fps, and the substep cap then drops simulated time (the debug panel showed about 0.7 s dropped). On real GPUs
  this should not occur. Do not remove the cap.
- **Frustum visibility is coarse.** The road check uses a 220 m segment around the car, not the whole road.
  The vehicle check is an AABB test with no occlusion.
- **Debug panel CSS ships in the production stylesheet.** The panel's JavaScript and strings are absent from
  the production bundle, but its `.debug-panel` rules remain in the CSS. Harmless; move them if the CSS needs trimming.
- **Bundle size warning.** The main chunk is about 1.19 MB (about 328 kB gzipped), mostly Three.js. Code-splitting
  the renderer is a later optimization.
- **Third-party warning.** R3F 9.8.2 uses `THREE.Clock`, which Three.js r186 marks deprecated. Not project code.
- **Instanced mesh disposal.** `InstancedSet` calls `dispose()` on unmount. This has been checked by mounting and
  rendering in dev mode (including StrictMode) but not by a dedicated unmount test.

## 14. Tests that must pass

Run `npm test`. Currently **257 tests across 22 files**. Part 3 added these:

- `world/roadGeometry.test.ts`, `world/roadValidation.test.ts`: geometry, port matching, and mismatch reports
- `world/roadMeshData.test.ts`: buffers, stop lines, arrows, marking alignment, and containment of arm end caps
- `world/roadDebugData.test.ts`: labels, layers, zero issues on the circuit, and a red line for a moved port
- `world/worlds.test.ts`: `parseWorldId`, circuit and legacy definitions, and caching
- `world/roadLayout.test.ts` (Part 1/2, legacy road, unchanged)
- `simulation/roadBoundary.test.ts`: SDF sign, push-out, velocity constraint, and no added forces (19 tests)
- `engine/gameSimulation.test.ts`: spawn, boundary, and contact accessors
- `engine/circuitDrive.test.ts`: pure-pursuit lap, analog and binary, no NaN, no teleport, all loop segments visited,
  junction control, no contact on the reference line, and cross-track under 1.5 m, plus the dead-end stop test
- `engine/circuitCamera.test.ts`: 9 tests over the full lap (car ahead, distance and height bounds, no snap,
  heading lag under 10°, look-at on road over 95% of samples, FOV step)
- `input/keyBindings.test.ts`: KeyG (roadDebug) and KeyO (overview)

Part 1/2 tests (for reference):

- `core/coordinates.test.ts`: forward/right convention, toRenderSpace
- `core/math.test.ts`: clamp, moveTowards, wrapAngle, shortest angle, damping
- `core/units.test.ts`: m/s to km/h and mph, and the sign of reverse speed
- `render/renderSpace.test.ts`: real Three.js math for the mirror. Screen-right matches simulation-right. The SimRoot
  mirror places the nose and right side correctly. Bounds flip correctly.
- `render/vehicleLayout.test.ts`: nose at +Z, tail at −Z, right at +X, wheels on the ground at the axles, body above
  the ground, symmetry, front/rear axle tags, and the body pivot position
- `render/vehicleRig.test.ts`: rig resolution, steering on front wheels only, spin direction (forward), steer
  direction (right), pitch and roll signs, body and suspension kept off the root, and no accumulation over frames
- `simulation/vehicle.test.ts`: pedal ramps, progressive acceleration, top speed equilibrium and hard cap, brake
  without overshoot, reverse only when braking at standstill, reverse cap, brake over throttle, coasting, handbrake
  deceleration and reverse block, grip gating below 8 m/s, **drift start, steering authority during drift, recovery
  under 1.5° after release, slip limit**, no false DRIFT in ordinary cornering, wheel spin from distance, **steering-sign
  tests (rolling W+A and W+D)**, speed-sensitive steering, lateral cap, determinism, no mutation, seam interpolation
- `simulation/bodyState.test.ts`: dive under braking, lift under acceleration, right-side lift in a right turn, settling
  to level, limits, determinism, zero dt
- `engine/fixedStep.test.ts`, `engine/gameSimulation.test.ts`: step planning, frame-rate independence, interpolation,
  reset, **one movement system (the loop matches a plain stepVehicle chain)**, body separate from the vehicle
- `input/keyBindings.test.ts`, `input/inputController.test.ts`: held keys, actions, form-control suppression, cleanup
- `camera/chaseCamera.test.ts`: goals, snapping, convergence, pause freeze, reset, heading lag (including the ±π seam),
  the car staying in front of the camera through a sustained turn, acceleration lag, FOV, and shake bounds
- `world/roadLayout.test.ts`: lanes, double yellow line, edge lines, shoulders, markers, arrows, road and segment bounds

Any change to conventions must update the mirror tests and this document together.

## 15. Commands and verification

Run from the project root (`/home/user/street-racer`):

| Command | Purpose |
|---|---|
| `npm install` | Install pinned dependencies |
| `npm run dev` | Dev server on 0.0.0.0:5173 (live preview) |
| `npm test` | Vitest, single run |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint over the whole project |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the built app on 0.0.0.0:4173 |
| `npm run check` | typecheck, lint, test, build in sequence |
| `python3 tools/browser-smoke.py [url] [outdir]` | Part 1/2 browser checks against a running dev server (needs Playwright). Use `?world=legacy`. |
| `python3 tools/browser-road.py [url] [outdir]` | Part 3 browser checks: boot, drive, steer sign, overlay, overview, boundary, reset, and one keyboard lap on the circuit |

Node 20.19+ or 22.12+ is required (Vite 8).

Verification in Part 3 (run in this sandbox, not on a real GPU):
- `npm run check`: typecheck, lint, **257 tests in 22 files**, and production build all pass.
- Production build: one chunk, `index-C73jxONh.js`, 1,188.50 kB (328 kB gzip). The `chunkSizeWarningLimit` warning is
  pre-existing. No debug strings in the bundle (see section 13 for the dead names).
- Production preview (`vite preview`, port 4173): circuit and legacy load with no page errors and no failed requests.
  Console shows only the known three.js and GL driver messages.
- `tools/browser-road.py` against the dev server: **25 of 25 checks passed** (the lap's lane check is 3.0 m; see
  section 13).
- `tools/browser-smoke.py?world=legacy`: **60 of 60 checks passed**. The handbrake check now reads speed while S and
  Space are held (see section 13).
- Node: the analog lap has a maximum cross-track of 1.11 m and the binary lap 1.44 m, both with zero contact steps.
- Screenshots and reports: `/home/user/verification/part3/` (`report.json`, `lap_trace.json`, `legacy/`, `prod/`).

Verification in Part 2 (run in the live dev server, with the browser check):
- `npm run check`: typecheck, lint, **177 tests in 14 files**, and production build all pass.
- Production build: one JavaScript chunk of 1.16 MB (320 kB gzip), with the same chunk-size warning as Part 1. No
  `__STREET_RACER_DEBUG__` or `DEV DIAGNOSTICS` strings in the bundle.
- `tools/browser-smoke.py` against the dev server: **60 of 60 checks passed**. These are the 40 Part 1 checks, plus 20
  Part 2 checks: HUD telemetry (no RPM or gear, gauge, km/h and mph), camera snap on reset, pedal ramp and top-speed
  cap, wheel spin equal to distance/radius (0.000° difference), body dive and lift, FOV widening, car ahead of the
  camera through a turn, camera heading lag, drift start (slip over 6°, DRIFT badge, snapshot flag), drift recovery
  (under 1.5°), and mph consistency. Screenshots and the JSON report are in `/home/user/verification/part2/`.
- Steering sign in Part 2: A gave a heading change of −36.3° and dx −8.4 m. D gave +46.3° and dx +5.8 m. Values
  vary with frame timing.
- Drift sample: slip −12.5° at 13.5 m/s, then −0.53° after release.

Browser tooling note: Playwright and Chromium were installed in this sandbox. They are not part of the project's
dependencies. The Chromium cache is not kept across sandbox restores, so run `python3 -m playwright install chromium`
first.

## 16. Rules for future development prompts

1. Read this document first. Verify the state against the code before trusting it.
2. Do not change the coordinate convention without updating section 5, the mirror tests, and `coordinates.ts`.
3. Never add a second render mirror. Never add a second `useFrame` loop. Put per-frame work in `RenderLoop`.
4. Never add a second keyboard listener. All keyboard input goes through `InputController`.
5. Simulation modules stay free of React and Three.js. Config values go in `src/config/`.
6. React state is for low-frequency values only (at most about 10 Hz). Never store per-frame simulation data in Zustand.
7. Do not swallow errors: no empty catch blocks, no `any`, no disabled type checks.
8. Add a Rapier or GSAP dependency only in the phase that uses it, and record the exact version here.
9. Mark items as done only after the tests pass and the behavior is verified in the running app.
10. Update sections 12 (status), 13 (known issues), and 14 (tests) at the end of every phase.
11. Road connections are explicit port pairs and must pass validation. Never snap incompatible segments silently.
12. Do not compensate for road orientation errors with the camera or the input. Fix the road or the controller.
