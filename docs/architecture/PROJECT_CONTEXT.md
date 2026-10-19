# PROJECT_CONTEXT.md

Living document. Update it at the end of every development phase.

## 1. Project objective

A browser-based 3D open-world street racing game inspired by Need for Speed: Most Wanted (2005).
The goal of the whole project is a stable, extensible foundation for later phases: vehicle handling,
world content, traffic, police AI, progression, UI, audio, and presentation.

**Current state: Parts 1–11 are implemented. Part 11 (release readiness) is complete with the evidence and open items in section 24.** The game has driving (Parts 1–3), a connected road network with a test circuit (default `/` is the city; `?world=circuit` is the regression circuit; `?world=legacy` is the reference road), traffic and AI with collisions (Part 4), a connected fictional city with five districts (Part 5), Sprint and Circuit races (Part 6), a witnessed-offence police pursuit (Part 7), a garage with purchases, upgrades, and paint (Part 8, section 21), a career with one rival chain and a reputation (Part 9, section 22), and presentation with time of day, rain, tire smoke, synthesized audio, and quality presets (Part 10, section 23). Saves are one versioned localStorage file (section 21 and 24). There is no multiplayer, no accounts, no cloud save, and no touch input. Parts 4 to 11 are not yet committed to git (HEAD is Part 3, `aade3ab`; commit scope is the developer's decision).

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
      Hud.tsx              Speed, D/R/N readout, pause status, Pause and Reset buttons, an Info button that lists the controls
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
    overrides throttle when both are held. The handbrake does not cancel throttle: with handbrake and throttle held,
    engine force works against the handbrake deceleration, so the car can hold a slide. It never reverses.
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
  - **Power oversteer:** `computePowerOversteer` adds grip loss from throttle while steering at speed. It is
    `throttle × min(|steer|/steerAngleHighSpeedRadians, 1) × speedGate × powerOversteerGripLoss` (0.5, shared
    `VEHICLE_CONFIG` key, same for all cars; 0 disables it). The grip loss is the larger of the handbrake term and this
    term. Measured with full steer and full throttle, slip rises from 6.8° to 9.0° at 12 m/s and from 4.5° to 6.1° at
    20 m/s, compared with `powerOversteerGripLoss = 0`. Those are whole-run maxima, and the car stays controllable.
  - **Drift state:** `isDrifting` is true when `|v| > 5`, `|slip| > 6°`, and either the handbrake or power oversteer is
    reducing grip. Hard full-lock cornering on throttle at speed can therefore light the DRIFT badge. Coasting at full
    lock does not.
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

Part 4 (traffic, collisions, opponent AI) is documented in section 17. Part 5 (open-world city) is documented in section 18. Part 6 (racing) is documented in section 19. Part 7 (police pursuit) is documented in section 20. Sections 9 and 11 to 15 predate Part 3 to Part 7 and need a separate refresh.


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

- Part 4: traffic vehicles, spawning, collisions, and opponent AI on the shared vehicle controller (section 17)
- Part 5: connected fictional city with five districts, world bounds recovery, minimap (section 18)
- Part 6: Sprint and Circuit races with ordered checkpoints, a six-racer field (five rivals and the player), provisional rewards (section 19; open items in 19.11; the current rules are in 19.13)
- Part 7: police pursuit: state machine, witnessed triggers, five heat levels, road-graph routing, search, escape, cooldown, capture (BUSTED), HUD, DEV diagnostics (section 20; open items in 20.11)
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

Parts 8 to 11 are implemented: the garage (21), the career (22), presentation and quality settings (23), and release
readiness, with the release README and the static-hosting configuration (24).

Not implemented (do not describe as done):
- Road constraints on the legacy straight road. It has no boundary. The car can leave it, as before.
- Physics engine (Rapier). Not installed, and not needed for the custom model.
- Drift scoring (explicitly out of scope for Parts 2 and 3).
- Police: roadblocks and spike strips (deferred, section 20.11), blacklist, career heat, dispatch, and multiplayer.
- Selling vehicles. Touch or mobile input. Shadow maps and blob or contact shadows (deferred, section 23).
- Rain has no effect on grip (a documented limitation, section 23).
- External assets, an asset loader, and real vehicle models. GSAP. Accounts, cloud saves, and any backend.
- An on-screen volume control (the setting is stored, section 21 and 24).

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

Run `npm test`. At the Part 11 release check: **880 tests across 79 files, all passing** (recorded in section 24). The list below is the Part 1 to Part 3 set, kept for reference. Parts 4 to 11 add tests in their own sections, and the save, audio, input, and presentation tests are listed there.

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

## 17. Traffic, collisions, and opponent AI (Part 4)

Status: implemented on the circuit world. Traffic is on by default and off with `?traffic=off`. The legacy world has
no traffic and no opponents. Browser verification: `tools/browser-traffic.py`, outputs in `/home/user/verification/part4/`.

### 17.1 Config (the only home for numbers)
- `src/config/trafficConfig.ts` (`TRAFFIC_CONFIG`): pool capacity, spawn cadence, IDM, collision (`separationMarginMeters`
  0.05, `maxPlayerPushPerStepMeters` 0.5, `eventLogCapacity`), obstacle (`stoppedSpeedMps` 0.3,
  `corridorHalfWidthMeters` 2.2, `stallRecycleSeconds` 20).
- `src/config/aiConfig.ts` (`AI_CONFIG`): look-ahead (4 m + 0.45 s per m/s), curve lateral accel 3.2 m/s², sensing 45 m,
  obstacle corridor half width 2.0 m, stop gap 6 m, obstacle brake 3 m/s², recover at 1.2 m lateral, lost at 4 m,
  hold throttle 0.3, speed deadband 0.3 m/s, `recycleClearanceMeters` 60.

### 17.2 Vehicle types (`src/traffic/trafficTypes.ts`)
Four types: COMPACT, SEDAN, SUV, VAN. Local forward is +Z for all of them. Each type has a body, a cabin, a roof, trim,
wheels, lamps, and a collision box from `trafficDimensions`. The render test checks that rendered bounds equal the
collision dimensions (width, rear-to-nose length, roof height, wheel positions). Geometry and materials are shared per
type through `createTrafficModelFactory`. Nothing is created per vehicle.

### 17.3 Lane graph and routing
`src/traffic/laneGraph.ts` builds a directed lane graph from the road network. Vehicles are lane-locked (a lane id and an
arc length `s`), so they cannot leave the road graph. Routing is deterministic and follows the successor order.
Lane changing is not implemented.

### 17.4 Traffic population and spawning
- `TrafficSystem` (`src/traffic/trafficSystem.ts`) owns a fixed pool of `TrafficVehicle` records (capacity 12). Vehicles
  are reused. Recycling resets a vehicle completely. The pool size never changes.
- A spawn request names segment/lane, `s`, speed, type, and cruise speed (`trafficScenarios.ts`).
- Spawn validation (`TrafficSystem.spawn`) returns a reason for each rejection: `unknown-lane`, `connector-lane`,
  `lane-end`, `no-free-slot`, `overlap-vehicle`, `overlap-player`, `visible-ahead` (inside the player's view cone, which
  is independent of the camera), `too-close-ahead` and `too-close-behind` (speed-dependent gaps), `outside-road`,
  `junction-occupied`, `traffic-gap-ahead` and `traffic-gap-behind`. A rejected request is postponed and retried by
  `trafficSpawner.ts` every 0.5 s. It is never forced. Counts are in `stats.rejections` and in the DEV panel.
- Stall rule: a traffic vehicle stopped for `stallRecycleSeconds` is recycled. Far vehicles are recycled too.

### 17.5 Collision model (one system, no physics engine)
- All collision is custom and ground-plane: oriented boxes (`src/simulation/obb.ts`, SAT), a uniform-grid broad phase
  (`spatialHash.ts`), and push-out only. Correction removes the normal approach velocity and pushes the bodies apart.
  No forces are added. Nothing else steers or moves the car.
- Pairs: player–traffic, traffic–traffic, opponent–traffic, opponent–player, vehicle–boundary, and vehicle–guardrail.
  The boundary is the road/shoulder union in `src/simulation/roadBoundary.ts`, applied by `constrainVehicleToRoad` to the
  player and to every opponent.
- Each event is recorded once through `ContactLog` (`src/traffic/contactLog.ts`). A continuing contact counts once and
  ends after a step with no overlap. Contact counts are merged into the snapshot.
- Fixed-step order (`src/engine/gameSimulation.ts`): player move and road constraint, traffic spawn and step, opponents
  decide and integrate, player–traffic contact, opponent–traffic and opponent–player contact (each with the road
  constraint afterwards), then `endContactStep` for both logs.
- Player–opponent overlap is split evenly: each body takes half of the depth, capped at 0.5 m per step.
- Traffic–traffic correction subtracts a 0.05 m separation margin. Without it, SAT reports exact contact as overlapping.

### 17.6 Opponent AI interface (`src/ai/aiController.ts`, `src/ai/aiOpponents.ts`)
- `AiDriver.decide(state, obstacles)` returns `AiDecision`: `input` (`steer`, `throttle`, `brake`, `handbrake: 0`, the
  same fields as the player), `state` (`follow` | `brake` | `recover` | `lost`), `laneId`, `s`, `lateralErrorMeters`,
  `targetSpeedMps`, `target` (route point), `obstacleGapMeters`.
- Path following is pure pursuit on the lane graph with speed-based look-ahead. Steering uses `computeMaxSteerAngle`.
  The speed target is the minimum of the lane limit, a curve limit (`sqrt(a_lat / κ)` over 45 m), and an obstacle gap
  limit measured from the nose.
- Standstill rule: at a zero target below 0.5 m/s, both pedals are released. The vehicle model engages reverse when
  the brake is held at standstill, so the AI must not hold it there.
- Opponents are `OpponentSystem` entries. Each one is a driven car with its own state and footprint, integrated by the
  same `stepVehicle` as the player. Only the input source differs. Opponents do not use the keyboard controller.
- Opponent stall recycle: an opponent stopped and holding for 20 s is returned to its spawn, if the spawn is clear of
  other bodies and at least 60 m from the player. If the spawn is blocked, the recycle waits. This stops permanent
  queues behind a stationary player.
- Not implemented: racing, overtaking, rubber-banding, race positions, police, lane changes, per-type handling.

### 17.7 Rendering and diagnostics
- `TrafficVisualPool` (`src/render/trafficVisuals.ts`) syncs views (`VisualVehicle`) to shared model groups. Traffic and
  opponents each have their own pool, sized to their vehicle count. Each frame copies state. It never builds meshes.
- DEV only: the DEV panel shows a "Traffic and AI" section with active counts, pool, opponent count and recycles, spawn
  stats, rejection reasons, contact totals, and one row per vehicle (type, segment, lane, speed/target, gap, AI state).
  Updated for the release build: the panel is hidden by default in every build. Shift + ` opens and closes it. Plain backtick does nothing.

### 17.8 Tests (Part 4 A to H)
- A single vehicle: `src/ai/aiController.test.ts` (opponent drives the loop, recovery, stop, determinism, steering bounds,
  no reverse at standstill, stall recycle, blocked spawn), `src/traffic/trafficSystem.test.ts`.
- B multiple vehicles: `src/traffic/trafficSystem.test.ts`, `src/traffic/trafficCollision.test.ts` (11 tests),
  `src/traffic/laneGraph.test.ts`.
- C player interaction: `src/engine/opponentContact.test.ts` (symmetric push, one event), `trafficCollision.test.ts`.
- D curves and junctions: opponent lap in `aiController.test.ts` (S1 → T1 → S2a → J1 → S2b → T2 → S3 → T3 → S4 → T4).
- E AI control: `aiController.test.ts`.
- F stress and recycling: `src/engine/trafficStress.test.ts` (three simulated minutes, pools fixed, recycling, finite).
- G regression: the existing Part 1–3 tests in `src/engine/*.test.ts` and `src/render/trafficModel.test.ts`.
- H production build and browser run: `tools/browser-traffic.py` (see 17.9).

### 17.9 Results (last run, Part 5 round)
- `npx tsc --noEmit -p .`: pass. `npx eslint .`: pass. `npx vitest run`: 378/378 passing, 36 files.
- `npm run build`: pass, with the existing chunk-size warning (pre-existing; not changed).
- `tools/browser-traffic.py` against the DEV server (circuit): 20/20 checks passed. The legacy check had a harness bug
  (it appended `?world=legacy` to a URL that already had a query), fixed in the script. Report:
  `/home/user/verification/part4/report.json`.

### 17.10 Known limitations
- Player–traffic and player–opponent crashes are covered by unit tests. The browser run did not crash the player on purpose.
- Visual check of the traffic models was done at overview zoom only. Close-up model inspection is still to do.
- The DEV panel shows contact totals, not per-vehicle collision state.
- Opponents use the player's handling config (`VEHICLE_CONFIG`). Per-type handling is not implemented.
- Opponent recycling teleports the car between two spawn points. Its visibility check is the clearance distance only.
  The spawn is not checked against the camera view.

### 17.x Reset versus traffic (decided in the Part 6 phase)

R now clears AI traffic and restores the scenario's spawn requests (`GameSimulation.resetTraffic`), after the player is
placed at the spawn pose. Without this, an AI car already on the road could drive into the player on the first frames
after R. The browser check showed a `player-traffic` contact within 300 ms of R. Race opponents are unaffected: R is
refused for the whole race (19.9), and opponents are detached when the attempt ends. Part 5 had decided the opposite (R
player-only), and that decision is revised in 18.

## 18. Open-world city (Part 5)

Scope: one explorable fictional city on the existing road model. No race events, police, career, or vehicle purchase.
Selected with the default URL. `?world=circuit` and `?world=legacy` remain as regression worlds.

### 18.1 Layout (`src/world/city/cityLayout.ts`, source of truth)
- 5 × 5 grid of junction nodes at 200 m spacing, at x and z in {-400, -200, 0, 200, 400}.
- Segment ids: `H-i-j` (east-west street), `V-i-j` (north-south street), `J-i-j` (junction pad). Lane ids use the colon
  form, e.g. `H-0-2:F:0`. The ids have no colons, so they stay valid as segment keys.
- Totals (`cityNetwork.ts`): 65 segments (25 junctions, 40 streets), 80 connections, 536 lanes (160 street lanes,
  376 connectors). Validated with zero issues.
- Districts are labels on 2 × 2 cells of the grid, not separate graphs. The four districts are downtown, industrial,
  residential, and commercial. The east column of vertical streets `V-4-j` is the highway (higher speed limit).
- Spawn: eastbound inner right lane of `H-1-2`, at (-100, -1.8), yaw π/2 (`CITY_SPAWN`). Normal reset (R) returns here.
- Explicit DEV reset pose: eastbound inner lane of `H-2-2`, at (100, -1.8), yaw π/2 (`CITY_DEV_RESET`). Used only by the
  DEV action Y.
- Turns use quadratic Bézier connectors. A lane keeps its index through junctions, so traffic stays in lane.

### 18.2 Graph validation (`src/world/city/cityValidation.ts`)
- Covers: duplicate ids (early return), missing or disconnected intended roads, invalid widths, zero-length segments,
  bad junction positions, abrupt heading changes, missing collision or surface, invalid lane directions.
- Every issue names its segment id. Connectivity is checked per lane-index class, because lanes never change index.
- Negative cases and district connectivity: `src/world/city/cityNetwork.test.ts` (21 tests).

### 18.3 Assets (procedural only, no remote files)
- Scenery data: `src/world/city/cityScenery.ts`, seed `0x5eed`, deterministic. Buildings on a 26 m lattice with 25 %
  skipped, slabs, street lamps 40 m apart at 11.6 m offset, trees (up to 8 residential and 2 downtown per cell), highway
  signs, and landmarks (a 120 m tower with spire, a crane, a water tower).
- Rendering: `src/render/cityInstances.ts` and `src/render/CityScenery.tsx`. Four shared unit meshes (box, cylinder, cone,
  sphere), per-instance colour, no per-prop material. Mounted in `RenderLayer` for city worlds only.
- Tests: `src/world/city/cityScenery.test.ts` (11 tests). No footprint overlaps another, every footprint sits in its cell
  with edge clearance, all buildings are outside the drivable boundary by the scenery gap, lamps and signs are off the road.

### 18.4 Collision geometry, kept separate
- Visual geometry: scenery, road surface, and markings. Not collided with.
- Road collision: the roadside boundary (`src/simulation/roadBoundary.ts`), which holds cars on the drivable area. Its
  guardrails sit on the outer edges only. No wall crosses a valid junction.
- Building collision: none. Buildings sit outside the drivable region with a 3 m clearance check.
- Surface continuity at junctions is checked by the junction-pad drivable tests in `cityNetwork.test.ts`.

### 18.5 World bounds and recovery (`src/world/worldRecovery.ts`, `WORLD_RECOVERY` in `src/config/worldConfig.ts`)
- Outside the world bounds is detected on the integrated state, before the road constraint can pull the car back. Recovery
  is immediate.
- Off-road: the car's centre is outside every drivable shape for `offRoadSeconds` (2 s).
- Stuck: stopped (below 0.5 m/s) with part of the footprint off the surface for `stuckSeconds` (20 s). A car pinned on the
  road is not stuck, since it can reverse out.
- Recovery relocates the car to the nearest segment lane centre, with the lane heading and zero speed. It runs through the
  normal road constraint. Only segment lanes are used, never connectors. It is counted in `road.recoveryCount` and shown in
  the DEV panel. Ordinary driving never triggers it.
- Explicit DEV reset: key Y, DEV builds only, moves the car to the world's `devReset` pose.
- Tests: `src/world/worldRecovery.test.ts` (13 tests, monitor rules, footprint corners, recovery pose, DEV pose) and
  `src/engine/recoverySimulation.test.ts` (5 tests on the real city boundary: no recovery when parked or driving, no
  recovery for a car pinned against the boundary, automatic recovery from outside the bounds, DEV reset).

### 18.6 Traffic in the city
- Scenario requests: `CITY_TRAFFIC_SCENARIO` in `src/traffic/trafficScenarios.ts`. Sustained traffic comes from the ambient
  generator (`src/traffic/trafficAmbient.ts`, `ambient` block in `src/config/trafficConfig.ts`: target 8, pool 12, seed
  `CITY_AMBIENT_SEED`). Spawns are 120 to 300 m from the player, never ahead of it, and at lane ends only with a 15 m margin.
- No city opponent AI (`CITY_OPPONENT_SPECS` is intentionally absent). Opponents are race-style AI in the circuit, and race
  events are out of scope for Part 5. The city's ambient traffic is the AI population.
- Reset decision (revised in the Part 6 phase): R resets the player and clears AI traffic, then restores the scenario's
  spawn requests. The earlier rule (R resets the player only) let a traffic car drive into the car at its reset pose on
  the first frames after R. Measured in `tools/browser-road.py`: `player-traffic` contacts 0 → 1 within 300 ms of R. The
  spawner's own rules keep new traffic away from the player. DEV key T still clears traffic on its own.
  R is refused during a race (see 19.9), so the clear never touches race opponents.
- Tests: `src/traffic/cityTraffic.test.ts` (7 tests, route-driven across all districts and the highway, bounded
  population, no teleport, no permanent stall, determinism) and `src/traffic/trafficAmbient.test.ts` (5 tests).

### 18.7 Minimap (`src/ui/minimapModel.ts`, `src/ui/Minimap.tsx`, `src/ui/minimapPose.ts`)
- Data source: the logical road graph (`buildMinimapModel(network)`), not the rendered meshes. Fixed scale, north (+Z) up.
- Static layer (districts, streets, junctions, landmarks) is drawn once to an offscreen canvas. Each frame only blits it
  and draws the player marker.
- The marker pose goes through `minimapPose.ts`, a plain mutable object written by the render loop. It is not in
  `HudState`, so the marker causes no React work.
- Tests: `src/ui/minimapModel.test.ts` (5 tests: every street and junction drawn, district tiles cover the city with no
  overlap, points inside the canvas, fixed scale with north up, spawn marker on the spawn street).

### 18.8 Performance and resource use
- Instancing: four shared meshes for all scenery. Traffic uses the Part 4 bounded pool (capacity 12 in the city).
- Observed in the DEV panel (not a profile): about 35 to 37 draw calls and 124k to 127k triangles at the spawn and the
  east edge.
- No streaming or chunking. The city is about 820 m square with 65 segments, which fits in memory without it.
- Resource growth: traffic meshes and colliders come from the bounded pool and are reused (test F in section 17.8). Scenery
  instances are built once from fixed data.

### 18.9 World registry (`src/world/worlds.ts`)
- `WorldDefinition` gained `devReset` (explicit DEV pose, or null). The city world sets `CITY_DEV_RESET`. The circuit uses
  its spawn. Legacy sets null.
- `GameSimulation` options: `recoveryLanes` (driving lanes for recovery) and `devReset`.

### 18.10 Tests and browser runs (last run)
- Unit: `npx vitest run` 378/378 across 36 files. Part 5 tests: `cityNetwork` 21, `cityScenery` 11, `cityTraffic` 7,
  `trafficAmbient` 5, `minimapModel` 5, `worlds` 3, `worldRecovery` 13, `recoverySimulation` 5.
- `npx tsc --noEmit -p .` and `npx eslint .`: pass.
- `npm run build`: pass, with the existing chunk-size warning (one 1.25 MB chunk, gzip 348 kB; not split).
- `tools/browser-city.py` (DEV server, default city URL): 24/24. Covers boot, connection validation, spawn pose and facing,
  minimap drawing and marker movement, driving with no teleport and lane band, junction traversal J-2-2 and J-3-2, east
  edge barrier, ambient traffic across districts and the highway, no traffic-boundary contact, reset, no false recovery,
  DEV key Y, no errors, no failed asset requests. Report: `/home/user/verification/part5/report.json`.
- `tools/browser-prod.py` (`vite preview`, production build): 7/7. Boot, minimap, drive, reset, no errors, no failed asset
  requests. Report: `/home/user/verification/part5_prod/report.json`.
- Regression: `tools/browser-traffic.py` 20/20 (circuit traffic and legacy, rerun after the R change). `tools/browser-smoke.py`
  60/60 (Parts 1 and 2, legacy; rerun after the R change). `tools/browser-road.py` 24/25 on the latest run (circuit, Part 3, see 18.11).
  `tools/browser-city.py` 24/24. `tools/browser-prod.py` (production preview) 7/7.

### 18.11 Known limitations and open items
- `tools/browser-road.py` latest run: 24/25. (a) The reset check now passes. Its cause was traffic, not the reset: a
  traffic car was active on the road and drove into the player after R (see the reset decision above). Earlier failures
  of this check (x = 3.7 in one run) probably had the same cause, but that run was not traced. (b) "stays within 3.0 m of
  the driving lane" still fails by a small margin (3.05 m in the latest run; 2.55 m, 3.03 m, 3.60 m and 4.66 m in earlier
  runs). The driver is a keyboard-style pure-pursuit bot with binary steering, and its error depends on the run. This is a
  limit on the test driver, not a measured product fault. Options, for a decision: tune the driver's speed envelope on the
  arcs, or change the limit with a stated reason. The limit was not changed to force a pass. Part 3 is not closed on that basis.
- The stuck recovery rule is covered by unit tests only. A wedged car was not produced in the browser.
- Highway traffic appears only when the player is within 300 m of it (the highway is 400 m east of the centre). The
  browser check confirms this from the east edge.
- Bridges, elevation, and flyovers are not implemented (out of scope; the graph is flat).
- Visual review covered the boot and east-edge screenshots. Close-up inspection of individual props and landmarks is not
  done.
- In DEV builds the diagnostics panel overlaps the minimap. Production has no panel.
- Performance is measured only as draw calls and triangles from the DEV panel. No frame-time profile was taken, and no
  separate city stress test exists beyond `cityTraffic` (bounded population).
- Opponent AI is not in the city by design (see 18.6).

## 19. Racing events (Part 6)

**Status: Sprint and Circuit verified in the browser with two rivals. The intermittent missed checkpoint (J3) has a fix for a gate-width defect, proven in node and probable for J3 (see 19.11a). Step F and the G/H/I review remain open.**
Latest phase (after the first status below): a relocation can no longer move a racer past an unpassed gate (19.6).
Browser results after that change: E 11/11, and J 11/11 in each of J8, J9, J10, and J11 (relocations 0, relocations
held 0 in all four). Across the runs on the restarted dev server, J3 is the only Circuit miss in nine runs (J3 to J11).
- Sprint E: 11/11 on the final code (`/home/user/verification/part6/report_race.json`).
- Circuit J: 4 of the last 5 runs on the restarted dev server passed 11/11 (J4, J5, J6, J7). J3 failed once: it missed
  Checkpoint B on lap 2 and the lap was refused. J3 ran before the relocation trace existed. Its cause is not confirmed.
- Opponents: still two. Three was not run, so the "rise to 3 only if stable" rule was not met.
- Minimap race marks: event rings are built and checked in a browser screenshot in free roam. The next-gate diamond is
  code-checked only (typecheck, lint, build). It has not been seen in a browser during a race.
- Steps G, H, and I were not reviewed as separate manual HUD checks. Their behaviour is covered by the E and J runs.

**Test-environment note.** During this phase the dev server was serving a stale copy of `raceController.ts`, not the
file on disk. Browser runs before the restart therefore tested old code, including a per-rival finish stop that froze
rivals on the finish line. Results from those runs are discarded. Restart the dev server after edits if a browser run
shows behaviour that does not match the source.

### 19.1 Architecture

- `src/config/raceConfig.ts`: race tuning (approach and exit radii, standings interval 6 steps = 10 Hz, progress window,
  place multipliers `[1, 0.6, 0.35, 0.2, 0, 0]`, the place pace factors, anchor and marker clearances, `RACE_MIN_RACERS = 6`,
  `RACE_OPPONENT_CAPACITY = 5`, difficulty speed factors `{1: 0.8, 2: 0.9, 3: 1}`).
- `src/race/raceEvents.ts`: data only. `SPRINT_EASTSIDE` (5 opponents, time limit 240 s, base reward 300) and
  `CIRCUIT_BLOCK` (id `circuit-block`, 2 laps, 5 opponents, no time limit, base reward 400). `RACE_EVENTS` lists both.
- `src/race/pace.ts`: rival pace (pure). The place pace factor, and a rival's speed cap from its event pace and its place.
- `src/race/raceRoute.ts`: builds a `RaceRoute` on the road graph (lane chain, gates, grid, marker, polyline) and
  validates it. Returns `RouteIssue` diagnostics with codes. A circuit needs laps ≥ 2 (`laps-invalid`).
- `src/race/raceStateMachine.ts`, `raceSession.ts`, `raceDirector.ts`: state machine, session, and per-attempt
  director (countdown, timer, results, abort, timeout, retry).
- `src/race/raceProgress.ts`: per-racer progress from real positions: gates in order, laps, finish, out-of-order events.
- `src/race/grid.ts`: single-file grid behind the start anchor. Rows 12 m apart. Rivals take rows 0 to 4 and the player takes
  the last row, so the player starts last (section 19.13).
- `src/race/standings.ts`, `rewards.ts`, `raceFormat.ts`: standings, provisional reward ledger, display text.
- `src/race/raceController.ts`: the only race owner in the step loop (`afterStep`, `inputFor`, `confirm`, `cancel`,
  `syncPaused`). Builds and attaches opponents, holds traffic during a race, retires finished opponents.
- `src/race/raceDebug.ts`: DEV-only read access and `placeForTest` staging. Installed from `App.tsx` under
  `import.meta.env.DEV` only. Not a gameplay action.
- `src/ui/RaceHud.tsx`: compact HUD (countdown, lap, place, time, next checkpoint, abort, result card, toast).
- `src/render/raceVisuals.ts`: event beacons and the shared next-gate bar. Publishes marks to the minimap each frame.
- `src/ui/minimapRaceMarks.ts`: plain mutable store for minimap race marks (event markers set once per world; the
  event in progress and the next gate set per frame). Read by `Minimap.tsx`. No React state, no per-frame allocation.
  Cleared on `RaceVisualPool.dispose`.
- `src/input/keyBindings.ts`: `raceConfirm` (E) and `raceCancel` (Q). Input stays centralised.

### 19.2 States and transitions

`FREE_ROAM → EVENT_APPROACH → COUNTDOWN → RACING → FINISHED | FAILED → FREE_ROAM`, plus `PAUSED` from COUNTDOWN and
RACING (back to the same state on resume). Transitions are a table in `raceStateMachine.ts`. An unexpected transition
is recorded as a diagnostic, not applied.

- `EVENT_APPROACH`: opens inside the approach radius (18 m) of a marker. Closes past the exit radius (30 m), or on Q.
- `COUNTDOWN`: 3 s (3, 2, 1, GO). The car is held on the grid. Traffic is cleared and the spawner is suspended.
- `RACING`: the race clock starts at GO. Pause freezes the clock and the opponents. Resume does not restart the countdown.
- `FINISHED`: the player finished. Unfinished opponents are DNF. Results once.
- `FAILED`: abort (Q while racing), or timeout (Sprint, 240 s). Reason recorded once.
- Leaving: traffic restored, opponents detached, race entry released, input unlocked.

### 19.3 Event format

Each event is a `RaceEventDefinition`: `id`, `label`, `kind` (`sprint` | `circuit`), `marker` (lane id, route anchor
`s`, `sideOffset`), `route` anchors, `laps` (circuit only), `timeLimitSeconds` (null for no limit), `baseReward`,
`opponentCount`, `opponentTopSpeedMps`, `difficulty`. Definitions are data; the shared code has no event-specific branch.

### 19.4 Route validation

`buildRaceRoute` checks: lane ids exist, lanes connect (successor chain), anchors sit away from lane ends
(`anchorEdgeClearanceMeters`), gates are in route order, a circuit closes on its start lane, markers stand outside the
drivable boundary (`markerMinSideOffsetMeters` 10.5 m). Invalid routes are refused with `RouteIssue` codes shown in
diagnostics, never silently repaired.

Verified routes at the time of writing:
- Sprint `SPRINT_EASTSIDE`: valid, 1,171.9 m, gates at route distance 490.0, 889.1, 1,082.3 m (two checkpoints, then the
  finish). The final lane `H-3-2:F:0` has no successor, and the finish gate sits about 90 m before its end.
- Circuit `CIRCUIT_BLOCK`: valid, 12 lanes, 1,196.3 m per lap, origin on `H-1-0:F:0` (start/finish line, `closesLap`).
  Gates in order: Checkpoint A (658.2 m), Checkpoint B (857.2 m), Start/Finish (0 m). Two laps = 2,392 m.

### 19.5 Opponents

Opponents are the shared `OpponentSystem` (`src/ai/aiOpponents.ts`) driving the shared vehicle model through
`AiDriver` (`src/ai/aiController.ts`). The AI outputs `throttle`, `brake`, `steer`, the same fields as the player.
No separate physics, no racing or overtaking logic, no rubber-banding.

Race-specific policy, all in code:
- Route: `nextLaneOf` follows the race route's lane chain, falling back to the graph successor after the route ends.
- Pace (changed this phase, section 19.13): a rival's cap is its event pace (`opponentTopSpeedMps` × `RACE_DIFFICULTY_SPEED_FACTOR`)
  times the place factor for the place it holds now, re-read from the standings every fixed step. Sprint (28 m/s, difficulty 2)
  is 25.2 m/s base: 27.7 m/s for first, 22.2 m/s for sixth. Circuit (28 m/s, difficulty 1) is 22.4 m/s base.
- Grid hold: opponents are held by an input override during COUNTDOWN.
- Curve speed (changed this phase): `v = sqrt(a_lat / κmax)`, where κmax is the sharpest curvature over 45 m ahead
  measured on 4 m arcs. The earlier 35 m-window average let rivals enter junction connectors too fast.
- Lost (lateral error > 4 m): crawl at 3 m/s so pure pursuit can steer back. Before this change it stopped permanently.
- Release (new): a race opponent cannot be recycled, so a stall behind an obstacle, or a stop while it wants to move,
  for 6 s releases it to ignore obstacles for 4 s. The queue clears by driving on. Nothing is teleported.
- Retirement (new): a finished opponent is retired. It is no longer stepped, contacts nothing, is not an obstacle, is
  not drawn, and is not listed in traffic diagnostics. This replaces "stop on the finish line", which blocked the player,
  and "cruise on", which drove back into the player.

Known fact: the Sprint's last lane is a dead end (no successor) 90 m past the finish gate. This is not yet a failure
cause in any run, but it is a layout constraint for any future route.

### 19.6 Position and checkpoints

Progress is measured along the route polyline (`raceProgress.ts`). The racer's nearest route sample is found inside a
60 m window and advances the route distance. A gate counts only when it is crossed in sequence, with a swept
test per step. A re-crossing of the last gate is silent. An out-of-order gate is reported, never skipped. A step
larger than 8 m is treated as a relocation (recovery or DEV reset) and does not test gates. A relocation cannot move the
progress estimate past the next expected gate: it is held at that gate (`relocation-held` event, `relocationsHeld`
counter, notice "Relocated past Checkpoint N: drive back through it"). The gate then counts only after a real forward
crossing. This closes the silent-skip path, which was a teleport past an unpassed gate (tests in `raceProgress.test.ts`). Standings use the same route
distances, recomputed at 10 Hz.

### 19.7 Laps and timing

- `lapsDone` increments at a `closesLap` gate. Each completed lap emits `lap-completed` (notice "Lap N of M").
- The finish is valid only after the last gate of the last lap. The finish gate on a circuit is the `closesLap` gate.
- The first crossing of the start/finish line after the grid is the launch, not a lap, when it is within half a lap.
- Timer: starts at GO. Lap times recorded per lap. Pause freezes it.

### 19.8 Rewards

Rewards are provisional. Part 8 (section 21.10) credits each new grant to the persistent garage balance. The per-attempt ledger still de-duplicates, so a grant is never credited twice.
`rewardForPlace(base, place)` = base × multiplier (1st 1.0, 2nd 0.6, 3rd 0.35, 4th 0.2, 5th and 6th 0, changed this phase). A reward is granted at most
once per attempt. Cancel and abort grant nothing. Retry does not duplicate a reward. Sprint 1st = 300 credits, Circuit
1st = 400 credits (base values).

### 19.9 Controls

- E: confirm (start from the approach card, or on the marker). Q: cancel (card), cancel (countdown), abort (race),
  leave (results). R is locked during a race.
- Esc pause works in COUNTDOWN and RACING. Free roam, camera, and existing keys are unchanged.
- HUD hint now reads `E race · Q cancel`.
- Mobile or touch: not applicable. The project has no touch controls, and none were added.

### 19.10 Tests and outcomes

Automated (Vitest, final code, this phase):
- `npx vitest run`: 478/478 passed across 49 files.
- `npx tsc --noEmit -p .`: exit 0. `./node_modules/.bin/eslint src`: exit 0.
- New tests: `src/race/raceCircuit.test.ts` (6, route validity, closed cycle, gate order, laps ≥ 2, unknown lane
  refused), `src/ai/raceRelease.test.ts` (2, release from a stall, retired opponents not stepped), and a two-rival
  controller test in `src/race/raceController.test.ts`.

Browser (`tools/browser-race.py`, dev server, two rivals). Runs on the restarted dev server are the evidence; the
server was restarted after a stale-module problem (see the note above).
- C, D, E, errors in one run (`C D E errors`, before the last changes): 35/35 passed (C 20, D 4, E 9, errors 2).
- E (Sprint), final code (log not kept): 11/11. Finished 3rd of 3 at 166.88 s, +105 provisional, granted
  once. Both rivals finished first and second. Retry places the car on the grid (−349.80, −401.80) with no duplicate
  reward. Earlier E11 run: 11/11 on the same behaviour.
- J (Circuit, two laps), on the restarted dev server:
  - J2: 10/11. The only failure was the expected notice text. On the last lap the closing gate is the finish, so the
    notice is "Start / Finish passed", not "Lap 2 of 2". The expectation was corrected in the harness.
  - J3: failed the gate sequence. Lap 2 passed Checkpoint A, then the car went past Checkpoint B's location (about
    x −398, z −310, inside the gate width). The game did not count B and refused the closing line with "Start / Finish
    is not next: go to Checkpoint B". The run did not log relocations, so the cause is not confirmed.
  - J4: 11/11, FINISHED at 416.2 s, 3rd of 3, +140 provisional. Relocations 0.
  - J5: 11/11, FINISHED at 427.2 s, 3rd of 3, +140 provisional. Relocations 0. Lap 2 Checkpoint B passed.
  - J6: 11/11. Relocations 0. Lap 2 notices: Checkpoint A, Checkpoint B, final gate.
  - J7: 11/11. Relocations 0.
  - J8 (after the relocation hold, 19.6): 11/11. Relocations 0.
  - J9, J10, J11 (same code): 11/11 each. Relocations 0 in each.
  - E (after the relocation hold): 11/11.
- errors: no page errors and no unexpected console errors in every run.
- Minimap (free roam, `minimap_free_roam.png`): two event rings and the player marker are drawn.
- Minimap in a race (`R01_racing_hud_minimap.png`): the next-gate diamond is drawn on the route, with an event ring, and
  the player arrow is visible. The race HUD shows the clock, limit, place, and next checkpoint. In that DEV screenshot,
  the DEV diagnostics panel covers part of the minimap. The panel is DEV-only.
- Screenshots: `/home/user/verification/part6/` (`C01`–`C05`, `E01_result.png`, `J01_circuit_card.png`,
  `J02_circuit_result.png`, `minimap_free_roam.png`). The Circuit result card is verified visually: FINISHED, 3rd of 3,
  time, reward, standings, Retry and Leave.

Environment fixes this phase (not product behaviour):
- Headless Chromium needed system libraries (`libnspr4` and others). These were installed with
  `playwright install-deps chromium`. The Python `playwright` package was reinstalled.

Harness fixes made in this phase (test driver only, not product behaviour):
- Race drives wait up to 600 s wall-clock for the Sprint finish (the headless browser runs at about half real time).
- The circuit path is built as full laps from one closed lap, so the driver no longer runs off the end of the path at
  the start line.

Build:
- `npm run build`: exit 0 after the final changes. The chunk-size warning remains.
- `playerTrace` is gated to DEV (`import.meta.env.DEV`). The production bundle carries only `playerTrace:null` as the
  store default.
- `StreetRacerDebugApi` and `__STREET_RACER_DEBUG__` do not appear in `dist` (grep count 0).

Reliability (`tools/browser-race.py R`, explicit step, dev server, final code): 10/10.
- Repeated start and cancel: three cycles reach the countdown and return to free roam. No reward granted.
- Pause and resume in a race: the clock is frozen while paused (2.73 s held for 2 s). On resume it continues from the
  paused value, with no countdown restart.
- Abort during the race: outcome `aborted`, no reward. Retry starts a new attempt on the grid with no carried-over result
  and no duplicate reward.
- No input lock after leaving a race: W drives the car 6 m in 2 s.
- Not in that step: rapid crossings in the browser. The swept test is covered by unit tests (fast-step case in
  `gates` tests). Opponent count after retry is checked by the E run's standings (three rows), not by R.

Still not run in this phase: Step F three-opponent runs (not attempted), Steps G/H/I as separate manual HUD reviews (the
mid-race screenshot covers the HUD only in part).

### 19.11 Known limitations

1. **Open: intermittent missed checkpoint on the Circuit.** J3 failed once in nine Circuit runs on the restarted server (J3 to J11)
   (the others passed, see 19.10). Lap 2 passed Checkpoint A, the car physically passed Checkpoint B's location, and the
   gate did not register. The later runs logged relocations (`playerTrace.relocations`) and every one was 0, so a
   relocation is not the observed cause. Candidate causes, unverified: a sweep miss at the corner, or a
   guardrail or boundary contact in that run (J3 logged over 1,000 contacts). J3 predates the trace. A fix must not
   silently skip gates.
2. Resolved in this phase: a relocation can no longer move the progress estimate past an unpassed gate. It is held at the
   gate (19.6). The racer must cross the gate, or drive back through it. Recovery that places a car past a gate therefore
   costs a gate, and the player is told so. That is a deliberate rule, not a silent skip.
3. The browser driver is a Python pure-pursuit bot, not `AiDriver`. Its line rubs guardrails on the Circuit.
4. Finished opponents disappear from the track (retirement). This is a presentation choice, not an animated exit.
5. Two opponents only. Three was not attempted (Step F).
6. Minimap: event rings and the next-gate diamond are seen in browser screenshots (free roam and mid-race).
   The result copy has been checked for the two-rival case (3rd of 3 shows the finished rivals and the player's place).
   The result text has not been checked for a one-rival or three-rival case.
7. Mobile or touch is not applicable (no such controls exist).
8. Rewards are provisional (the amounts). Since Part 8, each grant is credited to the persistent garage balance (section 21).
9. Headless browser runs at about half real time with two cores. Long browser runs need long waits.

### 19.11a Debugging round (J3 gate defect)

- **Cause found and fixed (proven in node, probable for J3).** A gate was 8.5 m half width across the road centre, but the
  drivable boundary is 10.2 m (`NETWORK_BOUNDARY_HALF_WIDTH_METERS`). A car pressed to the outer edge (centre up to
  9.275 m, footprint half width 0.925 m) could cross a gate line outside the gate. Nothing registered it: no
  out-of-order event, no relocation, no error. In the node sweep (`src/race/raceGateSweep.test.ts`) a car at 9.2 m
  from the road centre registered 0 of 6 gates with the old width, and 6 of 6 with the fix.
- **Fix.** `RACE_CONFIG.gateHalfWidthMeters` now equals the boundary half width (10.2 m), so every position the car can
  reach crosses the gate. The gate bar drawn in `raceVisuals.ts` is wider accordingly (about 20 m).
- **J3 is not reproduced.** J3 predates the trace and its trajectory was not logged, so the link is probable, not
  proven. The Python bot follows lane centres and rubs the guardrail heavily (about 250 to 400 contacts per lap in the
  fixed runs), so it is not a wall-hugger. The sweep shows the mechanism; J3 is consistent with it.
- **Tests.** `raceGateSweep.test.ts` (3 tests) drives the real Circuit route through the real `stepRacerProgress`. The
  edge test fails on the old width and passes on the fix. `raceProgress.test.ts` now derives its inside and outside
  lateral values from the configured width.
- **Harness correction (not product).** Step R assumed a fresh session (zero credits). It now compares with the credits
  at its own start, so E-then-R runs are valid. R alone passes 10/10.
- **Browser results after the fix.** Step J: 11/11 (two laps, gates A, B, start/finish in order each lap, reward granted
  once). Steps E and R in one session: 19/19. Full Vitest: 58 files, 565 tests.
- **Still open from Part 6.** Step F (three rivals) is not attempted: raising the rival count is a difficulty change,
  so it needs a decision. Rapid crossings are covered by node tests at 12, 30, and 60 m/s (one fixed step per sample),
  not by a browser run. The G/H/I HUD review is still open. In the DEV build with the diagnostics panel open, the race
  result card sits under the panel (checked in `J02_circuit_result.png`); the production build has no panel.

### 19.12 Garage and career notes

Part 8 implemented the garage, purchasing, upgrades, paint, and persistence (section 21). Career progression and blacklist remain out of scope.

### 19.13 Field, pace, grid, and rewards (current rules)

This section records the current rules. Where an older section gives different numbers, this one is correct.

- **Browser speed check (2026-10-18).** Eastside Sprint (`tools/browser-speed.py race`, finished): the peak rival speed was 52.3 m/s (188 km/h) over 533 samples. The place-1 cap for this Sprint is 25.2 × 1.1 × 2.5 = 69.3 m/s, and the pre-change cap was 27.7 m/s. The peak is about 1.9 times the old cap but below the new ceiling, so the cap did not bind. Rival speeds were not measured on the Seam Sprint.
- **AI speed (current).** Race rivals' caps are multiplied by `RACE_CONFIG.aiSpeedMultiplier` = 2.5 (`src/race/pace.ts`, `rivalSpeedCapMps`). This applies in races only. Traffic and the player are not affected. Not yet checked in a browser run. Section 19.12 and the Part 6 notes describe the earlier two-rival phase.

- **Field.** Every race has six racers: the player and five rivals (`RACE_MIN_RACERS` = 6, `RACE_OPPONENT_CAPACITY` = 5). Every event sets `opponentCount` = 5, including the loop-only Seam Sprint.
- **Solo exception.** The career Clock Run (`career-clock-race`) is solo: no rivals, no time limit, and no pace. It is the one race the six-racer rule does not apply to. A test checks that it is the only solo race.
- **Grid.** The Sprint and Seam Sprint start anchors are `s` = 65 m on the first lane (they were 40 m, then 60 m). The Circuit's start and finish line also moved to `s` = 65, so both still share one line. Rivals take rows 0 to 4, and the player takes row 5, the last row, so the player starts last. Rows are 12 m apart (was 10 m). The last row sits 5 m from the lane start, the edge clearance the route validator requires. `raceRoute.ts` needed no change: every row sits on the route's lanes at or after the lane start, which a test checks for both events.
- **Pace.** Each rival's speed cap is re-read from the standings every fixed step (`applyRivalPace`, then `AiDriver.setSpeedCap`). The cap is the event pace (`opponentTopSpeedMps` × `RACE_DIFFICULTY_SPEED_FACTOR`) times the place factor `RACE_CONFIG.placePaceFactor` = `[1.1, 1.05, 1, 0.96, 0.92, 0.88]`. So the leader is fastest and the last place is slowest. A rival that moves up gets a faster cap. A place past the table uses the last value.
- **Setter.** `setSpeedCap` changes only the cap. It keeps the route and the driving rules, so a pace change never re-routes a rival.
- **Rewards.** `placeRewardMultiplier` = `[1, 0.6, 0.35, 0.2, 0, 0]`. Places 5 and 6 earn nothing. A place past the table earns nothing either, because its last value is 0.
- **Entry gate.** The Sprint's approach marker sits beside its start anchor (`s` = 65, moved from 40 then 60), so the card opens at the grid. The Circuit's marker stays at `s` = 80, 15 m ahead of its anchor (it was 20 m). The loop-only Seam Sprint (`SEAM_SPRINT`, in `LOOP_RACE_EVENTS`, not in `RACE_EVENTS`) also has five rivals and its start and marker moved to `s` = 65 (from 40, then 60). Its browser race runs were not repeated in this pass.

Tests for this rule: `src/race/pace.test.ts` (place table, caps, base pace), `src/race/raceRules.test.ts` (six-racer field, the solo exception, capacity, grid order, grid rows on the route), `src/race/raceDirector.test.ts` (five rivals, the player's slot), `src/race/raceController.test.ts` (rivals on their slots, and each rival's live cap equal to its place's cap), `src/race/rewards.test.ts` and `rewardLedger.test.ts` (places 5 and 6 pay 0), and `src/career/careerExpansion.test.ts` (career field sizes).

Browser checks (`tools/browser-race.py`, `world=city`, Eastside Sprint): run 1 (log not kept) and run 2 (log not kept) both finished in place 6 of 6 with reward 0. Run 2 passed 35 of 35 checks, including the grid checks C start, D grid, and E retry, which now read the player's slot from the route (`playerGrid`). Run 1's four grid FAILs were a stale script expectation (it compared to row 0), not a game fault.

**Start queue (found in browser, now mitigated by wider rows).** The player starts last, behind five rivals on the same lane. At 10 m row spacing, a rival's obstacle rule treated the gap as inside its 6 m stop gap, so the rivals at the back stalled at rest about 1.7 s after GO, and the player's bot drove into them (37 `opponent-player` contacts in runs 1 and 2). Rows are now 12 m apart. In run 3 (log not kept) no rival stalled (`stall1` 0 times, was 1), the rivals moved at about 2.5 m/s at GO, and the race finished 6th of 6 in 167.83 s with 35 of 35 checks passed. The player's bot still touched the rival queue 31 times between about 2 and 13 s and did not touch it again. A human driver can steer around the queue, so this is measured for the bot only. The guardrail contact count (about 190 per race) was observed in every run and was not investigated.

Seam Sprint (loop world, `tools/browser-race.py ... S errors`): 10 of 10 checks passed (`browser-output/part6/report_race.json`). Re-run on the current build (2026-10-18, with the 2.5x rival pace): 10 of 10 again, finish at 53.13 s (the earlier run was 54.02 s), no relocation at the seam. The report file was overwritten by the re-run. The car crossed the seam with no relocation and finished 6th of 6 at 54.02 s, reward 0.

Block Circuit (city world, `... J errors`): **not passing.** The test driver did not finish the two laps. In the current configuration it reached lap 2 at about 220 s, and by 373 s it was still on lap 2 with about 1250 guardrail contacts. The baseline with the old values (10 m rows, Circuit start at s=60), run the same way, also was not finished at 348 s, with 829 guardrail contacts. So the spacing and start change does not explain it. The cause was not found: the pure-pursuit test driver keeps scraping the guardrail near the start/finish lane. Whether a person can finish the circuit is not known. Open item.

The rival pace and the six-car grid are covered by the automated tests above.

## 20. Police pursuit (Part 7)

Status: implemented and verified in automated tests and in the DEV browser run, with the open items listed in 20.11. Part 8 has not been started.

### 20.1 Architecture

- Pure layer, no Three.js or React: `src/pursuit/pursuitTypes.ts`, `pursuitStateMachine.ts`, `heat.ts`, `sight.ts`, `policeRouting.ts` (`LaneRouter`), `deployment.ts` (`chooseDeployment`), `pursuitSession.ts` (`PursuitSession`, the single state authority).
- Controller: `src/pursuit/pursuitController.ts` (`PursuitController`). It implements the simulation's `PursuitStepHost`, owns the police `OpponentSystem`, judges offences, assigns roles, plans routes, and publishes the snapshot.
- Config: `src/config/pursuitConfig.ts` (`PURSUIT_CONFIG`), the only home for pursuit numbers.
- Simulation hook: `GameSimulation` takes an optional `pursuit` option. The police are integrated, contacted, and ended in the same fixed-step order as opponents. `pursuit.afterStep` runs after the race hook. `reset()` and `devReset()` call `onPlayerReset()`. Police are not stepped while `isSuspended()` (a race is on).
- Store and HUD: `src/state/pursuitStore.ts` (zustand, `snapshot`), `src/ui/PursuitHud.tsx`. The controller publishes to the store at about 10 Hz from the render loop, never from the fixed step.
- Rendering: `src/render/policeVisuals.ts` (`PoliceVisualPool`, owned materials and geometry released on dispose) and `src/render/PoliceLayer.tsx`. Police reuse the sedan model with a police livery and a roof light bar (emissive red and blue lamps, flashing at 3 Hz while engaged only).
- DEV only: `src/pursuit/pursuitDebug.ts`, installed from `App.tsx` as `window.__STREET_RACER_DEBUG__.pursuit`.
- Wiring: `App.tsx` builds the controller before the simulation (it is the step host). The race is created after the simulation, so the race probe and the entry gate are connected afterwards. Pursuit exists only in the city world with traffic on (`?traffic=off` also disables police). The legacy and circuit worlds have no police.

### 20.2 State machine

States: `INACTIVE`, `DETECTION`, `INITIATING`, `PURSUING`, `ESCALATING`, `SEARCHING`, `COOLDOWN`, `BUSTED`. Transitions are validated by `canTransition` (22 allowed pairs, table in `pursuitStateMachine.ts`). A refused transition is counted in `rejectedTransitions` and does not change the state. Zero refusals in every automated and browser run.

- Detection starts only from `INACTIVE`, from a witnessed offence. A second report during a session never starts a second session.
- The pursuit ends once, through one `end()` path guarded by an INACTIVE check. Each end sets `lastEndReason`: `cooldown`, `busted`, `aborted-reset`, `cancelled`, or `no-units`.

### 20.3 Detection and triggers

- Witness rule: an offence counts only if a patrol unit sees the player at that moment (`canSee`: radius 70 m, half angle 65 degrees, forward from the unit's heading, no occlusion).
- Built-in offences: speeding (player speed above 1.4 times the lane limit for 2 s in view of a patrol) and a player collision with traffic witnessed by a patrol.
- DETECTION lasts 1.5 s while a witness stays in view. If the witness loses sight during DETECTION, the detection is cancelled silently and no pursuit starts.
- INITIATING lasts 2 s, then PURSUING.
- No auto-start on city entry. Racing alone never triggers a pursuit: `reportOffence` returns `ignored` while a race suspends the pursuit.
- Trigger interface for later systems: `PursuitController.reportOffence(kind)`, with `OffenceKind` in `pursuitTypes.ts`.

### 20.4 Escalation, search, escape, and cooldown

- Units wanted = the current heat level's `maxUnits`. The chase role goes to the nearest patrol first, then to a deployment from the idle pool. While more units are wanted than are chasing, the state is ESCALATING, and it returns to PURSUING when they arrive.
- Lost sight: after 2 s with no unit seeing the player, the state moves to SEARCHING. Sight during SEARCHING returns to the engaged state.
- Search: the level's `searchSeconds` (14 to 24 s), then the search is called off into COOLDOWN.
- Escape: the pursuit cools down only when the player has been out of sight for 5 s AND every pursuing unit is at least 140 m away. Both are required.
- COOLDOWN lasts 8 s. Heat decays at 4 per second only in COOLDOWN. Any sight during COOLDOWN reacquires the pursuit. When the cooldown runs out, the session ends with reason `cooldown`.
- No responding unit for 10 s (`stuck.noUnitSeconds`): in INITIATING, the session ends silently with reason `no-units`. In PURSUING or ESCALATING, it moves to SEARCHING with the notice `Units lost contact, searching`.

### 20.5 Capture (BUSTED)

- A pursuing unit within 7 m of the player, with the player below 3 m/s, held for 2.5 s, enters BUSTED. BUSTED shows for 3 s, then the session ends with reason `busted`.
- A tag alone does not bust. Contact is not the trigger for the bust; a ram only starts the 1.5 s driving lockout (section 20.13). The capture hold is: the car must stay within 7 m of a pursuing unit, below 3 m/s, for 2.5 s without a break. The hold resets to zero the moment the car is out of range or moving at 3 m/s or more, so a car that is tagged and drives on is not busted.
- The rule never moves or disables the car. The player can always drive away, and capture is decided by range, speed, and hold time only.
- Contact still pushes the two cars apart with the shared contact rule. A rammed car can be pushed up to speed, which resets the capture hold.

### 20.6 Heat (`PURSUIT_CONFIG.heatLevels`)

Five levels, data driven. Thresholds rise and are validated at construction. Level 1 starts at threshold 0. Heat is capped at 100.

| Level | Heat threshold | Max units | Speed cap (m/s) | Deploy interval (s) | Search (s) |
|---|---|---|---|---|---|
| 1 | 0 | 1 | 26 | 0 | 14 |
| 2 | 20 | 2 | 29 | 6 | 16 |
| 3 | 40 | 2 | 32 | 6 | 18 |
| 4 | 65 | 3 | 36 | 5 | 20 |
| 5 | 85 | 4 | 40 | 5 | 24 |

- Detection adds 10 heat once. A running pursuit adds 1 heat per second. A repeat offence adds 5, rate limited to one per 4 s.
- Heat never drops on a corner. It falls only in COOLDOWN, and it is cleared at session end, so it is pursuit intensity only, not progression.
- The pool is 4 units (`unitPoolSize`). Patrols are 2. The config is checked at start-up: no level may want more units than the pool holds.

### 20.7 Routing and movement

- Police are `OpponentSystem` units with `recyclable: false` and `releasable: false`. They use the shared `AiDriver`, the shared vehicle model, and the shared contact rule. Nothing teleports a unit toward the player. The only placements are deployments and patrol respawns, and they are validated first.
- `LaneRouter.planTo` runs one Dijkstra over the lane graph, with a 60 m penalty for opposing heading. The route is a successor map that the driver uses through its `nextLaneOf` policy.
- Replanning is bounded: every 2 s, or when the target has moved 25 m, or when a unit is stuck. Never every step.
- Targets: a chaser aims 2 m behind the player's centre (`routing.chaseBehindMeters`), so it comes up on the tail and tags the car; a search unit drives to the last known position; an intercept unit aims 180 m ahead of the player on the player's lane chain, approaching by a route that avoids the chaser's lanes.
- Lane graph: forward lanes form two components (one per lane index), because there are no lane changes. Units stay on their lane index by design, and routing never crosses lane indices.
- Engaged units exempt the player from their obstacle list (`OpponentSystem.setObstacleExemption`). Without it, a chaser brakes for the stopped player and stalls about 9 m short of the 7 m capture range. This was found by the browser run and is covered by a regression test that fails without the exemption (20.10). Patrols keep the player as an obstacle.
- Stuck handling: a unit that wants to move but has speed under 0.5 m/s is replanned after 6 s and removed after 12 s. Removal retires the unit. Nothing is moved to unstick it.
- Deployment (`chooseDeployment`): segment lanes only, 80 to 170 m from the player, never within 45 degrees ahead of the player, preferred outside a 70 degree half angle, 6 m clearance from every body (player, police, traffic). A deployment is postponed when no candidate is valid. Patrols start 150 to 320 m away and outside view.
- Patrol respawn: an idle patrol slot is refilled every 2 s, only in INACTIVE.

### 20.8 HUD, store, and DEV surface

- HUD: `PursuitHud` is top-left under the Pause and Reset buttons. It renders nothing in INACTIVE. It shows the state title, heat pips (level), engaged and patrol counts, the state line (detection, out of sight with seconds, search or cooldown countdown, busted), and the escape gauge. A capture gauge shows while the capture hold runs.
- Notices come only from state changes (`Police are responding`, `In pursuit`, `Lost visual, searching`, `Spotted again`, `Backup requested`, `Heat level N`, `Busted. Pursuit over`). They are shown only while a pursuit is on, so they cannot contradict the HUD.
- Escape toast: `Escaped. The police have given up.` for 3 s, only after a cooldown end. Other ends are silent.
- DEV-only read access: `window.__STREET_RACER_DEBUG__.pursuit` exposes `getSnapshot()`, `getDiagnostics()` (per-unit role, lights, lane, speed, route size, plan age, stuck time, target distance, and the counters), `reportOffence(kind)`, `placeAheadOfUnit(id, meters)`, `placeFarAway()`, `stepCount()`, and `suspended()`. The staging calls move only the player, on the lane graph. Police are never moved by a staging call.
- No DEV panel section has been added. Diagnostics are read through the DEV API only.

### 20.9 Race interaction

- A race cannot start while a pursuit is on. `RaceController` takes an entry gate, and `confirm()` refuses with the reason `Lose the police before starting a race.`, which the race HUD shows.
- While a race is on, the pursuit is frozen: police are not stepped or drawn, no session advances, and offences are refused. A race never starts a pursuit.
- Reset (R) during a pursuit ends it with `aborted-reset`, as the Part 6 reset rule requires for every other session.

### 20.10 Tests

Automated (run with `npx vitest run`):

- Pure layer: `pursuitStateMachine.test.ts`, `heat.test.ts`, `sight.test.ts`, `policeRouting.test.ts`, `deployment.test.ts`, `pursuitSession.test.ts`. These cover transitions, escalation thresholds, route selection, search, escape, cooldown, and cleanup, plus a long randomised invariant run.
- Controller (`pursuitController.test.ts`, 18 tests, real simulation on the city graph): start state and patrol placement; no auto-start; unwitnessed offence refused; witnessed detection; race refusal with the police still; the detection, initiation, pursuit path with no illegal transitions and a planned chase route; lights only on engaged units; no teleport (displacement bounded per step, with deployments counted); bounded pool; search, escape, and cooldown end; cleanup after the end; reset and double reset; a chaser reaches capture range behind a stopped player (regression, fails without the exemption); a held player is captured, BUSTED then INACTIVE with reason `busted`.
- AI hooks (`src/ai/policeAi.test.ts`, 9 tests): `setPolicy` never teleports and applies the cap; `place` re-activates a slot with the given spec; `retire` stops a unit; an unknown id is refused; no stall recycle for police.
- Race gate (`raceController.test.ts`): refused with the reason, then starts once the block clears.
- Last full run: 57 test files, 562 tests, all passing. `npm run lint` clean. `npx tsc --noEmit` clean.

Browser (`tools/browser-pursuit.py`, DEV server, headless Chromium, real keyboard for driving; staging calls only move the player). Not part of the default `browser-race.py` steps. Last full run: 35 of 35 checks passed.

- Harness note (this debugging round): the trigger step first polled from Python every 0.8 s, which can miss a 1.5 s DETECTION that is cancelled quickly. It failed one run (34 checks, 33 passed) with a session started but not seen. The step now watches the state in the page every 10 ms and records every state change. The run that followed passed 35/35, with a real detection from the car's own speed (peak 36.2 m/s), one refused second offence, and a silent cancel. Steps: `boot`, `visual`, `trigger`, `pursue`, `escape`, `reset`, `errors`. Screenshots and the timeline are in `/home/user/verification/part7/`.

- `boot`: no pursuit at start, two patrols, no HUD.
- `trigger`: holding W in view of a patrol (peak 31.8 m/s) started a real speeding detection. A second offence during it was refused. Leaving the witness's view cancelled the detection silently.
- `pursue`: DETECTION, INITIATING, PURSUING in order. The HUD matches the state. Every engaged unit is lit and no patrol is. No unit moved more than the step bound. Chasers closed to 10.9 to 11.7 m (not contact range in this run).
- `escape`: PURSUING, SEARCHING, COOLDOWN, INACTIVE over about 21 s, with reason `cooldown`. The HUD hid, the toast showed, and no unit stayed engaged. Heat cleared, patrols back.
- `reset`: R ends a live pursuit with `aborted-reset`, and the HUD hides.
- `errors`: no page errors. Console warnings only the known GL and three.js messages.
- Sim rate in headless Chromium: about 48 fixed steps per second, below the nominal 60. The reset check waits up to 8 s for R. Earlier runs failed because a fixed 0.6 s wait was too short, so that wait was replaced.

Screenshots: `P00_boot_free_roam.png`, `P01_patrol_ahead_inactive.png`, `P02_pursuit_lights_hud.png` (HUD top-left, pursuing, in sight, escape gauge), `P03_pursue_after.png`, `P04_after_escape_toast.png`, `P05_patrol_close_up.png`.

### 20.11 Known issues, limitations, and deferred features

Open or unverified:

- Police livery and roof light bar are not confirmed visually at a useful size. The close-up (`P05`) shows a patrol as a white car with a dark roof and small red lamps. The light bar is not clearly resolvable there. The lights are verified only by the DEV state (`lightsOn`), not by eye.
- Chasers are not in the chase camera view in the captured frames (they are behind the camera). Route following is shown by lane changes and by the no-teleport check, not visually.
- Stuck removal is tested in the controller (`pursuitController.test.ts`): a chaser held in place (fault injection, pose pinned with zero speed) is re-planned at 6 s and removed at 12 s. The test fails when the removal limit is raised to 1000 s, so it exercises the rule. Not yet seen in a browser run.
- Capture (BUSTED) is covered by an automated test with the car pinned in place. It is not reached in the browser run, where the chasers did not reach a stop in range.
- **Ram lockout (the answer to bust reachability).** Before this change, a stationary car was never busted in a browser: the chasers rammed it at 13 to 28 m/s, the ram flung it to 14 to 22 m/s, and the 2.5 s hold reset. The owner chose a ram lockout with braking. Now a pursuing unit that touches the player (an overlap in the simulation, during an active pursuit only) locks driving input for `PURSUIT_CONFIG.ram.lockoutSeconds` = 1.5 s. Inside the lockout the input is no throttle, no steering, and full brake, so the car slows to a stop. The lockout does not end the capture hold, and it never applies during a race. A reset clears it. The pure helpers are in `src/pursuit/ramLockout.ts` (tests in `ramLockout.test.ts`); the controller sets it (`onRam`, `driveInput`) and the simulation applies it.
- **Browser result after the lockout.** `browser-output/part7/bust_probe.py` (150 s, car kept still, no keys): BUSTED at 44.8 s, back to INACTIVE at 54.0 s, minimum pursuer distance 4.45 m (the log was in `/tmp`, which does not persist, so it is not kept). `bust_check.py` passed 9 of 9 at the time (capture, end reason busted, fine 1500 to 900 with 600 charged, the toast, reset to the spawn within 0 m, and rest after the reset). Its log was in `/tmp` and is not kept; the re-run is below.
- Speed caps rose this pass (section 20.13), and pursuing units now have 2.5 times those caps. The browser speed check is in 20.13 (the cap is applied at 65 m/s; the peak chase speed was 38.1 m/s). The chase feel at the new caps is not checked by hand.
- **Re-run on the current build (2026-10-18).** `browser-output/part7/bust_check.py`: 9 of 9 passed. The car was captured (`INACTIVE > DETECTION > INITIATING > PURSUING > BUSTED > INACTIVE`), the end reason was `busted`, the fine took the save from 1500 to 900 (600 credits, 40%), the toast read "You lost 600 credits (40%)", and the car was back at the spawn with zero speed.
- Reacquire is covered in the controller (SEARCHING, then PURSUING when a chaser sees the player again, through the real sight check) and in the session tests. Reacquire during COOLDOWN is covered by the session tests only. It is not in the browser run.
- No manual review pass has been done beyond the screenshots above.
- Production build succeeds. The bundle is 1.32 MB minified, and Vite prints its chunk-size warning. That warning was not compared against the pre-Part-7 build, so it is not confirmed as pre-existing.

Deferred by design (see the Part 7 brief):

- Roadblocks and spike strips. Deferred until the core is stable.
- Siren audio. The project has no audio system, and no external assets are allowed.
- Many police vehicle types, damage simulation, impound or arrest economy, dispatch simulation, blacklist, career heat, multiplayer.
- Occlusion in sight. The sight check ignores buildings and other cars.

Behaviour notes:

- The two lane-index components mean a pursuit can only use the lanes of the unit's own lane index. This is by design, because there are no lane changes.
- Police react to the player's position through sight and last known position. They have no knowledge of the player beyond what the rules give them.

### 20.12 Part 6 items still open

Part 6 open items (see 19.11a): step F (three rivals not attempted), J3 (gate-width fix applied, not reproduced), the G/H/I manual review, and a browser rapid-crossing check. The browser smoke run for Parts 1 to 2 has not been run.

### 20.13 Pursuit driving, bust reset, and fine (current rules)

- **Driving rules.** Each pursuing unit runs with `PURSUING_RULES`, built from `PURSUIT_CONFIG.drive`: it ignores obstacles on its route (`respectObstacles` false), corners at 5 m/s² (`curveLateralAccelMps2`, traffic uses 3.2), and keeps its speed when it loses the line (`easeWhenLost` false). Patrols keep the traffic rules.
- **Rules are passed on every plan.** `setPolicy` falls back to the traffic rules when a policy omits `rules`. Every pursuing plan passes `PURSUING_RULES`. The one call that omits them (`speedCapMps: null`) runs only for a unit returned to patrol. A respawn or placement builds a new driver, so a patrol never keeps the pursuit rules or a stale cap.
- **Speed caps.** Per level: 26, 29, 32, 36, and 40 m/s (was 22, 24, 27, 31, 35). See the heat table in 20.6. Pursuing units then get `PURSUIT_CONFIG.unit.pursuitSpeedMultiplier` = 2.5 (`capFor` in `pursuitController.ts`), so the effective caps are 65, 72.5, 80, 90, and 100 m/s. Traffic and the player are not affected. Browser check (`tools/browser-speed.py pursuit`, city world, 2026-10-18): each pursuing unit's applied cap, read from diagnostics `capMps`, was 65 m/s at level 1. Police peaked at 38.1 m/s over a 96 s chase. Near 28 m/s they were held in curves (a curve limit ahead, not measured directly). The vehicle's own top speed is 62 m/s. So the cap did not bind on this route: the city has no long straight, and the 65 m/s speed was not reached in a browser run. Unit test: every chasing unit's `capMps` is one of the heat-level caps times 2.5 (`pursuitController.test.ts`).
- **Chase aim.** A chaser aims at a point 2 m behind the player's centre (`chaseAimPoint` in `src/pursuit/chaseAim.ts`), so it comes up on the tail and tags the car.
- **Bust.** The session ends busted (section 20.5). The simulation sends the car to the spawn with zero speed after the step loop, with `reset()` (which returns the police to patrol) and `resetTraffic()`, and counts it in `bustCount`. Reading the flag is one-shot (`takeBustReset`).
- **Camera.** The render loop snaps the chase camera (`chase.initialized = false`) only when `bustCount` changes. The camera never snaps otherwise.
- **Fine.** `App` sends a busted session through `bustFineNotice` (`src/pursuit/bustNotice.ts`). It calls `garageService.chargeBustFine(40)`: 40% of the credits, rounded to whole credits, never more than the balance. The rule is `chargeBustFine` in `garageModel.ts`. The save is one write. The store changes only after the write succeeds. If the save fails, nothing is charged and the notice says so.
- **Notice.** The toast (`PursuitHud`, shown for 5 s) reads, for example, `Busted. Back at the spawn. You lost 600 credits (40%).`, and `Busted. Back at the spawn. You had no credits to lose.` when the balance rounds to zero.
- **Tag versus bust.** A tag alone does not bust (section 20.5). A ram does lock driving input for 1.5 s, so a car that is rammed and held still can then be busted. A car that drives away is not.

Tests for this rule: `src/ai/driverRules.test.ts` (rules, obstacles, curves, losing the line, `setSpeedCap` keeps the route, and a policy without rules), `src/pursuit/chaseAim.test.ts` (aim point behind the player), `src/pursuit/bustNotice.test.ts` (text, sink, and the real garage service), `src/garage/bustFine.test.ts` (fine rule, rounding, and bounds), `src/engine/bustReset.test.ts` (spawn reset, one count per bust, and the stub pursuit), and `src/pursuit/pursuitController.test.ts` (the existing busted capture, plus `bustCount` 1 and the one-shot flag).

Verified in a browser: the bust capture, the fine, the toast, and the reset to the spawn (`bust_check.py`, 9 of 9). The camera on the bust reset: `browser-output/part7/bust_camera.py`, 9 of 9. The camera jumps once, at the reset, and stays 7.5 m behind the car; it does not sweep (log not kept). Not verified: the chase feel at the new speed caps, which needs a person to drive it.

## 21. Garage, vehicle economy, upgrades, and customization (Part 8)

> **Superseded for the vehicle roster by section 25 (car overhaul).** The 7-car catalogue table below is the Part 8 state. Use section 25 for the current 20 cars.

Status: implemented and verified in this phase, except the deferred items listed in 21.13. Selling is deferred.

### 21.1 Audit result and what was built

The audit found no save system, no profile, no currency, no ownership, and no garage. Race rewards were a session-only
ledger. Vehicle handling was one `VEHICLE_CONFIG` object with no mass parameter, and the simulation was built once with it.
Part 8 built the persistence layer, the currency, the garage model, and the switch path as new modules. It reuses the
existing state approach (zustand stores, like `appStore` and `raceStore`), the existing input action queue, and the
existing simulation. It adds no second economy, save system, vehicle controller, or game loop.

### 21.2 Files

- Config (tuning, data only): `src/config/vehicleCatalogue.ts` (7 vehicles), `specLimits.ts` (tunable keys and limits),
  `upgradeConfig.ts` (categories, tiers), `paintConfig.ts` (palette), `garageConfig.ts` (credits, costs, entrance).
- Vehicles: `src/vehicles/effectiveSpecs.ts` (the one spec pipeline and display rows), `catalogue.ts` (lookups and
  validation).
- Garage: `src/garage/garageModel.ts` (state, normalizer, pure transactions), `garageService.ts` (the one authority, the
  store, persistence), `garageGate.ts` (entry rules), `activeVehicle.ts` (memoized active specs and paint).
- Save: `src/save/saveFile.ts` (envelope, migration, corrupt and newer handling, storage adapter).
- UI: `src/ui/Garage.tsx` (overlay), `GaragePreview.tsx` (turntable preview), `GarageLauncher.tsx` (balance, button,
  reason). State: `src/state/garageUiStore.ts`. Render: `src/render/GarageEntranceVisual.tsx`.
- Changed: `src/engine/gameSimulation.ts` (`vehicleConfig`, `setVehicleConfig`), `src/render/renderLoop.ts` (garage
  action, pause, config from the simulation), `src/render/VehicleVisual.tsx` (`paintColor`), `RenderLayer.tsx`,
  `src/App.tsx` (wiring), `src/race/rewards.ts` (`onGrant`), `src/race/raceController.ts` (reward callback),
  `src/world/worlds.ts` (`garage` entrance: city only), `src/input/keyBindings.ts` (V), `src/ui/Hud.tsx` (hint),
  `src/styles.css` (garage styles).
- Tests: see 21.12. Browser harness: `tools/browser-garage.py`.

### 21.3 Vehicle catalogue format

Each entry in `VEHICLE_CATALOGUE` has: `id` (stable, lowercase, never renamed), `name`, `summary`, `priceCredits`
(0 only for a starting vehicle), `startsOwned`, `factoryPaintId`, `upgradeSupport` (categories the car can take), and
`handling` (a partial object of tunable keys only). Missing keys inherit `VEHICLE_CONFIG`. An empty `handling` is the
factory baseline.

Rules, checked by `validateCatalogue()` on the real data in a test: unique ids, valid paint ids, valid categories,
tunable keys only, prices as whole numbers, at least one starting vehicle, and base handling inside its limits without
clamping. Dimensions and the collision footprint can never be overridden, so traffic and pursuit (which read the base
footprint) stay correct.

| id | Price (cr) | Owned at start | Upgrades | Character |
|---|---|---|---|---|
| kestrel-hatch | 0 | yes | all | Factory tuning (empty handling). Drives as before Part 8. |
| tarn-roadster | 1,200 | no | engine, tires, brakes | Light, quick steering, less grip |
| bastion-sedan | 900 | no | transmission, tires, brakes | Slow pull, stable, holds a line |
| volt-e | 1,800 | no | tires, brakes | Strong low-end pull, lower top speed |
| ember-gt | 2,800 | no | all | Fast all-rounder, high top speed |
| grit-coupe | 2,200 | no | engine, transmission, brakes | Built to slide, no tire grip upgrades |
| halcyon-gt | 4,500 | no | all | Highest top speed, stable at speed |

Tests (`catalogue.test.ts`): each non-starter vehicle has a different speed over 0 to 4 s under the same controller input,
and a crossover test checks that the Volt E leads off the line while the Halcyon GT leads later, from its higher top speed.
These are real handling differences, not cosmetic ones.

### 21.4 Effective-spec pipeline

`deriveEffectiveSpecs(vehicle, upgrades)` in `vehicles/effectiveSpecs.ts` is the only function that produces the
config the controller runs. Steps: (1) base handling, with missing keys from `VEHICLE_CONFIG`; (2) each installed tier
multiplies the keys it touches (products commute); (3) every tunable value is clamped to `SPEC_LIMITS`; (4) invariants
are enforced and reported (engine fade ≥ top speed + 5 m/s, drift grip ≤ grip, drift lateral ≤ lateral, high-speed steer
≤ low-speed steer); (5) a frozen `VehicleConfig` is returned with a report of clamps, ignored upgrades, and adjustments.
Base data is never written. The garage's "Factory" and "Current" columns both come from this function, so the display
is the driven number. Upgrade changes produce a new config object. Paint is not in the config (see 21.8).

### 21.5 Upgrades

| Category | Tier 1 / 2 / 3 effect | Notes |
|---|---|---|
| Engine | engine acceleration ×1.06 / ×1.12 / ×1.18 | |
| Transmission | top speed ×1.05 / ×1.10 / ×1.15 and fade speed the same; acceleration ×0.99 / ×0.98 / ×0.97 | Deliberate trade: higher top speed, less initial pull |
| Tires | lateral grip ×1.06 / ×1.12 / ×1.18; cornering limit ×1.05 / ×1.10 / ×1.15 | |
| Brakes | braking ×1.08 / ×1.16 / ×1.24; handbrake ×1.08 / ×1.16 / ×1.24 | |

Costs: 150 / 400 / 900 credits per tier (`GARAGE_CONFIG.upgradeTierCostCredits`), the same for every vehicle. Rules:
tiers are bought one at a time, in order, and each buy charges once; there is no downgrade and no sell-back; a category
the vehicle does not list is refused with a reason; a tier past 3 is refused. Every result is clamped to `SPEC_LIMITS`.

### 21.6 Garage model and transactions

State (`GarageState`): `credits` (whole number), `selectedVehicleId`, and `vehicles` keyed by owned id, each holding
`upgrades` (tier per category) and `paintId`. The key set of `vehicles` is ownership, so duplicate ownership cannot be
represented.

Transactions are pure functions in `garageModel.ts`: `purchaseVehicle`, `selectVehicle`, `purchaseUpgrade`,
`applyPaint`, `earnCredits`. Each returns either a new state with the charge, or a failure with a code and a message.
A failure never changes state. Failure codes: `unknown-vehicle`, `not-owned`, `already-owned`, `already-selected`,
`insufficient-credits`, `unsupported-upgrade`, `max-tier`, `unknown-paint`, `already-applied`, `invalid-amount`,
`duplicate-click`, `save-failed`.

`garageService.ts` is the only committer. Order of work: (1) duplicate-click guard (the same intent within 400 ms is
ignored); (2) the pure rule decides; (3) the result is saved; (4) only then is the store updated. If the save fails, the
transaction is refused and nothing is charged. The UI never edits credits or ownership.

Selling is deferred. The garage shows "Selling is not available in this version." No sell path exists, so the
no-sell-only-vehicle and no-duplicate-refund rules have nothing to enforce yet.

### 21.7 Ownership, selection, switching, and the garage entrance

- Browsing a car in the list (focus) does not change the active car. Only "Make active" does.
- The active car is `selectedVehicleId`. It is always owned. The normalizer falls back to the starter.
- Garage entry is a single rule, `evaluateGarageEntryAt`, shared by the V key and the button. It refuses, in this order:
  no garage in this world (only the city has one); any race state other than free roam (countdown, racing, approach,
  results, paused race); any pursuit state other than INACTIVE ("Lose the police before entering the garage", so entry
  never clears a pursuit); outside the entrance zone (12 m radius from the entrance point at the city start); moving
  faster than 3 m/s.
- While the garage is open the car is parked like a pause: the loop treats the garage as paused. Only V and Esc act,
  and both close the garage. Reset, race, and driving input are ignored. Closing restores free roam.
- Switching: "Make active" calls `GameSimulation.setVehicleConfig`. The simulation accepts only a config with the same
  collision footprint, otherwise it throws. Speed is clamped to the new top speed. Pose is kept. There is one player
  vehicle and one simulation; no second vehicle is created. Police and traffic keep reading the same footprint.
- The garage's entry rule is checked again at each key press, not only from the 5 Hz button poll.

### 21.8 Paint and the cosmetic rule

Palette: 8 fixed colours in `paintConfig.ts`. Paint recolors only the body-panel parts (kind `body`). Glass, lights,
indicators, cabin trim, and tires keep their materials. Paint never changes physics. Paint is not part of the handling config,
so a colour change does not create a new config object and does not reset the simulation.

Stated cosmetic rule (shown in the garage): a vehicle's factory paint is free. Any other palette colour costs 150
credits per change, through the same transaction service. Re-applying the current colour is refused and is free.

### 21.9 Save file and migration

Key `street-racer.save`, one localStorage entry, schema version 1:

```
{ "schemaVersion": 1,
  "garage": { "credits": 1500, "selectedVehicleId": "kestrel-hatch",
              "vehicles": { "<vehicleId>": { "upgrades": { "engine": 0, "transmission": 0, "tires": 0, "brakes": 0 }, "paintId": "cherry" } } } }
```

The save holds ids and numbers only. The catalogue, prices, and limits are never saved, so a balance change applies to
existing saves without a migration. A write keeps any other top-level sections in a schema-1 save.

Load rules (never throws):
- No key: a new game, writes allowed, starting balance 1,500 and the starter car.
- No `schemaVersion` (schema 0, an unversioned garage object): migrated to schema 1, data kept. No real schema-0 saves
  exist; the path is tested so that future migrations follow the same pattern.
- Schema 1: normalized. Bad credits reset to the starting amount. Unknown vehicle ids are removed. An invalid selection
  falls back to the starter. Upgrade levels are clamped and unsupported categories removed. An unknown paint resets to
  factory. Each repair is reported, and the player sees "Some saved data was reset to safe values."
- Schema above 1: kept untouched. The session plays on defaults in memory, and writes are off. The player sees a notice.
- Unreadable JSON or a wrong shape: the raw text is copied to `street-racer.save.backup` first. Writes stay on only if the
  copy succeeded. Only the most recent unreadable copy is kept.
- Storage blocked, missing, or full: play in memory with writes off and a notice. A transaction that cannot be saved is
  refused.

### 21.10 Race rewards and pursuit integration

- Rewards: `RewardLedger` now takes an `onGrant` listener. `RaceController` passes its reward callback, and `App` calls
  `garageService.earnCredits(credits, 'race <eventId>')`. The ledger calls the listener only for a new attempt with
  positive credits. A duplicate finish, a retry of the same attempt, and a zero-credit grant never reach the balance.
  A retry is a new attempt and can grant again, as the provisional rule says. There is still one reward pipeline.
- The race HUD's "session" value is still the ledger total for the session. The persistent balance is the garage's.
- Pursuit: the pursuit reads the simulation's player state, so police follow the active car after a switch. No stale
  reference is held: the pursuit gets the footprint from the shared dimensions, which the switch cannot change. Police
  keep the base handling config (`VEHICLE_CONFIG`), by design. Garage entry is refused during a pursuit (21.7).
- Race opponents keep the base handling (`VEHICLE_CONFIG`). The player's upgrades are not applied to rivals.

### 21.11 Controls

- V: open or close the garage (the entrance rule applies). The HUD button "Garage · V" shows the same rule's reason
  when disabled.
- Inside the garage: mouse on the buttons, Esc or V to close, "Return to free roam" to close.
- Driving keys are unchanged (W/S/A/D, arrows, Space).

### 21.12 Tests and verification results

Automated (Vitest), run in this phase:
- `src/vehicles/catalogue.test.ts` and `effectiveSpecs.test.ts`: 24 tests. Catalogue validation, stable ids, 5–8
  vehicles, starter baseline, limits, shared dimensions, real handling differences, and the effective-spec pipeline
  (determinism, immutability, frozen output, clamps, invariants, unsupported and out-of-range upgrades, display rows).
- `src/garage/garageModel.test.ts`: 33 tests. Purchases (atomic, charged once, duplicate and short-funds refusals),
  selection, upgrade tiers and costs, paint and the free factory rule, earnings, and normalization of loaded data.
- `src/garage/garageService.test.ts`, `garageGate.test.ts`, `activeVehicle.test.ts`: transactions, double-click guard,
  save-failure atomicity, non-writable saves, persistence across a reload, entry rules, and memoized specs.
- `src/save/saveFile.test.ts`: round trip, catalogue data absent from the save, other sections kept, schema 0 migration,
  repairs, corrupt JSON with backup, backup failure, newer schema, blocked and missing storage.
- `src/race/rewardLedger.test.ts`: one credit per attempt, retry, zero-credit handling, no-listener behaviour.
- `src/engine/vehicleSwitch.test.ts`: switch equals a fresh car, real distance differences, no-op on same config, footprint
  refusal, speed clamp, pose kept.
- Full suite: `npx vitest run`, 67 files, 680 tests, all passing (baseline before Part 8: 58 files, 567 tests).
- `npx tsc --noEmit`: clean. `npx eslint .`: clean.

Browser (real keyboard and mouse, DEV server, fresh profile each run):
- `tools/browser-garage.py load garage persist drive errors`: 24/24 checks. Balance 1,500; V opens the garage; buying the
  Tarn charges 1,200 once; "Make active" switches; a double click on an upgrade charges one tier (150); painting
  midnight charges 150; the live car's body panel changes from red-dominant (59,0,1) to blue-dominant (0,2,7); reload
  keeps 0 credits, the selection, the upgrade, and the paint; save holds no catalogue prices; driving away disables the
  button with the reason "Stop inside the garage entrance first."; V does not open the garage away from the entrance;
  no page or console errors. Screenshots and the JSON report are in `/home/user/verification/part8/`.
  An earlier run (23/24) failed on a harness measurement fault (frame-wide paint pixel counting). The harness was changed
  to sample the body panel. The balance selector was also fixed before the counted run.
- `tools/browser-race.py C D E errors` (Sprint, regression): 35/35. Includes reward granted once and no duplicate on retry.
  Report: `/home/user/verification/part8_race/`.
- `tools/browser-pursuit.py` (regression): 33/33, `/home/user/verification/part8_pursuit/`. The trigger step, which
  failed once in the Part 7 run, passed in this run. Its root cause is still not confirmed (see 20.11).
- Circuit (`?world=circuit`) and legacy (`?world=legacy`): load, drive forward, no errors, no garage button, the balance
  pill is shown. Smoke only, not counted as checks.

Build: `npm run build` succeeded. `dist/assets/index-*.js` 1,345.94 kB (gzip 377.31 kB). The chunk-size warning was
already present and is not new. Part 7 was 1,319.07 kB (gzip 369.08 kB).

Not verified in a browser in this phase:
- A race reward appearing in the garage balance. The reward path is verified by the race harness (the ledger total) and
  by the unit test of the listener. The balance credit itself was not read back from the browser.
- A garage open attempt during a live pursuit, a race countdown, or a race. The rule is verified by unit tests only.
- The garage preview's WebGL context release on close. React Three Fiber disposes its renderer on unmount. This was not
  measured with a GPU profiler.

### 21.13 Known limitations and deferred work

1. Selling is deferred. Nothing sells, so the sell rules (never sell the only vehicle, never sell the selected car
   without a replacement, defined resale value, no duplicate refunds) are not implemented.
2. All catalogue cars share one procedural body. Differences are handling and paint. A distinct silhouette per car is not done.
3. Dimensions and the collision footprint are shared by design. A car with a different footprint needs a footprint
   propagation change to traffic and pursuit first.
4. Police and race opponents use the base handling. Upgrades apply to the player only.
5. The garage exists only in the city. Its entrance is the city start point.
6. The credit balance is shown in every world, including circuit and legacy, where it cannot be spent. The garage is absent there.
7. The garage preview is a second WebGL canvas, open only while the garage is open. It was not measured on mobile or
   low-memory devices. Mobile and touch controls do not exist in this game, so mobile is not applicable.
8. The reward ledger (per-attempt de-duplication) is in memory and race state is not saved. A reload therefore starts
   with no race and no finished attempt to re-grant. A future change that saves race state must also save the ledger,
   or the same attempt could be granted again after a reload.
9. Schema 0 migration is exercised by tests only. No real schema-0 saves exist.
10. No cosmetic beyond paint: no decals, wheels, or liveries (out of scope).
11. The 3-tier upgrade pips and costs are placeholders for balance, not measured. Price and reward balance were not
    playtested over a long session.
12. Part 6 and Part 7 open items are unchanged: Step F (rivals difficulty), the Part 6 J3 cause (probable only), the
    Part 7 trigger flake root cause, the BUSTED fairness decision, and the Part 7 capture and livery checks.
13. Excluded by the brief and not built: blacklist and rivals, story campaign, multiplayer, trading, external vehicle
    collection, decal and livery editor, damage and repair, parts inventory or crafting, dyno simulation, physics rewrite.


## 22. Part 9: Career mode

### 22.1 Scope and what was built

Part 9 adds a career on top of the existing save, currency, garage, race pipeline, and pursuit. It adds no second profile,
currency, race-result handler, persistence layer, or game loop. The career is opt-in: a new player starts it from the
career hub. Free-roam races behave as before.

Built: the career data model, reputation and rank rules, unlock prerequisites with specific locked reasons, the career
hub (events, leaderboard, challenge card, milestones), one rival chain of four rivals (Mara Quill, Teo Varga, Juno
Ashdown, Kai Mensah), the milestone evaluator, save migration to schema 2, and the career outcome card.

Not built or not verified: the roster of eight to twelve rivals (four exist); a hub-to-race start, which is deliberately
not built (see 22.8); a locked visual style on career race beacons; and a browser win against Mara (see 22.11).

Build order used: data model, reputation and unlocks, service, save, race wiring, then UI. The code was written before
these docs. This section was written from the code and the test output, not from the brief.

### 22.2 Files

- `src/config/careerConfig.ts`: `CAREER_CONFIG` (`startingReputation` 0, `reputationMax` 100000, `processedAttemptLimit` 500), `CAREER_MAX_RANKS` 10.
- `src/career/careerTypes.ts`: prerequisite, event, rival, rank, milestone, and outcome types.
- `src/career/careerCatalogue.ts`: immutable ranks (5), rivals (4), events (5), milestones (5), lookups, and `validateCareerCatalogue`.
- `src/career/careerRaces.ts`: career race definitions (`career-warmup-race`, `rival-mara-race`, `rival-teo-race`, `rival-juno-race`, `rival-kai-race`) built on the Sprint and Circuit bases, with per-race markers and named opponents. `CAREER_RACE_IDS`.
- `src/career/careerModel.ts`: pure rules. `startCareer`, `trackEvent`, `applyRaceOutcome`, `normalizeCareer`, `rankFor`, `rankProgress`, `eventStatus`, `prerequisiteReasons`, `careerRaceBlock`, `rivalView`, `nextRivalTarget`, `leaderboard`, `milestoneViews`, `settleCareer`, `buildCareerView`.
- `src/career/careerService.ts`: the one progression service. Exports `createCareerService`, the `careerService` singleton, `CAREER_SESSION_ID`, `ALL_RACE_IDS`. Holds `noticeStore` (`lastOutcome`, `outcomeSeq`, `error`).
- `src/career/careerHubGate.ts`: `evaluateCareerHubGate`, the entry rule for the hub (no race running, no pursuit active).
- `src/garage/garageService.ts`: one commit path, `commitProfile(rule, intent, userFacing)`. Garage methods go through `commitGarage`.
- `src/save/saveFile.ts`: schema 2 with the career section.
- `src/race/raceTypes.ts`, `raceDirector.ts`, `raceController.ts`: optional `opponents` on events, an `onResult` callback, `entryBlock(eventId)`, and `onOutcome`.
- `src/state/careerUiStore.ts`: hub open state, tab, and selected rival.
- `src/ui/CareerHub.tsx`: the hub overlay. `src/ui/CareerLauncher.tsx`: the launcher, the hub mount, and the outcome card.
- `src/input/keyBindings.ts`: `career` action on `KeyC`. `src/render/renderLoop.ts`: pause while the hub is open, action gating, `toggleCareer`.
- `src/App.tsx`: wiring (see 22.8).
- `src/styles.css`: career styles at the end of the file.
- Tests: `src/career/careerCatalogue.test.ts`, `careerModel.test.ts`, `careerService.test.ts`, `careerRaceIntegration.test.ts`; `src/save/saveFile.test.ts` (career cases); `src/garage/garageService.test.ts` (`commitProfile` cases).
- Browser: `tools/browser-career.py` (steps `hub`, `race`, `rival`, `retry`, `reload`, `errors`). It reuses the staging and driver helpers from `tools/browser-race.py`.

### 22.3 Save data and identity

The career lives in the existing save as one section next to the garage. Its fields are: `started`, `reputation`, `completedEvents`, `unlockedEvents`, `completedChallenges`, `targetEventId`, `defeatedRivals`, `milestones`, `grantedRewards`, `processedAttempts`, and `dataVersion` (`CAREER_DATA_VERSION`). Rank is derived from reputation and is not stored.

Every key is a stable catalogue id. Display names are never keys. A processed attempt is keyed `<raceEventId>#<sessionId>.<attemptId>`. The session id is needed because attempt ids restart at 1 after a reload. Without it, a new session's first attempt would be dropped as a duplicate.

### 22.4 Reputation and ranks

- Reputation is separate from credits and has no currency role. Reputation is never negative, and it is clamped to `reputationMax`.
- Reputation comes only from awards in `careerModel.ts`: the completion reward (once per event), the objective reward (once), the defeat reward (once per rival), and the milestone reputation rule (none; milestones pay credits only).
- Ranks (`careerCatalogue.ts`): Newcomer 0 (0 credits), Street Regular 40 (200), Road Name 120 (300), Night Contender 240 (400), City Legend 380 (600). The number in brackets is the one-time credit reward when the rank is first reached.
- Rank boundaries are tested at each threshold and one reputation below it. Reputation 0 is Newcomer. A huge value stays at the top rank.

### 22.5 Events, rivals, and milestones

Events (`careerCatalogue.ts`):

| Event | Kind | Reputation | Prerequisites |
| --- | --- | --- | --- |
| Harbour Warm-Up (`career-warmup`) | race | 10, plus 5 if finished under 200 s | career started |
| Mara Quill (`rival-mara-challenge`) | rival | 0 (defeat reward 40) | Warm-Up completed, 40 reputation |
| Teo Varga | rival | 0 (defeat 70) | Mara defeated, 40 reputation |
| Juno Ashdown | rival | 0 (defeat 120) | Teo defeated, 120 reputation |
| Kai Mensah | rival | 0 (defeat 150) | Juno defeated, 240 reputation |

Rival defeat credits: Mara 400, Teo 600, Juno 900, Kai 1500. Each rival also has a vehicle, a style, a biography, and a preferred event type.

Milestones (credits only, one time each): first event 100; three events 300; two rivals defeated 300; two cars owned 250; 200 reputation 200. The event milestone counts distinct completed career events, so a replay cannot farm it.

The evaluator is one function, `milestoneViews`. A milestone is paid through `grantedRewards` when it is first met.

### 22.6 Locked reasons and the entry rule

A locked event returns a specific reason for each unmet condition. Before the career starts, every event is locked with "Start your career in the career hub first." Free-roam races are never blocked by the career.

`careerRaceBlock` is checked first in the race entry block. The pursuit check comes before it, so a pursuit still blocks every race.

### 22.7 Race outcomes

A career race result is recorded once per attempt, through `careerService.applyRaceResult`. The wiring is in `App.tsx`:

- `onOutcome` calls the service only for career race ids. Free-roam ids are never routed here, because the service would pay them.
- The free-roam `onGrant` ledger skips career race ids, so a career race is paid only once, in the career commit.
- The commit saves the career and the race credits in one write. The result card reports what was granted.

Rules, each covered by tests in `careerModel.test.ts` and `careerService.test.ts`:

- Finishing completes the event and pays its reputation. A replay pays race credits only, with no reputation and no objective again.
- A loss to a rival does not defeat it, pays no defeat reward, keeps the challenge open, and allows a retry.
- A win defeats the rival once, pays its defeat reward once, and names the next rival.
- Abort, timeout, retry, reopening the result, and a free-roam start grant nothing.
- An unknown race id, a non-positive or non-integer amount, and an invalid attempt grant nothing.
- If the save fails, nothing changes, and the result card shows the error with "Nothing was charged."

Pursuit: a career race does not start a pursuit. Defeating a rival does not clear heat or end a pursuit. There are no pursuit rewards and no notoriety.

### 22.8 The career hub and the race start

The hub (`CareerHub.tsx`) shows the rank and the progress to the next rank, reputation, the count of completed and open events, rivals beaten, the next rival, and the target. Its tabs are Events, Leaderboard, and Milestones. Its footer has Garage and Free roam.

- Start career starts the career once. A second start is refused.
- Set as target sets the tracked event and closes the hub. The player then drives to the marker and presses E. This is the only race start path. The hub never starts a race and never teleports the car.
- The leaderboard lists the standing rivals above the player in ladder order, then beaten rivals. Selecting a rival opens its challenge card, with the requirements, the defeat reward, Accept (sets the target), and Cancel (clears the target if it was this challenge).
- Garage closes the hub and sends the existing `garage` action. The garage's own entry rule decides whether it opens. This path was not checked in the browser.
- The hub opens only when no race is running and no pursuit is active (`evaluateCareerHubGate`). Opening the hub grants nothing.
- While the hub is open the loop is paused. Only C or Escape acts, and both close it.

The launcher sits bottom right, above the minimap. The outcome card sits bottom centre, above the race toast.

World markers: every career race has a beacon (`RaceVisualPool`, named `RaceMarker-<eventId>`), always drawn, as the brief asks. A locked career race still shows its approach card. Pressing E there is refused with the reason from `careerRaceBlock`. Beacons have no locked visual style. That styling is not built, and the refusal was not checked in the browser.

### 22.9 Persistence and migration

- Schema 0 and 1 migrate to schema 2, with a new career. The garage is kept.
- A missing career section is a new career, with no repair.
- A career section that is not an object is backed up before reset. Writes continue only if the backup succeeded.
- A career with a newer data version is kept untouched, and writes are disabled.
- A damaged career is repaired field by field. Invalid and duplicate ids are dropped and reported.
- `writeProfileSave` writes the garage and the career in one `setItem`.
- Career initialization never resets an existing profile.

### 22.10 Controls

| Key | Action |
| --- | --- |
| C | Open or close the career hub (refused with a reason during a race or pursuit) |
| E | Start a race from its approach card (the only race start path) |
| Q | Cancel an approach, cancel a countdown, abort a race, or leave a finished or failed result. The next race's card opens only after this. |

A finished or failed result stays on screen until it is left with Q. The launcher shows "Press Q to leave this result before the next race." This is the Part 6 rule, unchanged.

### 22.11 Tests and verification results

Automated (run for this part):

- `tsc --noEmit`: exit 0.
- `eslint .`: exit 0.
- `vitest run`: 71 files, 787 tests, all passing. The baseline before Part 9 was 67 files and 680 tests.
- Per-file counts (single-file runs): catalogue 15, `careerModel` 64 (including the rank boundaries and the locked reasons), `careerService` 11, `careerRaceIntegration` 6 (named rival opponent, free-roam label kept, one result per abort, the hub gate), save 21, garage 16 (five `commitProfile` cases: success, refusal, save failure, unchanged reference, duplicate window).
- Production build: `npm run build` succeeded: `index.js` 1,380.05 kB, gzip 387.36 kB. Part 8 was 1,345.94 kB (gzip 377.31 kB).

Browser (`tools/browser-career.py`, run against the DEV server, real keyboard and mouse input, headless Chromium):

- `hub`: 10 of 10 checks passed. Opens on C. A new player sees the intro and the locked events with reasons. Start career saves the career. The target is the warm-up. The leaderboard order is correct. Mara's card shows a disabled accept with the reason. The milestones tab works. Close and C shut the hub.
- Full sequence `hub race rival retry reload errors`: 33 of 33 checks passed. Log: `/home/user/verification/part9/browser-career_hub-race-rival-retry-reload-errors.txt`. It covers:
  - Harbour Warm-Up: approach card, E starts the countdown, the car drives to a finish. The result card shows +15 reputation (10 completion plus 5 objective), a first-result milestone, and +250 credits. The save records the event once. The balance rises by exactly the credits the card shows.
  - Mara Quill (loss branch): the approach card names the challenge. Q first leaves the warm-up result. The official result is a loss. Reputation is unchanged, and the result says no defeat is granted.
  - Retry and abort: E starts a new attempt. Q aborts it. Reputation and balance are unchanged, and the aborted attempt is recorded once.
  - Reload: the saved career, reputation, and balance are unchanged.
  - Errors: no page errors, and no console errors other than the known GL and three.js warnings.
- Screenshots in `/home/user/verification/part9/`: `H01_hub_new_player.png`, `H02_leaderboard_challenge.png`, `R01_approach_card.png`, `R02_result_card.png`, `R03_hub_after_reload.png`, `R04_rival_result.png`.

Not verified in the browser:

- A win against Mara (or any rival). The bot drives at about 12 m/s, and Mara's opponents run at 20 m/s, so the bot lost. The win path is covered by automated tests on the real commit path, not by a browser run. This is open. See 22.12.
- Rival wins on Teo, Juno, and Kai. Not run.
- A save-failure in the browser. Covered by the automated test only.
- Mobile or touch. Not applicable. The project has no touch controls.

### 22.12 Known limitations and open decisions

- Four rivals exist, not eight to twelve. The brief said to expand after the loop worked. The loop now works end to end in the browser for one rival (the warm-up and the Mara loss). The roster is deferred.
- Mara's pace is 20 m/s, scaled by difficulty 1. The planned pace was about 15 m/s so a browser bot could win. It was not changed. This is a tuning decision that also changes the player's challenge. Decision needed.
- Career race beacons have no locked visual style. Locked career events are refused at E with the reason. The locked refusal was not checked in the browser.
- The Part 6 audit reads (`RaceHud.tsx`, the rest of `GarageLauncher.tsx`, and the `toggleGarage` tail) were not re-read in this part. The new code was checked by type check, lint, tests, and the browser run instead.
- A finished or failed result stays on screen until Q (the Part 6 rule). The hub's "Set as target" therefore does not start the next race until Q is pressed. The launcher now shows that hint.
- The DEV diagnostics panel, when open, covers the career launcher and the race card on the right side in a screenshot. The panel is DEV-only and hidden in production. Not fixed.
- The career hub is available only in the city world (the world with the race controller).
- Selling, the BUSTED fairness rule, and the Step F difficulty for three rivals remain open from earlier parts (section 21.13).
- The rival tuning lives in `careerRaces.ts`, not in `src/config/`. Moving it is a tidy-up, not a behaviour change, and is deferred.

### 22.13 Process note

The code was written before this section and the report. The docs were written from the code and the test output afterward. Each claim was checked against code, a test, or a run, except the items listed as not verified in 22.1, 22.11, and 22.12.

## 23. Presentation polish: lighting, weather, audio, UI, quality (Part 10)

### 23.1 Scope and what was built
Part 10 is a polish phase. No physics, road network, race rule, police rule, or garage rule was changed. Effects read the
vehicle state and never write to it. Built:
- Lighting: one `Environment` component owns the scene lights, fog, and background. Three time-of-day presets (day,
  evening, night) blend over `TIME_OF_DAY_TRANSITION_SECONDS` (6 s), frame-rate independent.
- Weather: clear and rain. Rain is a bounded, world-anchored line field (`RainField`). Asphalt roughness follows wetness
  (dry 0.9, wet 0.4) through a registry (`surfaceRegistry`), and roads register their asphalt once.
- Division 2 lead (cliffhanger): Division 1 has an optional `lead` field (`careerCatalogue.ts`). When every open division is complete, the career hub shows it (`completedDivisionLead`, `CareerHub.tsx`), ending with "Division 2: Urban Syndicate is next." Division 2 is now built (see the Division 2 entry). Tested in `careerCatalogue.test.ts`.
- Career prompt: while the career has not started, the game shows "Press C to start career mode" at the top centre (`src/ui/CareerPrompt.tsx`). It hides while the career hub is open, once the career has started, or after the player closes it (for the session). Its rule is `careerPromptVisible` (`careerPrompt.test.ts`, 4 tests). Checked in the game page: the prompt shows with no career, C opens the hub and hides it.
- Home-to-game handoff (in-page, no page break): ENTER GAME swings the hero camera to the back view over 3 s (`handoffMoveSeconds`; a full 360° if it is already there, `cameraMove.ts`). The game mounts behind the page. A translucent loading page then holds for at least 3 s (`handoffLoadSeconds`) with one bar and tick per real step, plus the game's canvas. The game is revealed once the steps, the canvas, and the hold are done (`entryTiming.ts`, `EternixPrototype.tsx`, `CanvasProbe.tsx`, `GameLayer.tsx`). Leave (the HUD's Leave) reverses it: the loading page shows over the game for 3 s, the camera swings back to the angle the page was left at, and the game is removed 3 s after the return starts. `tools/browser-handoff.py` checks the timings from page-side logs. Known limitations: keyboard input stays live under the veil; from the garage, ENTER GAME only returns to the landing; the 360° turn is unit-tested, not browser-checked.
- Shared environment clock (home page and game): the time of day and weather change at random every 5 minutes (`ENVIRONMENT_CHANGE_SECONDS` = 300), never repeating the current pair. A fresh start is day and clear (the device clock no longer sets it). The current one is saved in localStorage (`street-racer.environment.v1`), so the two pages match. Pages pick up each other's change at once through the `storage` event (`environmentFromStorageEvent`), and the clock adopts the stored record after its own write, so the pages converge even when two pages roll in the same interval. The home stage exposes `data-environment` for the checks. `tools/browser-environment-sync.py` passed 5 of 5 (software GL runs at about 1 fps here, so the sync took up to 7 s). Rules in `src/environment/environmentModel.ts`, clock in `src/state/environmentClock.ts`, shared blend in `src/render/liveLighting.ts`. The N and M keys still change it by hand until the next minute change.
- Tire smoke: a pooled `InstancedMesh` (`TireSmokeField`), emitted only from real lateral slip, handbrake, or wheelspin
  under throttle. A stopped car emits nothing.
- Audio: WebAudio synthesis only (no audio files). One graph, five loops, one-shot cues. Engine, tyre noise, rain, and
  siren follow real state. Race and pursuit cues fire on real transitions.
- UI: one motion token set in CSS (`--motion-fast/base/slow`, `--ease-standard`), overlay fade and panel slide, focus
  rings, and reduced motion turns transitions off. A one-line status readout sits above the speedometer.
- Quality: low, medium (default), high. Presets change budgets only: pixel ratio, rain streak count, smoke particle count.
- Keys: N time of day, M weather, U quality (T and Y are taken).

### 23.2 Decisions (fixed for this phase)
- No shadow maps, and no blob or contact shadow. Shadow maps are deferred (section 23.10).
- Rain is visual only. It has no grip modifier. This is a documented limitation.
- No GSAP and no new framework. CSS and requestAnimationFrame only.
- Audio is synthesized with WebAudio. No external sound files, no audio middleware.
- Tire smoke is pooled and capped. It is emitted only from real slip, handbrake, or wheelspin.
- Audio is suspended on pause and on a hidden tab (`AudioManager.setPaused`, `visibilitychange`).
- Settings persist under `street-racer.settings`. Only quality and volume persist. Time of day and weather are session
  presentation state and reset on reload.
- Mobile: not applicable. No touch or mobile controls exist, and none were added.

### 23.3 Files
Created:
- `src/config/environmentConfig.ts`: time-of-day and weather presets, transition seconds, asphalt roughness, rain config.
- `src/config/qualityConfig.ts`: low, medium, high presets, `DEFAULT_QUALITY`, `SETTINGS_KEY`.
- `src/config/audioConfig.ts`: master gain, engine, skid, rain, siren, and cue levels.
- `src/environment/environmentModel.ts`: pure lighting blend, `stepToward`, `transitionStep`, `approach`, `nextTimeOfDay`,
  `nextWeather`, `rainStreakCount`, `lerpRoughness`, `wrapSymmetric`.
- `src/environment/environmentModel.test.ts`.
- `src/quality/qualityModel.ts`: `sanitizeSettings`, `nextQuality`, `qualityPreset`, `DEFAULT_SETTINGS`, type guards.
- `src/quality/qualityModel.test.ts`.
- `src/state/environmentStore.ts` and `environmentStore.test.ts`: target time and weather only. The live values are never
  written by UI or input.
- `src/state/qualityStore.ts` and `qualityStore.test.ts`: validated load and save under `street-racer.settings`.
- `src/audio/audioModel.ts` and `audioModel.test.ts`: `engineTone`, `skidLevel`, `sirenOn`, cue tables. Pure.
- `src/audio/audioManager.ts` and `audioManager.test.ts`: `AudioManager`, with a fake WebAudio context in the tests.
- `src/audio/audioSession.ts`: `getAudioSession` singleton and `disposeAudioSession`.
- `src/render/Environment.tsx`: lights, fog, background, and the per-frame blend.
- `src/render/rainField.ts`: `RainField`, one `LineSegments` with a fixed buffer, and `seededUnit`.
- `src/render/tireSmokeModel.ts` and `tireSmokeModel.test.ts`: `smokeLevel`, `emitCountFor`, `SmokePool` (a ring pool).
- `src/render/tireSmokeField.ts`: `TireSmokeField`, the `InstancedMesh` writer.
- `src/render/TireSmoke.tsx`: thin React wrapper; the field is rebuilt only when the quality budget changes.
- `src/render/effectFeed.ts`: plain per-tick numbers from the render loop to effects. No React state.
- `src/render/surfaceRegistry.ts`: asphalt registration and wetness.
- `src/render/PresentationProbe.tsx`: DEV only. Installs the read-out.
- `src/render/surfaceAndEffects.test.ts`: registry, rain field, and smoke field tests.
- `src/diagnostics/presentationDebug.ts`: DEV read-out (`window.__STREET_RACER_DEBUG__.presentation()`). Read only.
- `src/ui/PresentationStatus.tsx`: the status line.
- `tools/browser-presentation.py`: browser harness for this phase (section 23.11).

Modified:
- `src/App.tsx`: canvas `dpr` from the quality preset. Removed the old `<color>`, `<fog>`, and `SKY_COLOR`. Added `PresentationStatus`.
- `src/render/RenderLayer.tsx`: removed the old ambient and directional lights. Added `<Environment/>`, `<TireSmoke/>` inside
  `SimRoot` (which flips z, so smoke is in the car's frame), and the DEV probe.
- `src/render/renderLoop.ts`: writes `effectFeed`, calls `tickAudio` (engine, skid, rain, siren, race cues, pursuit
  siren cue, volume), and handles N, M, U. Menu actions (garage, career, N, M, U) play the UI click.
- `src/render/RoadNetworkScene.tsx`: registers the asphalt material (`registerAsphalt`) and removes it on dispose.
- `src/input/keyBindings.ts`: `timeOfDay` (N), `weather` (M), `quality` (U).
- `src/ui/Hud.tsx`: the controls hint lists N, M, and U.
- `src/diagnostics/devHooks.ts`: `presentation?` field on the DEV API.
- `src/styles.css`: motion tokens, status line, overlay and panel transitions, focus rings, reduced motion.
- `PROJECT_CONTEXT.md` (this section) and `FINAL_REPORT.md` (Part 10 section).

### 23.4 Architecture and rules
- One loop. Effects and audio run inside the existing `renderLoop.tick`. No second loop was added.
- Simulation is independent of React. Stores hold targets and settings. The render loop reads them each tick.
- Presentation reads vehicle state (pose, speed, slip, handbrake, wheel spin) and writes nothing back. `effectFeed` is the
  only channel to effects.
- Disposal: `RainField.dispose`, `TireSmokeField.dispose`, the asphalt unregister, `AudioManager.dispose` (stops loops,
  closes the context, removes listeners). Repeated transitions were checked for leaks (section 23.11).
- Bounded counts: rain streaks are capped by the preset (180, 500, 1100). Smoke is capped by the preset (0, 36, 72), with a
  ring pool. The mesh is sized once for the largest preset and is rebuilt only when quality changes.
- Lighting uses declarative R3F (`<fog>`, background `<color>`), updated through refs in `useFrame`.
- Audio uses one graph. Loops are created once, and only their parameters change.

### 23.5 Controls
- N: cycle day, evening, night. The change blends over 6 s.
- M: toggle clear and rain. The change blends over 4 s.
- U: cycle quality low, medium, high. Saved under `street-racer.settings`.
- Existing controls are unchanged. T and Y are not used.

### 23.6 Quality presets
| Preset | Max pixel ratio | Rain streaks | Smoke particles |
|---|---|---|---|
| low | 1 | 180 | 0 |
| medium (default) | 1.5 | 500 | 36 |
| high | 2 | 1100 | 72 |

Quality never changes vehicle physics, race rules, or the garage preview.

### 23.7 Measurements (recorded in the browser, this phase)
Environment: headless Chromium through Playwright, DEV server, software WebGL (SwiftShader), 1280x760.
- Renderer, medium, with rain (median of 15 samples): 50 draw calls, 129,196 triangles.
- Renderer, high, with rain: 50 draw calls, 130,492 triangles.
- Renderer, low, with rain: 62 draw calls, 128,264 triangles. The draw-call count varies with what is on screen. It was not
  attributed to the preset. Rain and smoke are each one draw call.
- Renderer, medium, clear: 49 draw calls, 129,196 triangles.
- Frame rate: about 4.2 to 4.4 fps. This is software rendering and is not representative of a GPU. Real frame times are
  unmeasured.
- Pre-Part-10 baseline: not captured. The working tree is uncommitted, so there is no separately measured build before
  this phase. The bundle size comparison is the only before and after number: 1,380.05 kB (gzip 387.36 kB) at Part 9,
  and 1,399.79 kB (gzip 394.06 kB) now.
- Smoke: peak 16 live puffs at medium, under handbrake and steer, against a budget of 36. Zero live puffs after the slip
  ends.
- Rain at medium: 499 streaks at full wetness (budget 500). Asphalt roughness 0.401 when wet.
- Memory: over five cycles of hub, garage, N, and M, geometries 80 to 80, textures 1 to 1, programs 9 to 9, audio loops 5
  to 5. Canvas count 2 to 2. The garage preview canvas is added on open and removed on close.

### 23.8 Tests
Automated (`npx vitest run`, all in Node, no WebGL):
- Full suite: 79 files and 876 tests pass. Part 9 baseline was 71 files and 787 tests.
- New in Part 10: environment model, quality model, quality store, environment store, audio model, audio manager (fake
  context), tire smoke model, and the render helpers (asphalt registry, rain field bounds, smoke field).
- Covered: lighting blend, transitions, `approach` frame-rate independence, `wrapSymmetric`, N and M cycles, rain count
  bounds, quality validation and repair, persistence failure handling, engine and skid bounds, siren gating, cue bounds,
  pause and hidden-tab suspension, one graph and no duplicate loops, dispose and listener removal, smoke gating by real
  slip, bounded ring pool.
- `tsc --noEmit`: exit 0. `eslint .`: exit 0.
- Production build: `npm run build` exit 0. `index.js` 1,399.79 kB, gzip 394.06 kB. Vite warns that a chunk is above 500 kB
  (existing warning, unchanged in kind).

Browser (`tools/browser-presentation.py`, real keyboard and mouse, the DEV read-out): 55 of 55 checks pass on the final
code, in one full run. Report: `/home/user/verification/part10/presentation-report.json`. Screenshots are in the same folder.
- Start: day, clear, medium default, renderer drawing, no rain, status line text.
- Light: N moves to evening (background `#d99a73`) and night (background `#161c2f`, luminance 0.110 against 0.740 for day).
  The cycle returns to the day background.
- Weather: M turns rain on, with 499 streaks and wet asphalt.
- Smoke: handbrake and steer put smoke on screen. The smoke stops after the slip ends. The pool stays within budget.
- Audio: the context runs after the first key. Five loops. Engine pitch rises from 48 Hz to 90 Hz at 55 km/h. Rain gain
  follows rain. Pause suspends, resume runs, no cue is queued on resume. A hidden tab suspends, and shown again it resumes.
- Race: E starts the race (4 cues: countdown and GO). The race is driven to FINISHED with the keyboard, with total cues 7
  (countdown, GO, two checkpoints, finish). Q on the result returns to free roam.
- Siren: a pursuit starts from the real offence path (INITIATING). The siren is on, with one start cue. Reset ends the
  pursuit and the siren goes off.
- UI: the career overlay uses `overlay-in`, and the panel uses `panel-in`. The status line stays. Under
  `prefers-reduced-motion: reduce`, the overlay animation is `none`.
- Repeat: five cycles leave geometries, textures, programs, and audio loops unchanged. The canvas count is the same.
- Quality, at device scale factor 2: medium renders at pixel ratio 1.5, high at 2, low at 1. The choice is stored under
  `street-racer.settings` and survives a reload.
- Errors: no page errors and no console errors beyond the known GL and three.js warnings.

Harness notes (bugs in the harness, not the game, all fixed in the harness and documented): the pursuit snapshot lags the
live state by about one second, so the siren is checked on the audio read-out and the snapshot is waited on. Q during
`RACING` is an abort into `FAILED`, so the harness presses Q twice (abort, then leave). Both are real game rules.

### 23.9 Bugs found and fixed in this phase
- `TireSmoke` passed the literal `35048` to `setUsage`. Replaced with three's `DynamicDrawUsage`.
- Lint: the React compiler rejected direct scene mutation in `Environment`, and mutation of a hook-captured rain buffer.
  Fixed by declarative fog and background, and by moving the rain buffer into `RainField`. The smoke buffer moved into
  `TireSmokeField` in the same way.
- The smoke read-out reported zero live particles. The field never wrote its live count to the mesh's `userData`. Found
  by the browser check, which was reading zero. Fixed. The earlier smoke result is not claimed.
- The browser siren check read the audio state and the pursuit snapshot at the same moment, and the snapshot lags. Fixed
  in the harness with waits on the state.
- The first rain toggle uploads the one rain geometry and one program to the GPU, which adds 1 geometry and 1 program
  once. This is not growth, and the repeat check now warms up before it counts.

### 23.10 Known limitations and deferred work
- No shadow maps. Deferred. No blob or contact shadow (not planned).
- Rain is visual only. It has no grip change, and rain does not affect physics.
- Night readability: at night the car body is close to the road colour, and the headlights do not light the road. The car
  is hard to read in the dark. Deferred: headlight glow, a real light source on the car, or a darker road ramp.
- Time of day and weather reset to day and clear on reload. Only quality and volume persist.
- Volume: the store, persistence, and master gain exist, and the default is 0.7. There is no volume key or UI control. This
  is deferred.
- Menus and audio: the UI click is queued by the garage, career, N, M, and U actions. The game pauses while the hub or garage
  is open, and audio is suspended while paused. From the code, the click on open may be cut short by that suspend, and the
  click on close is skipped because the game is still paused at that point (`cue` returns while paused). Neither was
  measured by ear or by the browser checks, so both are unverified.
- Audio output was verified by state, gain, and frequency read-outs, and by the fake-context unit tests. No one has
  listened to the synthesized sounds. Subjective quality is unverified.
- Frame rate was measured only with software rendering (about 4 fps). Real GPU frame times, GPU memory, and battery or
  thermal behaviour are unmeasured.
- No pre-Part-10 renderer baseline (section 23.7).
- A large blue shape was visible in the foreground of the rain screenshot. It was not identified. It is probably a traffic
  vehicle close to the camera. It is not yet confirmed.
- Not built in this phase, although listed in the stage plan: collision feedback (no new impact effects or sounds), and
  any camera or vehicle-animation change. The existing speed-based FOV, acceleration lag, and speed shake were kept as they
  were. The car's body and suspension animation is unchanged. Only the asphalt material changed (wetness). The headlight
  and taillight materials and the other road materials are unchanged.
- The "vehicle animation and camera respond to real driving" and "materials improved" definition-of-done items are
  therefore only partly met (see the final report).
- Mobile: not applicable. No touch or mobile controls exist.
- The commit scope of the uncommitted working tree is still open (user decision).

### 23.11 Regression and process
- Regression runs for the existing systems are recorded in section 23.12.
- Part 10 browser checks are in `tools/browser-presentation.py`. The default run covers every step in order.
- Stop point: Part 10 is complete. Part 11 was not started.

### 23.12 Regression results (existing systems)
Run on the final Part 10 code, with the DEV server, real keyboard and mouse input, and headless Chromium. Logs and reports
are in `/home/user/verification/part10_regress/`.
| Harness | Steps | Result |
|---|---|---|
| `tools/browser-career.py` | default (hub, race, rival, retry, reload, errors) | 33/33 |
| `tools/browser-garage.py` | default | 24/24 (after one harness fix, below) |
| `tools/browser-race.py` | C D E errors | 35/35 |
| `tools/browser-pursuit.py` | default (boot, trigger, pursue, escape, reset, errors) | 33/33 |

Harness fix: `browser-garage.py` asserted `schemaVersion == 1`. The save has been schema 2 since Part 9, so the Part 8
expectation was stale. The check now asserts the current version (2). The first garage run was 23/24 because of this one
check. The game was not changed.

Not run in this phase: `browser-race.py J` and `R` (they are opt-in and were not part of the Part 10 regression set),
`browser-road.py`, and `browser-smoke.py`. Their status is unverified in Part 10.


## 24. Release readiness (Part 11)

Part 11 is final integration, regression, deployment configuration, and release readiness. No features were added. Fixes
are limited to verified problems. The release recommendation and the evidence for it are in `FINAL_REPORT.md`, Part 11.
Everything below was checked in this sandbox (Node 20.20.2, npm 10.8.2, Playwright 1.64.0 with headless Chromium,
software WebGL). Nothing was run on real hardware, real audio output, Firefox, Safari, or a GitHub Pages site.

### 24.1 Feature status (audit)

Implemented and verified in the browser on the final code:
- Driving: throttle, brake, reverse from standstill, steering both ways, handbrake, reset (R), pause (Esc, Pause button), focus loss releasing keys (`smoke_legacy`, `browser-release` drive/focus/pause).
- City, traffic, minimap: `browser-city` 24/24, `browser-traffic` 20/20. Minimap labels checked from one screenshot (section 24.5).
- Races: Sprint and Circuit, pause, resume, reset, rewards (`browser-race` C/D/E 35/35, R 10/10, J 11/11).
- Police pursuit: `browser-pursuit` 34/34 on two consecutive runs (after the harness fix in 24.8).
- Garage: purchase, select, paint, upgrade (`browser-garage` 24/24).
- Career: warm-up, rival outcome, reload persistence (`browser-career` 33/33; see 24.11 on the branch).
- Presentation: time of day, weather, quality, audio state, pause and hidden-tab suspension (`browser-presentation` 55/55).
- Save recovery: corrupt save, newer save, full storage, blocked storage (`browser-release`, four steps).
- Responsive layout: no horizontal overflow and HUD panels inside the viewport at 390×844, 768×1024, 1280×720, 1920×1080.

Partial (implemented with a documented gap):
- Audio: the context reaches `running` after a key press and suspends on pause and hidden tab. Sound was not heard.
- Circuit lap: the keyboard test driver leaves its 3.0 m lane tolerance on some runs (24.11). Not a product fault measured.
- Garage preview: each open creates a new WebGL canvas, and the JavaScript heap grows about 0.45 MB per open (24.6).
- Volume: stored and applied (0 to 1), but there is no on-screen control.
- Rain: visual only, no grip effect (section 23).

Missing or out of scope (documented, not blocking):
- Touch and mobile controls (none exist; none added). Shadows and blob or contact shadows (deferred, section 23).
- Selling vehicles. Multiplayer. Accounts and cloud saves. A larger rival roster (one chain exists).
- A GitHub Pages deployment (the workflow exists; it has not been run).

### 24.2 Checks run (final code)

| Check | Result |
|---|---|
| `npm ci` | pass, 205 packages (earlier in Part 11; no dependency change since) |
| `npm run typecheck` | pass, exit 0 |
| `npm run lint` | pass, exit 0 |
| `npm test` | pass, 79 files, 880 tests |
| `npm run build` | pass. JS 1,400.58 kB (gzip 394.47 kB), CSS 16.23 kB. Vite size warning |
| `npm run check` | pass, exit 0 (typecheck, lint, tests, build) |
| `npm audit` and `npm audit --omit=dev` | 0 vulnerabilities each |

Browser checks, final code (`verification/part11/edited/`, `release/`):

| Harness | Result | Note |
|---|---|---|
| `browser-smoke.py` (legacy) | 60/60 | Listener counts 1 each. A harness check was corrected (24.8) |
| `browser-road.py` (circuit) | 24/25 | Lap lane check 5.64 m (limit 3.0 m). Known test-driver limit |
| `browser-traffic.py` | 20/20 | |
| `browser-city.py` | 24/24 | |
| `browser-garage.py` | 24/24 | |
| `browser-career.py` | 33/33 | Rival loss branch. Baseline run took the win branch (34/34) |
| `browser-race.py` C D E errors | 35/35 | |
| `browser-race.py` R | 10/10 | |
| `browser-race.py` J | 11/11 | |
| `browser-pursuit.py` | 34/34 | Two consecutive runs (after harness fix) |
| `browser-presentation.py` | 55/55 | Audio running after first key, suspend on pause and hidden tab |
| `browser-release.py` | 54/55 | Only failure: cycles heap check (24.6). Boot, drive, focus, pause, corrupt, newer, quota, nostorage, resize, errors pass |
| `browser-release.py nowebgl` | 2/2 | Start-up message names WebGL |

Pre-edit baseline (frozen snapshot, `verification/part11/baseline/`): smoke 58/60 (two listener checks failed, the defect
fixed in 24.4), road 23/25, traffic 20/20, city 24/24, garage 24/24, career 34/34, race CDE 35/35, R 10/10, J 11/11,
pursuit 33/33, presentation 55/55. The road harness exited 0 with two failed checks (24.8).

Production preview (`npm run preview`, 4173): `browser-prod.py` 7/7 (boot, drive, reset, no page or console errors, no failed assets).

Static hosting probe (`verification/part11/probe_static.py`, `static_probe.json`): root and subpath (`/street-racer/`)
both boot, show the HUD, refresh, and produce no failed requests or page errors. `file://` does not work: Chromium blocks
the module script and stylesheet (CORS).

### 24.3 Regression of the journey and lifecycle

- Fresh launch: boot checks in `browser-release` (title, canvas, HUD RUNNING, 0 km/h, 1,500 credits, no errors, no failed
  requests).
- Listeners: after the fix, exactly one window keydown, keyup, blur, and visibilitychange listener (smoke counts). Before
  the fix, AudioManager added its own, so the counts were 2.
- Loops: one render loop. Pause freezes the car (smoke) and race timing (race C and R). Resume does not restart the
  countdown (race C).
- Input locks: held keys are released on blur and hidden tab (smoke, release focus). Driving keys are ignored while a menu
  button has focus (smoke).
- Restart and reload: career progress persists across reload (career reload checks). Race and pursuit state is not saved
  (by design, read from the save code, not separately browser-tested).

### 24.4 Fixes made in Part 11 (verified)

1. `vite.config.ts`: `base` is `'./'` for build and `'/'` for dev, so the build works at a root or a subpath (probe, 24.2).
2. `index.html`: title "Street Racer".
3. `src/render/renderLoop.ts` `tickAudio`: race and pursuit cue tracking runs before the pause return, so a change during a
   pause is recorded and not played late. The cue function ignores requests while audio is paused.
4. `src/audio/audioManager.ts`, `audioSession.ts`, `src/input/inputController.ts`, `src/App.tsx`: AudioManager no longer
   adds window or document listeners. Unlock runs each frame through `tryUnlock(pageHasUserActivation())`. Visibility is
   passed through `InputController`'s `onVisibilityChange`. App has an audio-dispose cleanup effect. Tests:
   `audioManager.test.ts` and `inputController.test.ts` rewritten (54 tests in these two files pass).
5. `src/ui/Minimap.tsx`: a landmark label that would run past the right edge is drawn to the left of its marker. Seen in
   `verification/part11/minimap.png` (Northgate Mall flipped; the rest inside the map).
6. `src/ui/StartupBoundary.tsx` and `src/main.tsx`: a start-up failure shows a message (`.startup-error`) instead of a blank
   page. Checked by `browser-release nowebgl`.
7. `src/ui/GarageLauncher.tsx` and CSS: a visible save notice (`p.garage-save-notice`, role status) outside the garage
   overlay, so the "not saved" and newer-save messages are seen when the garage is closed.
8. `src/save/saveFile.ts` and `saveFile.test.ts`: a garage section that is missing or not an object is copied to the backup
   key before the default garage replaces it, the same as the career section. Writes stay on only if the copy worked.
   Two tests added (23 tests in the file pass). Before this, the next write erased the player's garage without a copy.
9. `.github/workflows/deploy-pages.yml`: new. Node 22, `npm ci`, `npm run build`, upload `dist/`, deploy. Not run.

### 24.5 Measurement and visual checks

- Frame rate: not measured in a meaningful way. Headless software rendering runs at about 4 fps and is not representative.
  No FPS figure is claimed.
- Heap: measured with forced GC through CDP (sections 24.6 and below). Numbers are from this headless run only.
- Load: bundle sizes from the build output only. No load-time measurement was made.
- Minimap: one screenshot inspected (24.4 item 5).

Unmeasured, with a manual procedure for the developer:
- Frame time and FPS on a real GPU: open the game at 1920×1080 in Chrome, DevTools Performance, record 20 s of driving in the city (Sprint or free roam), read the frame interval. Repeat at medium and high quality (key U).
- Memory after garage cycles on a real GPU: DevTools Memory, take a heap snapshot after 5 and after 15 garage open and close cycles (key V). Compare the retained size.
- Audio: listen in a real browser at each quality setting (keys U) and check the siren and race cues.
- Mobile: none (no touch controls exist).

### 24.6 Known issues (recorded, not fixed in Part 11)

- **Garage preview memory.** Each garage open mounts a new React Three Fiber `<Canvas>` (`src/ui/GaragePreview.tsx`). Forced-GC heap
  grew +3,485 kB and +3,568 kB after five garage and career cycles in the two final runs. Probe `probe_heap.py` (deltas
  against a warm-up, after 4, 8, and 12 cycles): garage cycles +2,378, +4,369, +6,158 kB; career cycles +550, +833, +1,177 kB;
  idle +1,902, +1,661, +1,766 kB (idle levels off after the first window). A temporary bisect that replaced the preview canvas
  with a placeholder gave garage cycles +524, +719, +1,027 kB. The file was then restored and verified byte-identical. R3F releases the renderer and removes its root on
  unmount, and the DOM does not keep canvases (`probe_dom.py`), so the retained object is not yet identified. The fix is a
  design choice: keep one preview canvas for the session (a permanent WebGL context) or find the retained reference.
  Left failing in `browser-release` on purpose.
- **Save backup overwrite.** A second unreadable save replaces the earlier backup copy. Only the latest copy is kept.
- **Unknown top-level object as garage (schema 0).** A parsed object with no `schemaVersion` is read as a garage. Missing
  fields are repaired with a notice, with no backup copy. Read from code; not browser-tested.
- **Volume.** Stored and applied, no on-screen control.
- **THREE.Clock warning.** Upstream. `three` 0.186.1 `Clock` warns on construction, and `@react-three/fiber` 9.8.2 creates one
  in its root store (`node_modules/@react-three/fiber/dist/events-*.esm.js`). The game does not create a clock. Not patched.
- **Circuit lap lane check.** `browser-road.py` lap: lane error 3.05 m (Part 3), 3.77 m (baseline), 5.64 m (final). The
  limit is unchanged. Keyboard-driven lap tracking depends on frame rate. Reported as a test-driver limit, not a measured
  product fault.
- **Rain.** Visual only (section 23).
- **Console messages in the sandbox.** GL driver and GPU stall messages from SwiftShader. Not game errors.

### 24.7 Deployment

- `base` is `'./'` in the build. Asset paths in `dist/index.html` are relative (`./assets/…`). The same `dist/` works at a root
  and at a subpath (`/street-racer/`), verified with a static server (24.2).
- No client-side routes. The game is one page with query strings (`?world=`). Refresh works.
- No server code, no secrets, no environment variables. `.env` is git-ignored.
- DEV-only code: the debug panel, road debug, overview, traffic reset, and DEV reset pose are gated by DEV checks (the
  key bindings are inert in production; section 24.2 bundle check). The bundle still contains their names as strings (`toggleRoadDebug`, `roadDebugVisible`, `trafficReset`,
  `devReset`, key codes). `__STREET_RACER_DEBUG__`, `DEV DIAGNOSTICS`, `installRaceDebug`, `placeAheadOfUnit`, and
  `debug panel` are absent from the bundle.
- GitHub Pages: the workflow exists and has not been run (no remote in this sandbox). The live URL was not tested.

### 24.8 Harness changes (test tools, not game code)

- `tools/browser-road.py`, `browser-city.py`, `browser-pursuit.py`: exit status now reflects the checks. Before, road and city
  always exited 0, and the baseline road run reported two failures with exit 0.
- `tools/browser-smoke.py`: the brake check flagged reverse that starts from a stop. Standstill reverse passes through the
  neutral band (|v| under 0.1 m/s, `getDriveDirection`), so it was not a jump. The check now flags a jump from above +0.1 to
  below −0.1 m/s between two samples. This matches the physics comment "forward braking stops exactly at zero".
- `tools/browser-pursuit.py` reset step: the reset step reloads the page first (fresh cooldown and patrol state) and stages
  up to five times, logging each retry. The earlier staging failed because a witness left sight, or the offence was
  refused during cooldown. Those cases are reported as staging failures, not reset failures.
- `tools/browser-release.py`: new. The focus check now compares speed at +0.5 s and +1.5 s after a blur, because the pedal
  releases over about 0.2 s and the HUD publishes every 0.1 s. A measurement in `probe_blur.py` confirmed the pedal reaches 0
  and the car coasts.

### 24.9 Input, accessibility, responsive

- Input: driving keys stop on blur and on hidden tab (smoke, release focus). Keys are ignored while a menu button has focus.
- Responsive: four viewports checked for horizontal overflow and HUD placement (release resize). No touch controls exist.
- Accessibility: buttons and the garage notice have labels and roles. No formal accessibility audit was done. Not claimed.

### 24.10 Error handling, hygiene, dependencies

- Start-up failure (no WebGL) shows a message (24.4 item 6).
- Storage failures are handled (24.4 item 8 and section 21). Settings writes are ignored when storage fails (`qualityStore`).
- `src` has no `eval`, no `innerHTML`, no `fetch(`, and no external URLs (grep, earlier in Part 11).
- Dependency audit (final tree): 0 vulnerabilities, production and full tree. No actionable items.
- Licences read from `node_modules/*/package.json`: react, react-dom, three, @react-three/fiber, zustand, vite, vitest,
  @vitejs/plugin-react, eslint, typescript-eslint are MIT. typescript is Apache-2.0. Not verified: the `.claude/` skill files.

### 24.11 Career branch note

`browser-career.py` takes a win or loss branch depending on the race outcome. The baseline run took the win branch
(34 checks, reputation 15 → 55, Mara defeated, +40 reputation). The final run took the loss branch (33 checks, Mara not
defeated, +180 credits for second place, reputation unchanged). Both branches pass their own checks. The count changed with
the outcome, not with the code.

### 24.12 Release recommendation

Ready for limited testing. No blocking defect was found. The garage preview memory growth (24.6) is not blocking for limited testing, but it should be fixed before a wider release. Known issues: 24.6. Commit scope is the developer's decision. Parts
4–11 are uncommitted (HEAD `aade3ab`).

## 25. Car overhaul: 20 vehicles (Part 12)

Status: **implemented and partly verified.** Not complete: see "Not verified" below.

### 25.1 Roster
Twenty catalogue entries, roster order 01 to 20. Seven legacy ids are kept (no save migration); the other thirteen are new.

| # | Name | id | Tier | Price (cr) | Unlock (career rank) | Class |
|---|---|---|---|---|---|---|
| 01 | Finch S1 | kestrel-hatch | starter | 0 | Newcomer (start) | Hatchback |
| 02 | Vesper C2 | vesper-c2 | starter | 700 | Newcomer | Compact coupe |
| 03 | Rook RS | rook-rs | starter | 950 | Newcomer | Hot hatch |
| 04 | Ember GT | ember-gt | starter | 1,300 | Newcomer | Grand tourer |
| 05 | Strata S | strata-s | starter | 1,700 | Newcomer | Sport sedan |
| 06 | Vandal R | vandal-r | street | 2,400 | Street Regular (40) | Muscle |
| 07 | Nightfall GT | halcyon-gt | street | 2,900 | Street Regular | Grand tourer |
| 08 | Kestrel MR | kestrel-mr | street | 3,400 | Street Regular | Mid-engine |
| 09 | Talon V8 | grit-coupe | street | 3,900 | Street Regular | Muscle coupe |
| 10 | Meridian XR | meridian-xr | street | 4,400 | Street Regular | Performance crossover |
| 11 | Phantom LX | phantom-lx | advanced | 5,000 | Road Name (120) | Luxury GT |
| 12 | Apex T | apex-t | advanced | 5,600 | Road Name | Track car |
| 13 | Voltaris E | volt-e | advanced | 6,000 | Road Name | Electric |
| 14 | Sovereign S | bastion-sedan | advanced | 6,500 | Road Name | Luxury sedan |
| 15 | Zephyr R | tarn-roadster | advanced | 7,000 | Road Name | Roadster |
| 16 | Obsidian X | obsidian-x | elite | 7,600 | Night Contender (240) | Hypercar |
| 17 | Tempest R | tempest-r | elite | 8,100 | Night Contender | Track coupe |
| 18 | Havoc AWD | havoc-awd | elite | 8,600 | Night Contender | All-wheel drive |
| 19 | Solstice LM | solstice-lm | elite | 9,000 | Night Contender | Endurance GT |
| 20 | Zenith One | zenith-one | ultimate | 9,500 | City Legend (380) | Ultimate hypercar |

Display names are new; ids are the stable keys. Two ids do not match their names, and the ids are kept on purpose: "Talon V8" is `grit-coupe`, and "Nightfall GT" is `halcyon-gt`.

### 25.2 Data and code
- `src/config/vehicleCatalogue.ts`: 20 entries (stable id, roster, name, tier, class, price, `requiredRankId`, handling overrides, factory paint, `upgradeSupport`, summary).
- `src/config/vehicleDesigns.ts`: 20 design profiles and `DESIGN_LIMITS` (roof <= 1.45 m, body bottom >= 0.2 m).
- `src/vehicles/designProfile.ts`: profile type, `validateDesign` (station rules, cabin clearance, tyre width, hex colours, and the spoiler rule: the cabin must start at t >= 0.2).
- `src/render/vehicleModel/` (`loft.ts`, `loftGeometry.ts`, `bodyParts.ts`, `partTypes.ts`): body lofts from station tables, greenhouse, lights, aero, wheels. Procedural only.
- `src/render/vehicleLayout.ts` and `src/render/VehicleVisual.tsx`: layout parts and meshes. Paint applies to the body role only.
- `src/vehicles/performance.ts`: performance index, tier bands, and garage ratings (1 to 10).
- `src/garage/vehicleUnlock.ts`: unlock rule against `CAREER_RANKS`. `garageService.purchaseVehicle` refuses a locked car with `locked-rank` before any charge.
- `src/ui/Garage.tsx`: filters (All, Owned, Available, Locked), status per row, rank reason, purchase confirmation, four ratings, specs, upgrades, paint.
- `src/ui/GaragePreview.tsx`: 3D preview with Turn, 3/4, Front, Side, Rear views. Disposes geometry on change and on unmount. Falls back to text when the 3D preview fails.

### 25.3 Performance and stats
- All cars share one hull: 4.5 x 1.85 m, wheelbase 2.7 m, track 1.6 m, wheel radius 0.33 m. Visual variety comes from design profiles and handling.
- Stats come only from `deriveEffectiveSpecs` and `SPEC_LIMITS`. No per-car physics. The garage and the driven car read the same config.
- **Deviation:** the brief's bands (1.00 to 2.30) cannot be reached inside `SPEC_LIMITS` (composite ceiling about 1.42). The compressed index is used: T1 1.00 to 1.10, T2 1.10 to 1.20, T3 1.20 to 1.28, T4 1.28 to 1.34, ultimate 1.34 to 1.40. The validator and the roster test enforce these. Widening `SPEC_LIMITS` is a separate task.
- Simulation driving table (`src/vehicles/carDriving.test.ts`, the real `stepVehicle` with each car's config): 0 to 100 km/h from 4.8 s (Finch) down to 2.9 s (Zenith One). Top speed 218 to 273 km/h, and braking from 25 m/s is 13.9 to 19.3 m. Full table: `/home/user/verification/car-overhaul/driving-table.md`.
- Top speeds are high for street cars. They are what `SPEC_LIMITS` allows, and were not changed here.
- Voltaris E (13) reaches 100 km/h slightly before Zenith One (20) because of its higher acceleration rating. The ultimate car leads on top speed and braking.
- Zenith One's `upgradeSupport` is engine and tires only. Brakes and transmission are at or near their limits.

### 25.4 Verification (results from this pass)
- `npm run check` (final run of this pass): typecheck, lint, tests, and build all pass (exit 0). 85 test files, 992 tests, build succeeds.
- Unit: loft volume and outward faces, `loftSurfaceZ`, design validation, body-part checks for all 20 (required parts, finite values, feature-to-part consistency, hull bounds), layout (four wheels, track, radius, pivot), roster (ids, order, names, tiers, ranks, prices, bands, neighbour separation, unique ratings), unlock rules, locked-rank refusal, switching clamp, and the crossover (Voltaris E leads at 3 s, Zenith One from 15 s).
- Visual: `tools/car-gallery.py` captured all 20 cars in the garage preview in four views (80 images) in the running app: 44/44 checks, no page or console errors. Contact sheets in `/home/user/verification/car-overhaul/`.
- In-game driving: `tools/browser-cars.py` seeds a save owning and selecting each car, drives it with W and S, and reads the simulation clock. Five cars (Finch S1, Vandal R, Phantom LX, Obsidian X, Zenith One) reach 100 km/h, stop from about 25 m/s, and report no errors. The in-game 0 to 100 times are 0.2 to 0.6 s above the simulation table. The tolerance is 0.5 s, and one car (Phantom LX) missed it on a second run (4.10 s against 3.5 s). This is not resolved. The headless frame rate and keypress timing make single runs noisy.
- Browser regression (`tools/browser-*.py`, DEV app), this pass: garage 25/25 (includes buying Rook RS with confirmation, upgrade, paint, persistence, and the drive refusal); career 33/33; race C D E errors 35/35; race R J 19/19; pursuit 34/34; presentation 55/55; traffic 20/20; city 24/24; road 24/25 (the known keyboard-driver limit); smoke 58/60 then 59/60 (see 25.5); release 54/55 (`cycles` fails by design: heap grows by about 5 MB over five cycles, a known issue).

### 25.5 Not verified / known issues
- **Look-alike pairs.** At gallery scale, these look alike: Vandal R, Talon V8, and Sovereign S; Ember GT and Tempest R; Voltaris E and Nightfall GT. The pairwise test passes (at least 2 discrete features or 0.03 m silhouette difference), so the difference is real but small. Not fixed.
- **Glass and roof.** The glass was too dark (fixed: `#3a5b70`). The flat roof slab still reads as a tray over the rounded greenhouse. Not fixed.
- **Smoke brake check.** `brake from speed decelerates to a stop before reversing` flags a small negative speed (-0.5 to -0.6 m/s) when S is held after the stop. This is a known check-criterion issue (see the Part 11 notes). Not changed.
- **Smoke Escape check.** `Escape still pauses while a control has focus` failed once and passed on the rerun. Timing-dependent. Not explained.
- **Race R and J.** This pass counted 19 checks. An earlier Part 11 run counted 21 (R 10, J 11). The difference is not explained.
- **Switching memory.** Not tested. The brief requires a repeated-switch memory test. Not done in this pass.
- **Per-car in-game driving.** Five of the twenty cars were driven in the game. The other fifteen were checked in simulation and in the garage gallery only.
- **Prices.** Not checked against measured full-career credits.
- **Garage memory.** The known heap growth in the garage (Part 11) is unchanged.

## 26. Career expansion: Division 1 (this phase)

Scope and decisions are in `CAREER_EXPANSION_PLAN.md`. This section records what is built and verified. Divisions 3 to 5 are planned only; Division 2 is built.

### 26.1 Status

- **Built and playable:** Division 1, Street Origins. Four races plus one rival challenge, the Street Origins Cup, the division completion reward, best times, and the police escape milestone.
- **Planned, not built:** Divisions 3 to 5 (names, intros and requirement text only; no events, no rivals). The hub shows them as "Not in this build".
- **Not built:** the 15 to 20 rival ladder (the career has the four original rivals: Mara Quill, Teo Varga, Juno Ashdown, Kai Mensah), the five rival crews, high-speed runs, drift challenges, survival or endurance, a police event beyond the escape milestone, vehicle-tier reward gating, and chunk preloading.
- **Full career completion is not claimed.** Only Division 1 has content.

### 26.2 Division 1 and rewards

| Item | Rule | Reward (once) |
| --- | --- | --- |
| Harbour Warm-Up | Sprint, finish. Objective: under 200 s | 10 rep, +5 objective, 150 cr race |
| Block Laps | Circuit, two laps, one racer, finish | race reward 200 cr (cup points) |
| Checkpoint Run | Checkpoint, 150 s limit, one racer, finish | race reward 250 cr (cup points) |
| Clock Run | Time attack, no opponents, finish | 15 rep, race reward 100 cr |
| Mara Quill: Dock Run | Rival challenge, win | defeat: 40 rep, 400 cr |
| Street Origins Cup | Warm-Up, Block Laps and Checkpoint Run all finished | 30 rep, 400 cr |
| Division completion | All five events, the cup, and Mara's defeat | 50 rep, 500 cr |
| Shake the Tail | One police escape (see 26.4) | 250 cr |

- **Cup points** by place: 1st 10, 2nd 6, 3rd 4, 4th 3, 5th 2, 6th 1, else 0. Each race counts once, at its best finish. Timeouts score nothing.
- **Best times** are recorded for any finished attempt that beats the saved time, including replays. Timeouts and aborts record nothing.
- **Reward keys** `championship:<id>:complete` and `division:<id>:complete` are stored in `grantedRewards`. They are checked before paying, so repeated settles pay nothing new.
- **Race credits** on replays follow the existing policy (credits for the race only; no event reputation or defeat again).

### 26.3 Data and code

- `src/career/careerTypes.ts`: `CareerEventFormat` (sprint, circuit, checkpoint, time-attack, rival), `ChampionshipDefinition`, `DivisionDefinition`, the `pursuit-escapes` requirement.
- `src/career/careerCatalogue.ts`: the five divisions, the cup, the new events, the milestone. The validator checks formats against kinds, that each event is in one cup and one division, that planned divisions have no events, that open divisions have events, and that champions and references exist.
- `src/career/careerRaces.ts`: three new race definitions, each with its own marker lane. Every career race's route builds on the real city graph (tested).
- `src/career/careerModel.ts`: state `bestTimes`, `cupScores`, `pursuitEscapes`; `settleCareer` pays championships, divisions, ranks, and milestones once; `recordPursuitEscape`; `buildCareerView` returns divisions, championships, and `mainObjective`.
- `src/career/careerService.ts`: `recordEscape()` through the garage commit path (not a click, so no duplicate window).
- `src/pursuit/pursuitSession.ts`: optional `onEnd(reason)` in `SessionOptions`, called once when a session ends, after it returns to INACTIVE.
- `src/pursuit/pursuitController.ts`: `onSessionEnd` passed through to the session.
- `src/App.tsx`: `onSessionEnd` calls `careerService.recordEscape()` only for reason `cooldown`.
- `src/ui/CareerHub.tsx`: division header and list, main objective, championship standings with points, best finish on event rows, and format labels.

### 26.4 Police escape milestone

- Counted only when a pursuit ends with reason `cooldown`, the police giving up after losing the player. A cancelled, reset, or no-unit pursuit does not count.
- Pursuits never start automatically. The milestone is optional and does not block any event.
- Each milestone pays once. Later escapes increase the count only.

### 26.5 Save migration (career data version 2)

- `CAREER_DATA_VERSION` is 2. A version 1 career loads through `normalizeCareer`: all progress is kept, and the new fields get empty defaults (`bestTimes`, `cupScores`, `pursuitEscapes` 0). A valid version 1 career reports no repairs. It is written as version 2 on the next save.
- Malformed values are repaired and reported, not reset: unknown or negative best times, unknown or out-of-range cup scores, a negative escape count, and non-object fields.
- The rival defeat reward key (`rival:<id>:defeat`) survives a reload. It had been dropped by the normalizer before this phase.
- Processed attempt keys from a finished race survive a reload (tested).

### 26.6 Bugs found and fixed in this phase

- Rival defeat keys were dropped on load (missing `rival:` prefix). Fixed; tested.
- The Clock Run shared a marker lane with the Harbour Warm-Up. Moved to `V-4-1:F:0`; the marker test now enforces one marker per career race.
- Validator messages in `careerCatalogue.ts` contained literal backslashes. Fixed.
- Two existing expectations changed because of new content, not regressions: the race list gained three entries, and the number of open events after the warm-up is five (the three Division 1 events open with it).

### 26.7 Verification (actual results)

- `npm run check` (typecheck, `eslint .`, `vitest run`, build): exit 0. Vitest: 94 files, 1,104 tests passed. Build: `dist/assets/index-*.js` 1,467.33 kB (gzip 412.77 kB). The Stage B build was 1,453.89 kB (gzip 409.67 kB), so this phase adds about 13.4 kB raw.
- New tests: `src/career/careerExpansion.test.ts` (45 tests: catalogue and validator rules, best times, cup points and reward, division completion, the escape milestone, migration and malformed save data, service round trip, processed attempts across reload, race definitions) and `src/pursuit/pursuitSession.end.test.ts` (6 tests: `onEnd` fires once per session, after INACTIVE, with the reason).
- Zero-opponent racing: the existing `raceDirector.test.ts` clean-run test runs the Eastside sprint with zero opponents and checks the finish and reward. The Clock Run uses the same base, but its full drive has not been run on its own route.
- Browser: `tools/browser-career.py hub` 10/10 against the dev server, after the selector fix (the division list shares the `career-list` class, so the milestones check now uses its label). Screenshot `verification/part9_expansion/H01_hub_new_player.png` shows the division header and planned divisions.

### 26.8 Not verified (limitations)

- **Race win and full career path in the browser.** The sandbox renders at about 1 fps, so a race cannot finish in-browser (as in Part 9). The Division 1 completion path is tested in the rules and the service, not driven in the game.
- **Escape milestone in the game.** The `onSessionEnd` wiring is type-checked and the session hook is unit-tested, but an escape has not been produced in the running game.
- **Clock Run driven on its own route.** Route validity is tested; a full drive is not.
- **Recent results and earnings** on the hub are not added in this phase.
- **Balance.** Credit and reputation values are data, not tuned against measured play.

## 27. Infinite looping world: Stage A (status)

Plan and audit: `WORLD_WRAP_PLAN.md`. Status: **Stage A complete. Stages B to E not started. No gameplay has changed.**

- Model: the populated 2.4 km city lattice becomes a torus. Period 12 nodes = 2400 m; 400 m chunks give six chunks per
  axis on indices -3..2. Logical positions stay continuous; wrapped positions are for geometry only; render positions are
  camera-relative.
- Added (Stage A only): `src/config/worldWrapConfig.ts`, `src/world/wrap/worldWrap.ts` (pure wrap arithmetic),
  `src/world/wrap/wrapGeometry.ts` (derived geometry, throws if invalid), `src/world/wrap/worldWrap.test.ts` (30 tests).
- Finding: `simulation`'s `insideWorld` (bounding-box check feeding the "outside-bounds" recovery) would trigger at a seam.
  It must change in Stage B.
- Finding: the chunk ownership comment in `cityLayout.ts` is out of date. The test confirms the real range is -3..2.
- Not verified: any seamless driving, any seam in the running game, any performance or memory figure for the wrapped world.
- Open decision: a 2.4 km loop repeats every 2.4 km. Variety options are in `WORLD_WRAP_PLAN.md` section 6.
- Checks: `npm run check` exit 0; Vitest 95 files, 1,134 tests passed; build OK.

## 28. Infinite looping world: Stage B (status)

Stage B is a minimal playable prototype. It is opt-in with `?world=loop`. The default city is unchanged and still finite.

What it does:
- The loop network is one period (12 x 12 nodes, 2400 m) of the populated lattice, joined into a torus. It has 144 junctions, 288 streets, 576 connections, and 432 segments. The count of 432 segments and 576 connections is measured in the running app. It validates with `validateRoadNetwork` and `validateCityNetwork`, both now period-aware (`RoadNetwork.periodMeters`).
- The drivable boundary is a torus. `signedDistance` and `normalAt` see the shapes one period away near each seam, so physics and the constraint are continuous across the edges. The result matches a brute-force nine-image scan (`roadBoundary.torus.test.ts`).
- The simulation keeps the car's logical position, unwrapped. Only geometry queries wrap. `insideWorld` is true on a torus. The car does not teleport, reset, or load at a seam.
- Streaming works in logical chunk coordinates. A logical chunk is a canonical chunk plus an integer number of periods. Content is built once per canonical chunk and drawn at its image offset. Footprint ownership carries across the seam through a touch table (`periodicChunks.ts`). The streaming reach (1180 m) is checked to be below half a period at construction.
- Rendering uses a floating origin. `SimRoot` moves by the negative car position each frame (`worldOrigin.ts`), and the chase camera is placed relative to the same origin. The ground follows the car. Finite worlds keep the origin at zero.
- Traffic, police, ambient traffic, and the garage are off in the loop. Races refuse with the message "Races are not available in the looping world yet." Full support is Stage D.
- The minimap marker is wrapped into the base domain.

Verified:
- `npm run check` exit 0 (`/home/user/verification/check_stageB2.log`): typecheck, lint, Vitest 99 files and 1,166 tests passed, build 1,474.82 kB (gzip 415.23 kB). Stage A was 1,134 tests.
- Focused tests: loop network and scenery (`loopNetwork.test.ts`), torus boundary (`roadBoundary.torus.test.ts`), periodic streaming (`periodicChunks.test.ts`), floating origin through Three.js matrices (`worldOrigin.test.ts`).
- Browser (DEV app, `tools/browser-loop.py`, report at `/home/user/verification/loop_stageB/report.json`): 34/34 checks. Each run starts near one edge with a DEV-only `?devStart=x,z,yaw` pose and is driven straight with a real W hold. All four crossings were driven: east and west across x = ±1200, north and south across z = ±1200. In every run the wrapped base position jumped across the seam, progress never reversed, no logical step exceeded the speed allowance, the chase-camera offset change at the seam was typical (about 0.04 m against a 0.05 m median), the car stayed on a segment, recovery count was 0, and there were no page errors.
- The default city boots unchanged: 481 segments, 624 connections, valid, spawn at (-100, -1.8), no page errors.

Limits and not verified:
- Headless SwiftShader is slow. A 200 m drive took about 45 to 50 s of wall time. This is not a performance figure, and no FPS or memory is claimed.
- The floating origin keeps the car's logical position in float64 (JavaScript numbers). Only the small origin-relative offset reaches float32 buffers. Measured in Stage E (arithmetic, section 32 / Stage E note): float32 error would reach 2.5 cm at 1,000 km, while the floating origin stays near 1.5 nm.
- The garage entrance is null in the loop. Its refusal text ("drive into the city") is misleading there.
- Traffic, police, races, and career events in the loop are not wrap-aware yet (Stages C and D).
- The 2.4 km loop repeats (open decision in `WORLD_WRAP_PLAN.md` section 6). This stage uses the existing 2.4 km map.
- The `?devStart` parameter is DEV-only and applies to the loop world only. It sets the start pose for a verification run and does not move the car during play.

## 29. Infinite looping world: Stage C (status)

Stage C is streaming across the seams. The gate in `WORLD_WRAP_PLAN.md` is "high-speed driving across seams with no unloaded gaps". The evidence is a simulation at 30 and 60 m/s and a browser run at low speed. There was no high-speed browser run, so the high-speed claim rests on the simulation alone.

What was added:
- `src/world/streaming/streamingGaps.ts`: a pure gap probe. It samples the car point and a three-line strip 80 m ahead (15 m lateral, 20 m steps). It counts distinct logical chunks with content that are not `ACTIVE`. Canonical content is looked up through the period, so the probe works on the loop and on the finite city.
- `WorldStreamer.stats()` has two new fields: `unloadedAhead` (the gap count) and `underCarActive` (whether the chunk under the car is active). The gap sampling values are in `src/config/worldStreamingConfig.ts` (`gapLookaheadMeters`, `gapLateralMeters`, `gapStepMeters`).
- `DiagnosticsSnapshot.streaming` carries the streamer stats. The render loop fills it only when `DIAGNOSTICS_ENABLED` (DEV). Production does not compute it.
- `src/world/streaming/seamStreaming.test.ts` (16 tests). It drives the real `WorldStreamer` with a simulated renderer. A chunk becomes built after a fixed number of frames. Build time is a parameter, not a measurement.
- `tools/browser-loop.py` now records the streaming stats on every sample and adds four checks per crossing: streaming is published, no unloaded chunk ahead after a 2 s settle, the chunk under the car is always active, and no chunk load failed.

What the streamer already did before Stage C, which the tests now cover:
- Chunks are selected by logical position within the load radius (`selectChunks`). The load radius grows with speed: `min(1000 m, 520 m + 8 s x speed)`.
- A chunk also loads when it owns a segment that touches a near chunk (the touch table). This gives an extra lead of about one chunk. It is why a short load radius alone does not show gaps in the simulation.
- The urgent tier (the chunk under the car, and the owners of footprints at the car) starts without the concurrency and start-budget limits.

Verified:
- Simulation, `seamStreaming.test.ts`: every direction (east, west, north, south) at 30 and 60 m/s, over a full 2400 m period. Each drive crosses all its chunk boundaries and the seam. The strip ahead had zero unloaded chunks and the car's chunk was always active, with 8-frame (0.13 s) builds. Also zero gaps for east and north at 60 m/s with 6 s builds. The finite city has the same zero-gap result (control).
- Negative control: a 15 s build per chunk at 60 m/s does show gaps (the detector can fail).
- Brute force: for 600 sampled points (300 random, 300 at the two seams) and every footprint image in a 3 x 3 neighbourhood within the load radius, the owner chunk is selected. The check counts over 5,000 pairs.
- Forward priority: the chunk ahead outranks the chunk behind on both sides of the seam.
- Measured build-time sweep (temporary sweep, not committed; the output is in `verification/stageC_sweep4.log`). Eastbound, 2400 m, 60 m/s, with a clean standstill warm-up:
  - 8 s build per chunk: 0 gap frames.
  - 15 s build: 563 gap frames, worst 2 unloaded chunks ahead.
  - 20 s build: 781 gap frames, worst 4.
  - At 30 m/s: 15 s build gives 0 gap frames; 25 s gives 2,123 gap frames.
  - So at 60 m/s the gap onset lies between 8 s and 15 s of build per chunk. Values in between were not measured.
- Final code, `npm run check` (`/home/user/verification/check_stageC2.log`): exit 0. Typecheck and lint pass. Vitest 100 files and 1,182 tests pass (Stage B was 1,166). Build 1,475.81 kB (gzip 415.53 kB).
- Final code, browser, `tools/browser-loop.py` (DEV app, low speed): 50/50 checks (`/home/user/verification/loop_stageC2/run1.log`, `report.json`). That is the 34 earlier checks plus 16 streaming checks. An earlier run on the same code, before a one-line gate on the diagnostics publish, also gave 50/50 (`loop_stageC/run1.log`).
- Default city, DEV app (`/home/user/verification/probe_city_stageC.log`): spawn at (-100, -1.8), no page errors, `unloadedAhead` 0 and `underCarActive` true.
- Browser, `tools/browser-loop.py` (summary): 50/50 checks. Max `unloadedAhead` was 0 over 79, 80, 82 and 82 samples (east, west, north, south). The car's chunk was active in every sample. No chunk load failed. Page errors: none. Console warnings: 0.

Limits and not verified:
- High speed is not verified in a browser. The headless harness drives at a few m/s (about 200 m in 45 to 50 s wall time; the harness does not record speed). The 30 and 60 m/s results come from the simulation only.
- Build latency is simulated. The real per-chunk build time in the running app is not measured, so the 8 s to 15 s tolerance is a tolerance for this streamer, not a frame-rate result.
- The probe measures only `ACTIVE`. A chunk that is `LOADING` counts as a gap, which matches what the player sees.
- The periodic road validator is the one from Stage B (`validateRoadNetwork` and `validateCityNetwork`, period-aware). Stage C adds the seam tests above, not a new validator.
- Not verified in Stage C: visuals at the seams (the visuals are unchanged from Stage B), in-game feel, real GPU performance, and float32 precision over long sessions. Traffic, police, races and career events are not wrap-aware yet (Stage D).

## 30. Infinite looping world: Stage D (minimap, races, grey blocks)

> Current status: the browser results in the Stage D police and race subsections below are superseded by section 31 (the failures were harness budget faults, now fixed, except (c), (d) and (e)).

*Superseded in its status by section 31, which records the Stage D close-out.*

Stage D was in progress when this was written; its systems were completed later (see section 32). Stage E is measured, not closed (see the Stage E note at the end of section 31.5).

What was added:
- `src/world/wrap/worldWrap.ts`: `imageNear(reference, value, period)` gives the image of a value nearest a reference. `baseImage(value, period)` maps a value into [-P/2, P/2). Both are the identity when the period is null.
- `src/traffic/laneGraph.ts`: optional `LanePath.periodMeters`, set on loop lanes only. `nearestOnLane` maps the query to the image nearest the lane start. Finite lanes are unchanged.
- `src/traffic/trafficCollision.ts`: `imageShifts(period)` gives nine offsets on a loop and one identity offset otherwise. `findTrafficPairs` and `findPlayerContact` query the hash at each shift, so a pair or contact across a seam is found once.
- `src/traffic/trafficSystem.ts`:
  - Spawn ahead, lateral and junction reach use `imageNear`, and the overlap check images the other vehicle near the candidate.
  - Recycling uses the image nearest the player.
  - Lane continuity compares the successor start in the image nearest the lane end. This fixed a real defect: the raw check counted a false `invalidTransitions` at each seam.
  - `resolveDrivenContact` moves the driven box into the base domain first. The correction is translation-invariant.
- `src/traffic/trafficAmbient.ts`: ambient candidate distance uses the image nearest the player.
- `src/render/trafficVisuals.ts`: `TrafficVisualPool.sync(vehicles, view?)`. With a view, each vehicle is drawn at its image nearest the driven car. `renderLoop.ts` passes the car position and the period. Finite worlds pass no view, so their positions are unchanged.
- `src/world/worlds.ts`: the loop world has `ambient: { seed: CITY_AMBIENT_SEED }`.
- `src/App.tsx`: traffic is no longer gated off on the loop. Pursuit stays gated off on the loop (`world.periodMeters === null`) until the police step.
- `src/diagnostics/trafficDiagnostics.ts`: traffic rows carry `position` (base domain, read-only, DEV).

Verified:
- `src/traffic/trafficSystem.loop.test.ts`: 6/6 (`/home/user/verification/stageD2_traffic_loop3.log`). A traffic vehicle is stepped across the seam for 16 s at 15 m/s, with the player trailing: no recycle, no invalid transition, and no step larger than its speed allows. A player on the far side of the seam (2 m) gives contact. A car 15 m away across the seam is not recycled, and one 400 m away is. A pair 2.5 m apart across the seam is found once. The same pair on a finite world is not found.
- Mutations (restored, checksum verified): nine shifts collapsed to identity fails the contact and pair tests (`stageD2_mutant_shifts.log`). Raw recycling distance fails the motion and recycle tests (`stageD2_mutant_recycle.log`).
- `src/world/wrap/worldWrap.test.ts`: 34/34 (`stageD2_worldWrap.log`), including `imageNear` and `baseImage`.
- Browser, `tools/browser-loop-traffic.py`, DEV app, car parked 50 m before the east seam with no input: 6/6 (`/home/user/verification/loop_stageD2/run2.log`). Spawns on the loop. Continuity holds (worst ratio 0.18 of the speed-allowed step, base frame). No invalid transitions. One traffic vehicle crossed the seam (id 2, base x 1189.6 to -1208.6, lane `H-7-1:F:0` to `J--4-1:west>south:0`). No page errors and no console errors other than known warnings. An earlier run with the car at x=1000 (`run1.log`) had only one spawn and no crossing, so it was not conclusive.

Not verified or not done:
- The spawn overlap across a seam is in the code but has no dedicated test. The seam is at a junction, so a spawn near it is rejected by junction rules.
- Police: pursuit is off on the loop. Police visuals still use base coordinates.
- Races: the race blocker on the loop remains. Lap and finish logic is not wrap-aware.
- Minimap: only the marker is wrapped (`renderLoop.ts`). Traffic and route display are not checked.
- Navigation and career markers: not started.
- Visual correctness of traffic at the seam (the screenshot shows traffic, but not at the seam). High-speed behaviour. Real GPU performance.

### Stage D: police (step 3)

- `src/pursuit/sight.ts`: `canSee` and `offAxisAngle` take an optional loop period (default null). The target is measured from its image nearest the unit.
- `src/pursuit/deployment.ts`: `DeployRequest.period` is optional. Spawn distance and view angle use the nearest image of the player.
- `src/pursuit/policeRouting.ts`: a lane's bounding-box distance uses the image nearest the box, read from the lane's own `periodMeters`. Routes to a target across a seam find the lane just past it.
- `src/pursuit/pursuitController.ts`: the period is read from the graph's lanes. Collision bodies (the player, spawn) are kept in the base domain with `baseImage`. Opponent-to-player distances use the nearest image. Sight and deployment receive the period.
- `src/render/policeVisuals.ts` and `renderLoop.ts`: police are drawn at the image nearest the driven car, as traffic is.
- `src/App.tsx`: pursuit is no longer gated off on the loop.

Verified:
- `src/pursuit/pursuit.loop.test.ts`: 6/6 (`/home/user/verification/investigate/pursuit_loop1.log`). Sight across the seam (seen 7 m ahead, not without the period, and not from behind). Routing across the seam, both ways. Deployment returns an in-band spawn with the period passed.
- Mutation (routing period forced to null): the two routing seam tests fail (`pursuit_loop_mutant_router.log`). File restored with checksum verified.
- Limit: a mutation that ignores the period in deployment still passes the deployment test (`pursuit_loop_mutant_deploy.log`). The same-side road always supplies a valid candidate, so the test does not discriminate. Deployment's seam behaviour has no discriminating test.
- `src/pursuit` all tests: 86/86 (10 files).
- `npm run check`: exit 0, 103 files, 1,203 tests (`/home/user/verification/investigate/check_police.log`).
- Browser regression on the final code: `tools/browser-loop.py` 50/50 (Stage C checks), `tools/browser-loop-traffic.py` 6/6 (`/home/user/verification/loop_regress_police/`).
- Not verified: police in a running browser on the loop. The browser checks do not start a pursuit, so no police were seen on the loop.

### Investigation: "the world looping is not working"

- Checked at about 30 to 37 m/s in the loop world (`?world=loop`), crossing the east seam: the road, camera and traffic continued with no page errors (`/home/user/verification/investigate/seam/`). No visual break was seen at the seam.
- The default URL is the finite city by design. The loop is opt-in via `?world=loop`. The user chose to keep it opt-in until Stage D is complete.
- Found and fixed in the minimap step (see below): the minimap was blank beyond one period, and the marker jumped at the seam.
- Found, not fixed (DEV only): `src/pursuit/pursuitDebug.ts` still measures police-to-opponent distance raw.
- Screenshot note: the Career card overlaps the DEV diagnostics panel in the loop view. This is layout, not looping.

### Stage D: minimap (fixed)

The bug: the minimap drew one copy of the static layer, centred on the car's base-domain position. Beyond the layer's edge the view was background, and race marks were placed raw, so they vanished across the seam.

- `src/ui/minimapModel.ts`:
  - `minimapBounds(network)`: a looping network uses exactly one period, centred on the origin. A finite network keeps its extent with a 20 m margin. The margin would overlap the next copy by 40 m, and the two backgrounds then hid each other in that strip, which showed as a black band on the seam.
  - `staticTileDraws(bounds, period, cx, cz)`: the copies of the static layer that overlap the view. A loop draws offsets -P, 0 and +P on each axis. The centre is taken in the base domain, so the result is the same one period away.
  - `wrappedViewPixels(x, z, cx, cz, period)`: race marks at the image nearest the car.
- `src/ui/Minimap.tsx`: draws every tile from `staticTileDraws` each frame, and places race marks with `wrappedViewPixels`. Finite worlds draw one tile, as before.

Verified:
- `src/ui/minimapModel.loop.test.ts`: 8/8 (`/home/user/verification/investigate/minimap_loop3.log`). Covers: the finite placement is unchanged; every view pixel is covered for centres across the base domain; the copies do not overlap; a centre two periods away gives the same tiles; the seam pair gives the same tiles; race marks across the seam sit beside the car; the finite control puts the same mark off-view.
- Mutations (restored, checksums verified): skipping the base-domain mapping of the centre is caught by the unwrapped-centre test (`minimap_loop_mutant2.log`). An earlier version of the test missed it, because the renderer always passes base-domain centres.
- `src/ui` tests: 14/14 (`ui_tests.log`).
- `tools/browser-loop-minimap.py` (new): 6/6 on the final code (`/home/user/verification/loop_minimap/run3.log`). The empty-background share of the minimap canvas is 0.000 with the car at the centre, at the east seam, at the west seam, and throughout a drive across the east seam. Saved canvas images: `parked_east-of-seam.png`, `drive_after_seam.png`.
- `npm run check`: exit 0, 104 files, 1,211 tests (`/home/user/verification/investigate/check_minimap.log`).

Limits:
- The minimap canvas check is pixel-based. It is not a visual sign-off of the full view.
- In the post-crossing frame, the rightmost pixels show a faint tone change. This may be a district-tint difference at the cell edge, because the district layout is not periodic in the static layer. Not diagnosed.
- The DEV diagnostics panel draws over the minimap when open. An element screenshot captures the panel, so the check saves the canvas itself.

### Stage D: races and navigation on the loop

Races are enabled on the loop. The route and lap logic are the same as in the finite city. Only the position mapping and the race visuals changed.

- Routes: every race event and career race builds a valid route on the loop graph, with the same length as in the finite city. Each route stays inside the base domain, so no route crosses a seam. The sprint and the block circuit both sit in the middle of the lattice.
- Progress: `stepRacerProgress` maps each racer's position into the base domain, using `routeFrame` with `RaceRoute.periodMeters`. The stored position is normalised first, so a racer created at its logical grid position does not look like a one-period relocation. A car one period away is therefore the same car. Finite routes have no period, and their behaviour is unchanged.
- Visuals: race markers and the next-gate bar are placed at the image nearest the car, through `RaceView` and `imageNear`. The minimap's event markers and next-gate mark already used the wrapped placement from the minimap step.
- App: the loop refusal for races is removed. Career refusals (locked events, the police, and the entry rules) are unchanged.

Verified:
- `src/race/raceProgress.loop.test.ts`: 9/9. Covers: loop routes are marked with the period, finite routes are not; every loop race route stays inside the base domain; a lap on the loop passes the same gates as the finite city; a car one period away makes the same progress; a wrap in the middle of a lap changes nothing and is not a relocation; a wrap at the start line fires no gate and finishes no lap; a wrap just before the line does not finish; the sprint finishes once on the loop.
- Mutation: `routeFrame` returning its input fails 2 tests (`race_loop_mutant.log`). The file was restored, and its checksum was verified.
- `src/race`, `src/career`, `src/ui`, `src/render`: 431/431 (`race_regress1.log`).
- `tsc --noEmit`: exit 0 (`tsc_race1.log`).
- Browser `tools/browser-race.py` on `?world=loop`: 30/35 (`/home/user/verification/loop_race_run1.log`). A full Sprint completes: checkpoints in order, the finish counts once, place 3 of 3 with time recorded, the reward granted once, and retry places the car on the grid with no duplicate reward.
- The same steps on the finite city: 30/35, with the same five failures (`finite_race_run1.log`). So the five are not loop-specific. They are in the countdown and clock checks, which poll too slowly in headless Chromium. The pre-change baseline was not measured, so this is not proven to be pre-existing.

Limits:
- Browser races run only the sprint on the loop, and only away from the seam. A race that actually drives across a seam is not covered in a browser. The unit tests cover the seam case.
- Some races are in the base domain, but their racers can physically drive around the world. The mapping covers that case. Routes that cross the base seam would need an unwrapped route, which is not built.
- Race visuals are not unit-tested, because the pool needs a real controller. They are covered by the browser run only, and no visual screenshot of the loop markers has been inspected.
- Navigation has no separate system in this build. It is the next-gate bar, the race and career markers, and the minimap marks. The HUD shows the next checkpoint's name only.
- The guardrail stall in the loop Sprint (84 contacts near the finish corner) was not reproduced in the finite run. The race recovered and finished. It is not diagnosed.

### Grey blocks on the road (fixed)

Cause: `ROAD_TEST_BLOCKS` (in `src/world/roadMeshData.ts`) are validation fixtures from the road-only stage. The city renderer drew them as props, but nothing checked them against the road. Four of the seven sit on the drivable road, with up to 10.2 m overlap. The car has no collider for them, so it drives through. They are the grey blocks in the user's screenshots.

Not the cause: buildings, landmark footprints and landmark parts. A dense 1 m check puts all of them at least 34.8 m from the drivable road in both worlds (493 buildings, 4 landmark footprints, 8 landmark parts). An earlier corners-and-midpoints check was too weak to show this, and it was replaced.

Fix:
- `src/world/city/cityProps.ts`: `CITY_PROP_BLOCKS`, the list the city renders. It is empty. Every entry must clear the road by the scenery gap.
- `src/render/RenderLayer.tsx` passes `CITY_PROP_BLOCKS`. The fixtures remain exported for the tests that use them.
- `src/world/city/roadProps.clearance.test.ts`: 7/7. Every building, landmark footprint, landmark part and rendered block is checked on a 1 m (or 0.5 m) grid, in both worlds. A separate test pins that four fixtures overlap the road, which is why none is rendered. Mutant (the fixtures put back into the rendered list) fails 3 tests. Restored, checksum verified (`props_mutant.log`, `cityProps.sha.txt`).
- `src/world/city` through `src/simulation`: 462/462 (`regress_props.log`).
- `tsc --noEmit`: exit 0 (`tsc_props.log`).

Limits: the before and after screenshots were not captured from the block's position. The dev start snapped the car to (-100, -1.8), away from the block at (-180, 110). The fix is shown by the numeric check and the unit test. A visual check from the block's position is still to do.

## 31. Stage D close-out (updated with the browser fixes)

Status: items (a)-(e) are closed or honestly reported. (a), (b), (c) and (d) are resolved. (e) is partly diagnosed.
Whether Stage D counts as complete depends on the not-verified list in 31.5. Stage E is measured (see the Stage E note at the end of section 31.5). The loop is the
default world since section 32.

### 31.1 Per system

- Traffic (`src/traffic/trafficSystem.loop.test.ts`, 6/6): continuous eastbound drive across the seam; recycle 0; invalid
  transitions 0. Browser `tools/browser-loop-traffic.py` on the loop: 6/6 (`loop_stageD3`), one crossing (vehicle 2,
  base x 1188.0 to -1210.2). The three recycles counted in run 2 were far-from-player culling. The image
  `loop_stageD3/traffic_loop.png` shows no traffic vehicle clearly in frame, so the crossing rests on the harness data.
- Police (`src/pursuit/pursuit.loop.test.ts`, 6/6): sight, routing and deployment across the seam. Mutants: removing the
  period from sight fails 1 test, from routing fails 2. Deployment does not discriminate the period (the same-side road
  supplies a valid candidate; a known limit). `pursuitDebug.ts` measures wrapped distance on looping lanes.
  Browser `tools/browser-pursuit.py`: loop 34/34 (`loop_pursuit3`), finite 34/34 (`finite_pursuit3`).
- Races (`src/race/raceProgress.loop.test.ts`, 13/13; `src/render/raceVisuals.seam.test.ts`, 4/4). Mutants fail 2, 1,
  and (for the seam step rule) 1. The seam sprint (`seam-sprint`, loop only, in `LOOP_RACE_EVENTS`) is the one loop route
  that crosses the seam. Two seam bugs were found and fixed while doing it: (1) `nearestRouteSample` searched the single
  period-length polyline segment across the seam, so any car on that row matched it at distance 0; segments longer than
  half a period are now skipped. (2) `advanceRacer` measured the step on the base-domain value, so a seam crossing counted
  as a relocation and the gate test ran on a segment spanning the whole map; the step and the gate segment now use the
  short way round the period. Browser `tools/browser-race.py S` on the loop: 10/10 (`loop_seam/report_race.json`): the
  car drives through the seam (logical x 1050 to 1490 m, continuous), the Checkpoint then Finish each pass once,
  relocations 0, one reward of 300 credits. Earlier loop runs: C, D, E pass (`loop_race3`); loop J passes 11/11 standalone (`loop_race4`);
  finite J passes 11/11 standalone after the reward-check fix (`finite_race3`). The full finite run before that fix was
  43/44 (`finite_race2`). A full clean finite run has not been repeated.
- Minimap and navigation (`src/ui/minimapModel.loop.test.ts`, 8/8): the marker and next-gate placement at the image nearest
  the car. Browser `tools/browser-loop-minimap.py`: 6/6 after the bounds change (`loop_minimap4`), with the car crossing
  the east seam. The empty-share metric reads 0.000 at centre and is a weak check. Navigation was later added and the
  earlier "not applicable" note is superseded (section 32).
- Career markers: the same race visuals and minimap marks, so the same placement applies.
- Grey blocks: see section 30.

### 31.2 Items (a)-(e), with outcomes

- **(a) Police trigger and reset: resolved, harness fault.** The speeding rule is `speedingFactor` 1.4 over the 14 m/s
  street limit (19.6 m/s) for 2 s in view of a patrol. Headless Chromium runs game time at about 0.3 to 0.5 of wall time
  (the fixed step is 1/60 s, and frames are capped at 8 substeps). The harness drove for 14 s of wall time, which ended
  before the car reached 19.6 m/s. A probe (`verification/fix_pursuit/probe_speed.py`) reached 19.6 m/s at about 19 s of
  wall time, and the detection began at about 30 s. The fix is a 60 s budget that ends after a detection is cancelled.
  The reset step read the state after a fixed 1 s wait, but the session applies on a later step, so the restage returned
  `ignored`. It now waits up to 8 s for the state (`probe_reset.py`). The rule and its tuning are unchanged.
- **(b) Five race timing checks: resolved, harness fault.** The countdown is 3 game seconds. At 32 steps per second
  it takes about 8 to 10 wall seconds, so the 6 to 8 s wall budgets expired during it (`[3, 2]`, and the clock at 0).
  The budgets are now 40 s for GO, a clock poll instead of a fixed sleep, and a 1200 s drive budget. The Sprint finish
  at 600 s had ended at 173.8 s of race time, just before the finish. The race's own 240 s time limit is unchanged.
- **(c) Browser seam race: resolved.** The user chose a new seam-crossing route in the loop catalogue (loop only, finite
  world and career unchanged). `SEAM_SPRINT` (start `H-7-1` east side, checkpoint `H--4-1`, finish `H--3-1`, 2 rivals,
  240 s limit, 300 credits, provisional) passes `buildRaceRoute` on the loop graph. Its finish gate is at 490 m and the
  route runs on to the end of the last lane (579.6 m), the same convention as the existing sprint (finish at 1082 m of
  1172 m). Browser pass as in Races above. Not in `RACE_EVENTS` or `ALL_RACE_IDS`, so not in career.
- **(d) Loop markers and next-gate bar: resolved.** `loop_race/C04_racing_strip.png` shows the race strip and the minimap
  gate rings. `loop_race/seam_marker_closeup.png` (car 25 m behind the marker) and `loop_race/seam_marker_closeup12m.png`
  (12 m behind, the "Race available: Seam Sprint" card on screen) show the in-world marker on the loop: a yellow ground
  ring and a tall yellow post. Staged with the DEV race API (`loop_seam/marker_shot.py`).
- **(e) Guardrail stall near the loop Sprint finish: partly diagnosed.** In `loop_race2` the car wedged at the corner of
  junction J-3-1 (about x 188 to 210, z -190 to -193): the footprint was off the surface and speed was under 0.5 m/s.
  `WORLD_RECOVERY` `stuck` fired after 20 s of game time and moved the car to the nearest lane. The race counted this
  as a relocation (`relocations 1`), and the notice read "Checkpoint 1 is not next". The same boundary shapes exist in
  the finite city (checked with the probe), so the geometry is not loop-specific. The wedge did not recur in `loop_race3`.
  Whether the cause is the harness's turn speed and steering, or the product corner geometry, is not confirmed.

### 31.3 Harness changes (test tools, not game code)

- `tools/browser-pursuit.py`: trigger budget 14 s to 60 s, ending on a cancelled detection; reset staging waits up to 8 s
  for the session.
- `tools/browser-race.py`: `GO_TIMEOUT` 40 s; clock poll; sim-rate log line; E drive 1200 s; J drive 2400 s; the J reward
  check compares the change in session credits from J's start.
- `tools/browser-loop-minimap.py`: crossing counted at x > 1215 or a jump over 1000 m. The base URL must not include a
  query string (the harness appends `?world=loop&devStart=...`; a doubled query silently ignored `devStart`).

### 31.4 Checks

- `npm run check` exit 0: 108 files, 1,239 tests (`/home/user/verification/fix_pursuit/check_seam.log`). Earlier:
  1,235 (`check_fix.log`), before the seam route.
- `tsc --noEmit` exit 0 (`fix_pursuit/tsc_seam.log`). `eslint .` exit 0 inside `npm run check`.

### 31.5 Not verified

- The finite race browser run after the seam fix: the change is a no-op for finite routes (`periodMeters` undefined takes
  the old branch), and unit tests cover it, but the finite browser C, D, E, J were not re-run.
- Seam-crossing traffic, police and the minimap at high speed in a browser (only the low-speed harness runs were done).
- A full clean finite race run after the J reward fix (the J step alone is verified).
- The finite browser traffic regression after the continuity fix (unit tests cover finite traffic in `npm run check`).
- High-speed behaviour in a browser; FPS; memory. Headless game time runs slower than real time, so the browser results are
  about logic and not about real-time pacing.
- Deployment mutant (police): not caught by the test (known limit).

Stage E (visual polish, memory over repeated loops, measured results only) is measured in headless Chromium. Results are in
`/home/user/verification/stage_e/RESULTS.md`:
- Memory: 11 seam crossings (run capped at 1,500 s wall, target 20). Heap after GC flat at 57 to 59 MB from crossing 2 on;
  GPU geometries flat at 252 to 295; mounted chunks steady at 40; no page or console errors. Tools:
  `tools/browser-memory.py`. Not a 20-loop result.
- Seams: 5 screenshots across x = -1200 (`tools/browser-seam-shots.py`); two checked by eye, road and scenery continuous.
- Precision: arithmetic only. Float32 error would reach 2.5 cm at 1,000 km; the floating origin keeps it near 1.5 nm.
- Variety: measured per period (493 buildings, 6 kinds, 18 colours, 1,464 trees). No per-copy variety, because copies
  must match at the seam.
- Open: two one-off heap samples (87 MB, 66 MB) not explained; FPS not measured (headless); a 20-loop soak not finished.

## 32. Loop as default, navigation, and the garage on the loop

Decisions (user, this session): the looping world is the default; navigation shows on the ground and on the minimap, for
both worlds; the loop is the default now, which reverses the earlier opt-in decision for `?world=loop`.

### 32.1 Changes

- Default world: `parseWorldId` returns `loop` for a bare URL and for unknown values. `?world=city`, `?world=circuit`
  and `?world=legacy` are unchanged. `src/world/worlds.test.ts` covers the new default.
- Browser scripts that expect the finite city now pin `?world=city` in their default URL: `browser-career`,
  `browser-garage`, `browser-presentation`, `browser-pursuit`, `browser-release`, `browser-race`, `browser-city`,
  `car-gallery`, and `browser-prod` (port 4173). Scripts that take a URL argument use the argument as given.
- Garage on the loop: the loop has a garage entrance at its spawn, as the city does. Before this change the default
  world would have lost the garage. The distance check is the short way round the period
  (`distanceOnWorld` in `src/garage/garageGate.ts`, optional `periodMeters` on `GarageEntryPlace`), so a car one period
  from the entrance is at the entrance. Tests: `src/garage/garageGate.test.ts` (loop block).
- Career target: `careerTargetEventId(profile)` in `careerModel.ts` holds the logic that picks the hub's target (the
  tracked event, else the first available). `buildCareerView` uses it, so the hub and the route cannot disagree.
