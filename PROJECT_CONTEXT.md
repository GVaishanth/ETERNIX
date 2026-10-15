# PROJECT_CONTEXT.md

Living document. Update it at the end of every development phase.

## 1. Project objective

A browser-based 3D open-world street racing game inspired by Need for Speed: Most Wanted (2005).
The goal of the whole project is a stable, extensible foundation for later phases: vehicle handling,
world content, traffic, police AI, progression, UI, audio, and presentation.

**Current phase: Phase 0 (audit, architecture, stability foundation).** No gameplay systems beyond a
placeholder kinematic car on a placeholder road exist yet.

## 2. Audit summary (as found)

- The project directory was empty: no `package.json`, no source, no assets, no `PROJECT_CONTEXT.md`
  anywhere under `/home/user`. Nothing pre-existed to preserve or audit, so this is a greenfield
  scaffold. No pre-existing failures exist to record.
- Node 20.20.2 and npm 10.8.2 are present. Vitest 5.x requires Node 22.12+, so Vitest is pinned to
  4.1.11, which supports Node 20. Vite 8 and ESLint 10 require Node 20.19+, which this sandbox satisfies.
- Skills requested in the brief were installed into `.claude/skills/` (frontend-design,
  senior-frontend, ui-ux-pro-max, senior-backend, senior-architect, skill-creator,
  ui-design-system, mobile-design, brainstorming, clean-code).
- Reference URLs from the brief (impeccable.style, transitions.dev, gsap-skills, make-interfaces-feel-better)
  were NOT reviewed in this phase. They concern presentation and UI, which are later-phase work.

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

Deliberately NOT installed yet (add in the phase that needs them):

- **Rapier** (`@react-three/rapier` 2.2.0 / `@dimforge/rapier3d-compat` 0.19.2 were checked for compatibility,
  peers React ^19, R3F ^9.0.4). Phase 0 vehicle motion is a custom kinematic model. Rapier will be added
  with collision work, where a physics engine adds value. Diagnostics report this honestly.
- **GSAP** (3.15.0 available). Reserved for presentation work (menus, transitions). Not needed in Phase 0.
- **@react-three/drei**. Not needed; keep the dependency surface small.

## 4. Project directory structure

```
street-racer/
  .claude/skills/          Installed agent skills (see audit summary)
  index.html               Entry HTML, mounts #root
  vite.config.ts           Vite + Vitest config; dev/preview bind 0.0.0.0 with preview-host allowlist
  eslint.config.js         ESLint flat config
  tsconfig.json            Strict TS config (src + vite.config.ts)
  PROJECT_CONTEXT.md       This document
  src/
    main.tsx               Entry: mounts <App/>; installs dev-only error capture
    App.tsx                Canvas, HUD, dev-only DebugPanel (lazy)
    styles.css
    core/                  Pure, framework-free building blocks
      types.ts             Vec3, InputState, VehicleState, AppStatus
      math.ts              clamp, lerp, moveTowards, wrapAngle, damp
      coordinates.ts       THE coordinate convention + forward/right helpers + toRenderSpace
      units.ts             Display-unit conversions (rad->deg, m/s->km/h)
    config/                All tuning values (single source of truth)
      vehicleConfig.ts     VehicleConfig + VEHICLE_CONFIG (SI units, placeholders)
      cameraConfig.ts      CHASE_CAMERA_CONFIG
      simulationConfig.ts  Fixed step, frame clamp, substep cap, publish intervals, spawn
      worldConfig.ts       Lanes, road extent, markers, ground size
    engine/                The simulation clock
      fixedStep.ts         Pure fixed-timestep planner (accumulator + alpha)
      gameSimulation.ts    Owns authoritative VehicleState; update() and interpolated getRenderState()
    simulation/
      vehicle.ts           Pure kinematic bicycle model: stepVehicle(state, input, config, dt)
    input/
      keyBindings.ts       Key code -> InputState mapping (pure)
      inputController.ts   DOM listeners; attach(window) returns detach; sample() per frame
    camera/
      chaseCamera.ts       Pure chase-camera goals and damped update (simulation space)
    world/
      roadLayout.ts        Pure road geometry data: lane centers, dashes, markers, bounds
    render/                Everything that touches Three.js
      SimRoot.tsx          The single mirror group (scale 1,1,-1) that hosts sim-space objects
      RenderLayer.tsx      Lights + SimRoot content + GameLoopDriver
      GameLoopDriver.tsx   Thin R3F adapter: the ONLY useFrame in the app
      renderLoop.ts        RenderLoop class: per-frame orchestration (input, sim, pose, camera, publish)
      renderSpace.ts       Render helpers for objects outside SimRoot (camera) and bounds conversion
      WorldGeometry.tsx    Ground, road, lane lines, distance markers (procedural)
      VehicleModel.tsx     Placeholder procedural car (nose toward +Z)
    state/
      appStore.ts          Zustand: app status, HUD speed (~10 Hz)
    ui/
      Hud.tsx              Speed readout and control hints
    diagnostics/           Development-only instrumentation
      diagnosticsStore.ts  Zustand: snapshot, errors, panel visibility
      snapshot.ts          Serializable snapshot builder
      format.ts            Snapshot -> labeled rows (pure)
      visibility.ts        Frustum checks
      errorCapture.ts      Observe-only window error / unhandledrejection capture
      DebugPanel.tsx       Overlay, toggled with the backtick key
```

