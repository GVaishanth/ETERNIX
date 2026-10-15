# PROJECT_CONTEXT.md

Living document. Update it at the end of every development phase.

## 1. Project objective

A browser-based 3D open-world street racing game inspired by Need for Speed: Most Wanted (2005).
The goal of the whole project is a stable, extensible foundation for later phases: vehicle handling,
world content, traffic, police AI, progression, UI, audio, and presentation.

**Current phase: Part 1 (first playable driving scene), built on Phase 0.** The scene has a procedural
car, a two-lane road with markings, shoulders, roadside props, a chase camera, a small HUD, and keyboard
driving with pause and reset. Traffic, police, a city, progression, and purchasing are out of scope and
do not exist yet. Part 2 has not been started.

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
- **Vehicle model:** kinematic bicycle in the ground plane (`simulation/vehicle.ts`).
  - Steering: the front-wheel angle moves toward `steer × maxSteer(speed)` at a limited rate.
    `maxSteer` tapers from 100% at standstill to 50% at top speed. This is **speed-sensitive: there is no
    rotation at standstill**.
  - Yaw rate: `clamp(v·tan(δ)/L, ±a_lat_max/|v|)`, with `a_lat_max = 14 m/s²`.
  - Longitudinal:
    - Throttle accelerates forward with headroom taper toward 62 m/s.
    - Brake decelerates forward to exactly 0, then reverses at 4 m/s² when held at standstill (up to 12 m/s).
    - Throttle while reversing brakes to 0.
    - Handbrake decelerates to 0 at 12 m/s², overrides throttle and reverse, and holds the car at 0.
    - Coasting decelerates at 1.2 m/s² when no drive input is held.
  - Drive direction readout: `drive` above 0.1 m/s forward, `reverse` below −0.1 m/s, `neutral` otherwise.

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

- Chase-camera math (`camera/chaseCamera.ts`) is pure and runs in simulation space.
- Distance behind the rear axle: 7.5 m at standstill, plus 0.05 m per m/s of speed, capped at +3 m.
- Height 2.8 m. Look-at point 12 m ahead of the rear axle, 1.0 m high.
- Position and look-at are damped with frame-rate-independent exponential smoothing. The first update, and any
  update after reset, snaps to the goal. A zero step (paused) freezes the camera.
- Camera name `ChaseCamera`. FOV 62°, near 0.1 m, far 3000 m. Fog 180 m to 1500 m.

## 9. Scene and assets

- **No external assets.** Everything is procedural: road, shoulders, markings, ground, car, posts, trees, arrows.
- **Car:** built from `vehicleLayout.ts` with a body, cabin, glass, headlights and tail lights (emissive boxes),
  amber indicator markers (static, not blinking), and four wheels. It is a placeholder, not a real model.
- **Road:** two lanes of 3.6 m, a double yellow center line, white edge lines, 3 m shoulders, distance markers
  every 100 m (major every 1000 m), and forward arrows on the right lane every 120 m. The road runs from
  z = −100 to z = 4000 m.
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
- Layout values that are pure functions of config are computed at module scope. The React Compiler lint rule
  rejects `useMemo` around them.

## 12. Current implementation status

Implemented and verified (see sections 14 and 15):
- Project scaffold, pinned versions, strict TypeScript, ESLint, Vitest, Vite
- Coordinate convention with the documented render-side mirror
- Fixed-timestep simulation with interpolation and a single R3F frame driver
- Kinematic bicycle model with throttle, brake, reverse, handbrake, rate-limited speed-tapered steering,
  lateral-acceleration cap (placeholder tuning)
- Unified keyboard input with held keys, actions, form-control suppression, and listener cleanup
- Pause (Escape or button) that freezes simulation and camera; reset (R or button) that restores the spawn pose
- Chase camera with speed-dependent distance and damping
- Two-lane placeholder road with shoulders, markings, distance markers, arrows, posts, and trees
- Procedural car with headlights, tail lights, indicators, and windows
- HUD: speed, D/R/N, pause status, Pause and Reset buttons, control hints
- Dev-only diagnostics panel, error capture, and the browser-test hook

Not implemented (do not describe as done):
- Collision and road constraints. The car can drive off the road onto the shoulder and into the grass.
- Physics engine (Rapier)
- Traffic, police AI, AI opponents, a city, career, progression, missions, vehicle purchasing
- Menus beyond the HUD buttons; audio; persistent data (save, settings)
- External assets, an asset loader, and real vehicle models
- Blinking indicators, real light sources, and visible wheel rotation
- GSAP presentation work; mobile or touch input