- Navigation (new, `src/navigation/`): `navigationPath.ts` (lane route, unwrapped from the car so it is continuous
  across the seam), `navigationGoal.ts` (career race start, or the garage lane), `navigationRuntime.ts` (recompute at
  1 Hz; geometry rebuilt only on a lane change, when the car moves 15 m, or on a new goal; cleared within 8 m of the
  goal). Render: `src/render/navigationScene.ts`, `navigationVisuals.ts` (ribbon and garage ring, the ring at the image
  nearest the car), `NavigationLayer.tsx`. Minimap: `src/ui/minimapNavigation.ts` and `drawNavigation` in `Minimap.tsx`.
- Goal rule: the career target when there is one, else the garage. The route is shown for one goal at a time.
- `GarageEntranceVisual.tsx` is removed; the ring is in `navigationVisuals.ts`.
- The loop's comment in `worlds.ts` no longer says traffic, police, races and garage are absent.

### 32.2 Checks

- `npm run check` exit 0: 111 files, 1,252 tests (`/home/user/verification/fix_pursuit/check_nav.log`).
- Navigation unit tests (`src/navigation/navigationPath.test.ts`, `navigationRuntime.test.ts`,
  `src/ui/minimapNavigation.test.ts`, 11 tests in the run before the final check). Routes from the spawn to every
  career race start on both worlds: drivable, no jumps larger than about 8 m. Seam: a car at logical x 1150 routed to a
  goal at base -1000 gives a continuous route with a length of 200 to 400 m.