Test files live beside their sources as `*.test.ts`.

## 5. Coordinate convention (authoritative)

Simulation and world space (used by simulation, camera math, road data, input, and AI in future):

- **+X = right, +Y = up, +Z = forward.** Units: meters. Angles: radians. Time: seconds.
- **Vehicle local forward = +Z**, local right = +X, local up = +Y. The vehicle origin is the **rear-axle
  center on the ground**. The mesh is built so that the nose is at +Z.
- **Yaw θ** rotates about +Y. θ = 0 faces +Z. **θ increases when turning right.**
  - `forward(θ) = (sin θ, 0, cos θ)`
  - `right(θ)   = (cos θ, 0, -sin θ)` (forward rotated 90° clockwise seen from above)
- **Steering:** D / ArrowRight → steer = +1 (right). A / ArrowLeft → steer = −1 (left).
  Positive steer angle produces positive yaw rate while moving forward, and the nose moves toward +X.
  While reversing, the turn direction flips, as with a real car.
- **Camera:** behind the rear axle along −forward, raised, looking ahead of the vehicle.

### Why the render layer mirrors Z

The brief's axes (+X right, +Z forward, +Y up) form a **left-handed** frame. Three.js is **right-handed**.
Taken literally, a camera behind a car facing +Z would show the car's right side on the screen's **left**,
so D would steer toward the wrong side of the screen.

The resolution, verified numerically in `src/render/renderSpace.test.ts`:

1. Simulation keeps the brief's convention exactly.
2. All sim-space objects live under `SimRoot`, a `<group scale={[1, 1, -1]}>`. This is the **only**
   mirror in the code base.
3. The camera sits **outside** `SimRoot`. Its free points are converted with `toRenderSpace()`
   (`z → −z`), and its look-at direction comes from that conversion.

Tests check that a simulation-right direction projects to positive screen X from the chase camera at
several yaw values, and that the vehicle nose and right side land where the math predicts under `SimRoot`.
In headless browser runs, holding D moved the car toward +X and it appeared on the screen's right.

Rules:
- Never apply a Z flip anywhere else. Never add a second mirror group.
- Objects inside `SimRoot` use simulation coordinates directly.
- Only camera or free-standing render values use `toRenderSpace`.

## 6. Physics update strategy

- **One authoritative loop.** R3F's `useFrame` (driven by `GameLoopDriver`) is the only per-frame
  callback. It calls `RenderLoop.tick()`, which runs these steps in order:
  1. sample input once for the frame
  2. `GameSimulation.update(frameSeconds, input)`
  3. write the interpolated pose to the vehicle object and camera
  4. publish throttled HUD and diagnostics values
- **Fixed timestep:** `FIXED_STEP_SECONDS = 1/60`. Real frame time accumulates. Frames are clamped to
  `MAX_FRAME_SECONDS = 0.25`, and at most `MAX_SUBSTEPS_PER_FRAME = 8` steps run per frame.
  Excess time is discarded and reported in diagnostics as `dropped`, which prevents a spiral of death.
- **Interpolation:** rendering uses `lerp(previous, current, alpha)`, with `alpha` in [0, 1) from the
  accumulator. Yaw uses the shortest angular path.
- **Input** is sampled once per frame and held for all substeps in that frame.
- **React never drives simulation.** React state is updated at about 10 Hz (HUD) and about 5 Hz
  (diagnostics). Per-frame values never go through Zustand.