## 13. Known issues

- **Steering does nothing at standstill** (by design: speed-sensitive steering). A car that is not moving cannot be
  turned in place. This is a gameplay decision to confirm.
- **Vehicle leaves the road.** There are no road constraints. Expected at this stage.
- **Spawn marker.** A distance marker sits on z = 0, under the spawn position, so it appears beneath the car at launch.
- **Simulated time falls behind wall time on slow renderers.** The software WebGL used in this sandbox runs at about
  5 fps, and the substep cap then drops simulated time (the debug panel showed about 0.7 s dropped). On real GPUs
  this should not occur. Do not remove the cap.
- **Frustum visibility is coarse.** The road check uses a 220 m segment around the car, not the whole road.
  The vehicle check is an AABB test with no occlusion.
- **Debug panel CSS ships in the production stylesheet.** The panel's JavaScript and strings are absent from
  the production bundle, but its `.debug-panel` rules remain in the CSS. Harmless; move them if the CSS needs trimming.
- **Bundle size warning.** The main chunk is about 1.15 MB (about 317 kB gzipped), mostly Three.js. Code-splitting
  the renderer is a later optimization.
- **Third-party warning.** R3F 9.8.2 uses `THREE.Clock`, which Three.js r186 marks deprecated. Not project code.
- **Instanced mesh disposal.** `InstancedSet` calls `dispose()` on unmount. This has been checked by mounting and
  rendering in dev mode (including StrictMode) but not by a dedicated unmount test.

## 14. Tests that must pass

Run `npm test`. Currently **121 tests across 11 files**:

- `core/coordinates.test.ts`: forward/right convention, toRenderSpace
- `core/math.test.ts`: clamp, moveTowards, wrapAngle, shortest angle, damping
- `render/renderSpace.test.ts`: real Three.js math for the mirror. Screen-right matches simulation-right. The SimRoot
  mirror places the nose and right side correctly. Bounds flip correctly.
- `render/vehicleLayout.test.ts`: nose at +Z, tail at −Z, right at +X, wheels on the ground at the axles, body above
  the ground, left and right mirror symmetry
- `simulation/vehicle.test.ts`: longitudinal limits, brake without overshoot, reverse only when braking at standstill,
  coasting, handbrake deceleration and reverse block, drive-direction readout, **steering-sign tests (rolling W+A and
  W+D)**, no rotation at standstill, rate-limited steering, lateral cap, determinism, no mutation
- `engine/fixedStep.test.ts`, `engine/gameSimulation.test.ts`: step planning, frame-rate independence, interpolation,
  reset to spawn
- `input/keyBindings.test.ts`: held-key mapping, action mapping, prevent-default set
- `input/inputController.test.ts`: held-key tracking, blur and visibility clear, action queue, form-control suppression,
  Escape while a control has focus, listener removal and no stacking after re-attach
- `camera/chaseCamera.test.ts`: goals, snapping, convergence, speed-dependent distance
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
| `python3 tools/browser-smoke.py [url] [outdir]` | Browser checks against a running dev server (needs Playwright) |

Node 20.19+ or 22.12+ is required (Vite 8).

Verification done in Part 1:
- `npm run check`: typecheck, lint, 121 tests, and production build all pass.
- Production bundle: one JavaScript chunk, no `__STREET_RACER_DEBUG__` or `DEV DIAGNOSTICS` strings, and no debug
  chunk. The only `debug-panel` match is the CSS rule noted in section 13.
- `tools/browser-smoke.py` against the dev server: **40 of 40 checks passed** (spawn, camera, HUD, single listeners,
  acceleration, steering sign, reset, speed readout, pause, braking and reverse, handbrake, blur and hidden-tab
  clearing, form-control suppression, pause and reset buttons, debug toggle, zero runtime errors). Screenshots and a
  JSON report are in `/home/user/verification/part1/`.
- Steering-sign results (W held, rolling at about 12 m/s): A gave a heading change of −28.5° and dx −8.4 m. D gave
  +38.1° and dx +4.3 m (run-to-run values vary with frame timing).
- Phase 0 checks (`D` steers toward +X on screen-right) still hold.

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