- Mutant: removing the period unwrapping fails the seam test (`fix_pursuit/nav_mutant_unwrap.log`). Restored, checksum OK.
- Browser `tools/browser-navigation.py` (bare URL): 8/8 (`/home/user/verification/navigation/report.json`). Parked at the
  garage with a fresh career: no route, and no garage refusal. Staged at logical x 1150 with no career target: a garage
  route that starts at the car. After starting the career: a career route to Harbour Warm-Up. No page or console errors.
- Screenshots: `navigation/career_route.png` (cyan route ahead, cyan line on the minimap), `navigation/garage_route.png`.

### 32.3 Known gaps and not verified

- The HUD garage hint ("Garage · V, drive to the garage entrance") still shows while the route goes to the career target.
  The hint and the route can disagree. The user has not yet chosen which should win.
- Only the career and garage goals are routed. No route to a rival or to a race that is not the career target.
- The finite browser regression (the default scripts pinned to `?world=city`) was not re-run after the default change.
  The loop browser scripts (`browser-loop*.py`, `browser-race.py S`) were not re-run after it either.
- High-speed route updates and performance (FPS, memory) are not measured.
- The browser environment was reset during this session. Python `playwright` and the Chromium system libraries were
  reinstalled before the browser run.

### 32.4 Race start fix (this session)

