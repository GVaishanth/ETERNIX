# Architecture overview

This describes the code as it is in the repository. It is not a design brief. For the decisions behind each system,
see [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) (the development log) and the plans in [../plans/](../plans/).

## Two pages, one build

The build produces two static pages.

| Page | Entry | What it does |
| --- | --- | --- |
| `index.html` | `src/prototype/eternix/main.tsx` | The ETERNIX front page: landing, garage showroom, and a loader that checks real readiness. `ENTER GAME` opens `play.html`. |
| `play.html` | `src/main.tsx`, then `src/App.tsx` | The game: the simulation, renderer, HUD, garage, career, races, and pursuit. |

The front page's loader imports game modules to check that they load. It does not mount the game. Both pages are plain
static files, so there is no server code and no client-side router.

## Layers

Dependencies point downwards. The simulation does not import React.

```
UI (React)            src/ui, src/prototype/eternix, src/diagnostics (dev panel)
  |  reads stores      src/state (zustand)
Render (three.js)     src/render (R3F components and the render loop)
  |  reads snapshots   src/engine, src/simulation (fixed step, no React)
Game systems          src/world, src/traffic, src/ai, src/pursuit, src/race,
                      src/career, src/garage, src/vehicles, src/navigation, src/audio
Data                  src/config (tuning), src/save (localStorage), src/core (types, units)
```

- **Simulation** (`src/engine/gameSimulation.ts`, `src/simulation/`): a fixed-step simulation of the car, with grip, drift,
  wheel spin, and road boundaries. It is independent of React and the renderer.
- **Render loop** (`src/render/renderLoop.ts`): each frame samples input, advances the simulation, and updates the
  three.js scene and the chase camera. The loop does not advance the car while the game is paused, while the garage or career
  hub is open, or while a confirmation popup is open.
- **Stores** (`src/state/`): small zustand stores for UI and HUD state, such as the app pause flag, garage and career panels,
  the race state, and the confirmation popup. The garage's persistent state lives in `src/garage/garageService.ts`.
- **Tuning** (`src/config/`): every tuning value lives here, not inside the systems that use it.

## Game systems

| System | Location | Notes |
| --- | --- | --- |
| Driving and physics | `src/simulation/`, `src/engine/` | Fixed-step, SI units (metres, seconds, kilograms). |
| Worlds and roads | `src/world/` | The default world is `loop` (wraps at its edges). `?world=city` loads the finite city. Road lanes are 3.6 m, 4 lanes. |
| Streaming and wrap | `src/world/streaming/`, `src/world/wrap/` | Chunks are built as the car moves and released when it leaves range. |
| Traffic and AI | `src/traffic/`, `src/ai/` | Traffic cars and rival drivers. |
| Police pursuit | `src/pursuit/` | Detection, pursuit, escape, and cooldown. Police do not start automatically when the car enters the city. |
| Races | `src/race/` | Free-roam races. `E` confirms a race start and `Q` cancels it. |
| Career | `src/career/` | Division 1 is populated. Divisions 2 to 5 are planned only (see the career plan). |
| Garage | `src/garage/`, `src/ui/Garage.tsx` | Buy cars with credits, upgrade in tiers, paint, and choose the active car. Each purchase asks for confirmation. |
| Vehicles | `src/vehicles/`, `src/config/vehicleCatalogue.ts` | 32 catalogue entries (20 original, 12 added in the fleet tranche). The save refers to vehicles by id only. Dev-only fleet preview: `fleet.html?id=<id>&view=<view>`. |
| Navigation | `src/navigation/`, `src/ui/Minimap.tsx` | Minimap route to the next checkpoint or destination. |
| Audio | `src/audio/` | Synthesized with the Web Audio API. There are no audio files. |
| Save | `src/save/saveFile.ts` | Browser local storage. See the README for the keys. |
| Input | `src/input/` | Keyboard only. Key bindings and the control text shown in the Info panel. |
| Diagnostics | `src/diagnostics/` | A panel in every build, hidden by default (Shift + `). Some debug hooks are development-only. |

## Assets

- **No external models, textures, or audio files.** The car, roads, buildings, and effects are built from procedural
  geometry in code.
- **Public files** (`public/`) are the icons, the web manifest, and `.nojekyll`. Vite copies them into the build unchanged.
- **Documentation images** (`docs/assets/`) are screenshots and the social preview. They are not loaded by the game.

## Conventions

- TypeScript in strict mode. The type checker and linter run in `npm run check`. Do not disable them to pass a change.
- No `any`. No empty `catch` blocks.
- Tuning values belong in `src/config/`.
- Resources that are created with three.js (geometries, materials, textures, render targets) are disposed when they are
  no longer used.
- Test files sit next to the code they test, as `*.test.ts`.

## Testing

- **Unit and integration tests** (`src/**/*.test.ts`, run by Vitest) cover the simulation, the world, races, career,
  garage, save handling, and the front page's copy and readiness logic. Run them with `npm test`.
- **Browser scripts** (`tools/`, Python with Playwright) drive the built game in headless Chromium for the flows that the
  unit tests cannot see. They need a running server. See [../development/SETUP.md](../development/SETUP.md).