- **Vehicle model:** kinematic bicycle in the ground plane.
  `yawRate = clamp(v·tan(δ)/L, ±a_lat_max/|v|)` and position advances along the midpoint heading.
  Throttle, brake, and reverse are handled in `simulation/vehicle.ts`. Braking from any positive speed
  decelerates to exactly 0. Reverse engages only while stopped and braking. Steering authority tapers
  toward top speed.

## 7. Input architecture

- `InputController` attaches `keydown`, `keyup`, and `blur` listeners to `window`. `blur` clears held keys.
- Key bindings use `KeyboardEvent.code` (physical position), so WASD stays on the same keys across layouts.
- Arrow keys call `preventDefault` so they do not scroll the page. Only bound codes are affected.
- `keysToInput(pressed)` is a pure mapping. Left + right cancel to 0 steer.
- The controller holds no React state and is read only by the loop.

| Action | Keys |
|---|---|
| Throttle | W / ArrowUp |
| Brake / reverse | S / ArrowDown |
| Steer left | A / ArrowLeft |
| Steer right | D / ArrowRight |
| Toggle dev panel (dev only) | Backtick (`` ` ``) |

## 8. Camera architecture

- Chase-camera math (`camera/chaseCamera.ts`) is pure and runs in simulation space.
- Goals: position = rear axle − forward × 7.5 m, +2.8 m height. Look-at = rear axle + forward × 12 m, +1.0 m height.
- Position and look-at are smoothed with frame-rate-independent exponential damping (`core/math.ts damp`).
  The first update snaps to the goal.
- The camera is named `ChaseCamera` and is the only camera. Its FOV is 62°, near 0.1 m, far 3000 m.
  Fog begins at 180 m and reaches full strength at 1500 m.

## 9. Asset-loading conventions

- **Phase 0 loads no external assets.** All geometry is procedural (road, ground, car, markers).
- Planned convention for later phases: models and textures in `public/assets/{models,textures,audio}/`,
  loaded through a single loader module that caches by URL and disposes on unload. Asset load status
  will then be reported in diagnostics. Until then, diagnostics report `external models: 0`,
  `external textures: 0`.
- Textures will need an explicit colorSpace (sRGB for color maps).

## 10. Diagnostics (development only)

- Enabled only when `import.meta.env.DEV` is true. The debug panel is lazy-loaded and absent from production.
  Error capture is installed only in dev.
- Toggle with the backtick key. The panel is non-interactive (`pointer-events: none`).
- Reports:
  - renderer status, backend (WebGL2), draw calls, triangles
  - active camera name, sim-space position and look-at, FOV, near, far
  - vehicle position, yaw, sim and render forward vectors, speed, wheel angle, yaw rate
  - input values and held key codes
  - physics mode, fixed step, steps run, dropped time, interpolation alpha
  - asset mode and counts
  - frustum visibility of the vehicle and of the road (AABB test, no occlusion)
  - captured runtime errors (window error and unhandled rejection), with a cap of 20
- The check is observe-only. Errors are never swallowed, and `preventDefault` is never called.

## 11. Engineering standards

- TypeScript `strict`, plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
  and `verbatimModuleSyntax`. No `any` (lint-enforced).
- Tuning values live only in `src/config/`. Components never hardcode gameplay numbers.
- Simulation values use SI units. Convert to display units only at presentation boundaries
  (`core/units.ts`).
- Simulation modules do not import Three.js or React. Render modules do not own simulation state.
- No circular imports (review manually when adding modules).
- Dispose: R3F disposes JSX-declared geometries and materials on unmount. Input listeners are removed
  by the function returned from `attach()`. Error listeners are removed by the function returned from
  `installRuntimeErrorCapture()`. Any future manually created `Object3D` resources must be disposed
  explicitly.
- Keep `RenderLoop`, which orchestrates the frame, separate from the thin React adapter. React-hooks v7
  compiler rules forbid mutating hook-captured values inside `useFrame`.

## 12. Current implementation status

Implemented and verified:
- Project scaffold with pinned versions, strict TypeScript, ESLint, Vitest, and Vite
- Coordinate convention with a documented render-side mirror
- Fixed-timestep simulation with interpolation and a single R3F frame driver
- Kinematic bicycle vehicle model with throttle, brake, reverse, steering rate limit, speed-tapered
  steering, and a lateral-acceleration cap (all placeholder tuning)
- Keyboard input with physical key mapping and blur reset
- Chase camera with damping
- Placeholder world: ground, a 3-lane road with dashed and edge lines, and distance markers every 100 m
- Placeholder procedural car with a yellow nose marker
- HUD speed readout and control hints
- Dev-only diagnostics panel and error capture

Not implemented (do not describe as done):
- Collision detection and road constraints (the car can drive off the road into the grass)
- Physics engine (Rapier)
- Traffic, police AI, career, progression, missions, menus, and HUD beyond speed
- Audio
- Persistent data (save, settings)
- External assets, asset loader, and real vehicle models
- GSAP presentation work
- Mobile or touch input
- Automated browser tests

## 13. Known issues

- **Vehicle leaves the road.** There are no road constraints. Expected for Phase 0.
- **Simulated time can fall behind wall time** on slow renderers (software WebGL in headless runs).
  The cap drops excess time and reports it as `dropped`. This is intentional, but it means
  slow-motion on very slow machines.
- **Frustum visibility is coarse.** The road is checked as one whole-length bounding box, so "road in view"
  is true whenever any part of it is in frustum. The vehicle check is also AABB-based.
- **Bundle size warning.** The main chunk is about 1.15 MB (about 316 kB gzipped), mostly Three.js.
  Code-splitting the renderer is a later optimization.
- **Third-party console warning.** R3F 9.8.2 uses `THREE.Clock` internally, which Three.js r186 marks
  deprecated (`THREE.Timer` is the replacement). This is not project code. Re-check when R3F updates.
- **Dev-only diagnostics overhead** is small, but it is still active whenever `npm run dev` runs.

## 14. Tests that must pass

Run `npm test`. Currently 75 tests across 9 files:

- `core/coordinates.test.ts`: forward/right convention, right = forward rotated clockwise, toRenderSpace
- `core/math.test.ts`: clamp, moveTowards, wrapAngle, shortest angle, damping
- `render/renderSpace.test.ts`: uses real Three.js math to check the mirror. A camera's screen-right matches the
  simulation-right direction. The SimRoot mirror places the nose and right side correctly. Bounds flip correctly.
- `simulation/vehicle.test.ts`: longitudinal limits, braking stops without overshoot, reverse only when braking
  at standstill, coasting, steer-right raises yaw and moves +X, steer-left the reverse, rate-limited steering,
  lateral cap, determinism, no mutation
- `engine/fixedStep.test.ts`: step planning, remainder, step cap, invalid frame times
- `engine/gameSimulation.test.ts`: fixed-step advancement, frame-rate independence, interpolation
- `input/keyBindings.test.ts`: key mapping, left + right cancel
- `camera/chaseCamera.test.ts`: goals behind and ahead, snapping, convergence
- `world/roadLayout.test.ts`: lane geometry, dashes, markers, bounds

Any change to conventions must update the mirror tests and this document together.

## 15. Commands

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

Node 20.19+ or 22.12+ is required (Vite 8).

Verification done in Phase 0 (headless Chromium via Playwright, outside the project):
- Dev server: the page loads with zero runtime errors and WebGL2 is active. Holding D raised yaw to 54° and moved the car
  toward +X. Left steer reduced yaw. The backtick key toggled the panel. Screenshots confirmed the car on the road and
  the steer-right drift toward screen-right.
- Production build (`vite preview`): HUD speed updates, the debug panel is absent, and the only console warning is the
  third-party `THREE.Clock` deprecation (section 13).
- Production bundle contains no debug strings and no debug chunk.

## 16. Rules for future development prompts

1. Read this document first. Verify the state against the code before trusting it.
2. Do not change the coordinate convention without updating section 5, the mirror tests, and `coordinates.ts`.
3. Never add a second render mirror. Never add a second `useFrame` loop. Put per-frame work in `RenderLoop`.
4. Simulation modules stay free of React and Three.js. Config values go in `src/config/`.
5. React state is for low-frequency values only (at most about 10 Hz). Never store per-frame simulation data in Zustand.
6. Do not swallow errors: no empty catch blocks, no `any`, no disabled type checks.
7. Add a Rapier or GSAP dependency only in the phase that uses it, and record the exact version here.
8. Mark items as done only after the tests pass and the behavior is verified.
9. Update section 12 (status), section 13 (known issues), and section 14 (tests) at the end of every phase.