Report: "cannot start race now". Two causes, both in the race start path.

- Blocked start was silent. A pursuit blocks a race (`Lose the police before starting a race.`), but the approach card
  kept an enabled Start button, and the reason was a 2.5 s toast. The card now carries `RaceApproachInfo.blocked`
  (set from the same `entryBlock` used by `confirm()`). While it is set, Start is disabled and the reason is shown on
  the card.
- Stale results held the next marker. After a race ended (FINISHED or FAILED) without Q, the old entry stayed active.
  Driving to another marker opened no card, and E silently restarted the old event. Fix: results are released only when
  a different marker's approach radius is entered (`otherMarkerInRange`). The release also ends the old attempt
  (opponents removed, traffic restored). Results are NOT released by distance from their own marker, because a finish
  line is often far from its marker.

Verification:
- Unit: `src/race/raceController.test.ts` 15/15, including the two blocked-card tests and the two results tests. The
  stale-results test fails when the release branch is removed (mutant), and passes after restore (checksum checked).
- Browser `tools/browser-race-start.py` (bare URL): 18/18 (`/home/user/verification/race_start/report.json`). A:
  pursuit blocks and disables the card, E refused, race starts after the pursuit ends. B: after an abort without Q,
  Block Circuit's card opens and E starts it.
- `npm run check` exit 0: 111 files, 1,256 tests (`/home/user/verification/fix_race/check_race_fix.log`).
  `eslint .` exit 0 (`eslint_race_fix.log`).

Known: the DEV diagnostics panel can overlap the approach card in screenshots (DEV only). A cancelled attempt disarms its
marker until the car leaves the exit radius (existing design, unchanged).

### 32.5 How a pursuit starts (for testing)

- A patrol unit must witness an offence. A patrol sees the player within 70 m and inside a 65 degree half-angle of its
  heading (`src/config/pursuitConfig.ts`, `sight`). Patrols drive the city from the start. There is no occlusion.
- Speeding: be over the lane limit by a factor of 1.4 for 2 s in view of a patrol (`trigger.speedingFactor`,
  `speedingSeconds`).
- Collision: hit traffic while a patrol sees you (`trigger.collisionWitnessed`).
- Then detection (1.5 s in sight), initiation (2 s), and pursuit. Escape needs 5 s out of sight and 140 m separation,
  then 8 s cooldown (about 37 s in the browser test, where it went PURSUING, SEARCHING, COOLDOWN, INACTIVE).
- Browser check: `tools/browser-pursuit.py` pins the finite city; the race-start check above uses the debug API
  (`placeAheadOfUnit`, `reportOffence('speeding')`), which is DEV-only and reports the offence through the same trigger.

### 32.6 Navigation destinations and race navigation (this session)

Report: every navigation went to the same place, Eastside Sprint. Navigation also went inactive at a race marker, and the
race did not show a route to its checkpoints.

Causes found:
- Career goals used the race's grid start (`start`), not its roadside marker (`marker`). Nearly all career events
  started on two points, (-350, -402) and (-150, -402), which is where Eastside Sprint starts.
- The lane graph is two closed circuits, one per driving direction (2304 lanes each). A car on a reverse lane could only
  reach reverse lanes. The race markers are on reverse lanes, so a car on the forward side, or one that had turned, got
  no route. That is why the route went inactive at the marker.

Changes:
- `careerGoal` goes to the race marker (`race.marker.laneId`, `s`).
- `chooseGoal` (`src/navigation/navigationGoal.ts`, pure) picks the goal from the race state: none during COUNTDOWN and
  PAUSED (the race has started), the next checkpoint while RACING, otherwise the career marker, then the garage.
- `buildNavigationRoute` tries the nearest lanes first. If none reaches the goal, it tries the other lanes of the car's
  own segment, which is one turn-around at the start. Normal routes are unchanged.
- `NavigationScene` takes the race controller (`RenderLayer` passes it). `NavigationGoal.kind` adds `'checkpoint'`.
- Race results: a finished or failed race keeps its results until Q. They are left only when the car has moved more than
  30 m from where the results began and another marker is in range. The start point is recorded at the abort or the end
  (not on the first later step). The first version dropped results at once when the abort was near another marker, so
  it was changed.

Tests:
- `src/navigation/navigationGoal.test.ts` (new): the goal choice for each race state, and the fallbacks.
- `navigationPath.test.ts`: routes from the spawn to every career marker; every career destination at least 30 m from the
  others; a car on a reverse lane routes with one turn-around (mutant: removing the turn-around fails it, checked).
- `raceController.test.ts`: results stay where an abort happens inside another marker's range (16/16 in that file).
- `npm run check` exit 0: 112 files, 1,266 tests (`/home/user/verification/fix_nav/check_nav_race.log`). `eslint .` exit 0.
- Browser `tools/browser-navigation-race.py` (bare URL): 13/13 (`/home/user/verification/navigation_race/report.json`).
  Career route ends at the marker, not the grid. A car on the grid side gets a route to the marker. The countdown ends the
  navigation. The racing route ends at the first gate. After the abort the career route returns.

Interpretation to confirm: "walk-path" was not a term in the code. It was read as the race marker zone (the roadside
place where the race card opens). Navigation now runs to the marker and ends at 8 m from its lane point, as the arrival
rule says. The card opens at 18 m.

`browser-race-start.py` was re-run after the results change: 18/18. Not re-run after this change: `browser-navigation.py`
(8/8, from before the marker change).


## 33. Release preparation for GitHub Pages

- **Pages:** `index.html` is the ETERNIX front page (landing and GARAGE showroom; ENTER GAME opens play.html). Its loading steps import game modules for readiness, so the front-page bundle includes them. The previous home page (Play and Play-the-finite-city links) was removed when the front page changed. `play.html` is the game,
  with a CSS loading screen that React replaces, a 20 s "taking longer than usual" note, and an error note if the module
  fails to load. Vite builds both pages (`vite.config.ts`, `build.rollupOptions.input`). The base stays relative.
- **Identity:** name "Street Racer", MIT License (`LICENSE`; copyright holder is a placeholder, "Street Racer
  contributors"), favicon `public/favicon.svg`, `public/.nojekyll`. Version left at 0.1.0.
- **Repo:** design documents moved into `docs/`. `.claude/`, `browser-output/`, and `verification/` are git-ignored
  (`.claude/` is untracked, its files kept on disk). README rewritten.
- **Production hardening:** the `devStart` parser is called only in DEV (the check moved to the call site, so the bundle
  drops it). Debug hooks, the debug panel, runtime error capture, and the road, traffic, and reset debug actions are
  DEV-only. Checked on `dist/`: no `__STREET_RACER_DEBUG__`, no `placeForTest`, no `devStart`, no `installRuntimeErrorCapture`.
- **Browser tools:** default URLs now `…/play.html`, and default output `browser-output/`.
  `tools/browser-release.py`: two checks that used fixed holds (3 s of throttle to reach 30 km/h, and 3 s before a blur)
  now hold the key until the speed is reached (60 s wall cap), because headless time runs slower than real time.
- **Cheating:** a single-player, offline game. Progress is in `localStorage` and cannot be protected from its owner
  without a server. The README says so. Save data is validated on load.

Verification (this release):
- `npm run check`: typecheck, lint, 112 test files, 1,266 tests, build. Exit 0 (`/home/user/release_logs/check_after.log`).
- Production smoke, `tools/browser-prod.py` against `vite preview` on 4173: 7/7.
- Release checks, `tools/browser-release.py http://localhost:4173/play.html`: 55/55 (boot, drive, focus, pause, corrupt,
  newer, quota, nostorage, resize phone/tablet/laptop/desktop, cycles, errors).
- Home page to Play to game loads with no page errors and no failed requests (checked in a headless browser on the build).
- Limits: the release checks use real input in headless Chromium. The blur check shows speed still rising for about half a
  second after blur, which the throttle ramp and headless lag can explain; it is not separately proven. Real-GPU frame rate
  is not measured.
- Not committed: the Part 3 `HEAD` does not contain most of the game. Commit before the first push.

### Division 2: Urban Syndicate (built)

- **Opens** after Division 1: the first event needs Mara Quill beaten and 120 reputation. Events run in order: Warehouse Circuit (two-lap circuit), Seam Run (sprint on the Seam route), Tight Corners (checkpoint run, 140 s limit), then the Ren Adair challenge.
- **Traffic on the route.** The race definition has an optional `trafficOnRoute` flag (`raceTypes.ts`). When it is set, the race clears traffic from the grid at the start but keeps the traffic spawner running, so cars drive on the route. Every other race still holds the spawner, as before. Tested in `raceController.test.ts`.
- **Syndicate Cup:** the three races before Ren Adair, scored by place. Finishing all three wins it (40 reputation, 600 credits).
- **Champion: Ren Adair** (new rival). Ladder position 1, the top of the board. The ladder is renumbered: Kai 2, Juno 3, Teo 4, Mara 5. The beating order is still bottom up, so Ren is beaten last. Defeating Ren completes the division: 80 reputation, 900 credits, paid once.
- **Lead:** Division 2 has a lead into Division 3 (Highway Collective), shown in the hub after Division 2 completes.
- **Not browser-checked.** The rules are covered by unit tests (career and race, 303 tests). No playthrough was run, and the traffic behaviour on the route has not been driven.

### Night lights (game)

- **One night level, every frame.** `Environment.tsx` (game), `HeroEnvironment.tsx` (home) and `ShowroomStage.tsx` (garage) each derive a level (0 = day, 1 = full night) from the time of day's `lampMultiplier` (`lampLevelFor`, `nightLights.ts`). They read the same store, so they agree. The presets already described lamps as lit only after dusk; this wires that to the renderer. Evening is partly on.
- **Street lamps.** Lamp heads are their own instanced layer (`CityScenery.tsx`, `cityInstances.ts`), so their glow can change without touching other boxes. Each lamp also has a flat light pool on the ground, additive and hidden by day.
- **Headlights.** Every car's headlight material follows the level (`VehicleVisual.tsx`, `trafficModel.ts`). The player's car also has two shadowless spotlights (`HeadlightRig.tsx`), always mounted and off by day, so the number of lights never changes during play.
- **Not done.** Lamps are not real point lights. Only the player's car has real light. The lamp light is an emissive head plus a ground pool, which is cheap. Intensities are estimates: they have not been checked in a browser, because verification was cut.
- **Tests.** `nightLights.test.ts` covers the level rules and the registry. `cityScenery.test.ts` counts the new lamp instances.

