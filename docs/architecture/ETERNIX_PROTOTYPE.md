# ETERNIX landing and loading prototype

Status: development preview. Not linked from the home page or the game. Not in `dist/`. Integration into the default game waits for approval.

## Route

- Run `npm run dev`, then open `/` (for example `http://localhost:5173/`). The ETERNIX landing is `index.html`, the front page.
- `index.html` is the landing. ENTER GAME does not navigate: the camera swings to the back view, the game mounts behind a translucent loading page, and the page reveals it (`play.html` is unchanged as the standalone game). Leaving the game (the HUD's Leave) runs the same handoff in reverse.

## Layout and copy

- Wordmark: monoline SVG, centred in the upper third (as in the reference). Under it, the tagline "DRIVE WITHOUT END".
- No header nav. The one garage entry point is the `GARAGE` button under `ENTER GAME`; in the garage the same button reads `LANDING`.
- Primary action: `ENTER GAME`. It swings the camera to the back view, runs the real loading steps, and mounts the game behind the loading page (in-page handoff, below).
- Bottom left: `ENTER GAME` with an arrow. Bottom right: real save status only (car, paint, credits, save status) and the keyboard controls.
- No headline, slogan, stats, or invented profile information. The earlier headline "THE CITY NEVER SLEEPS" and its supporting line are removed.
- `GARAGE` toggles an in-page showroom that uses the game's `GaragePreview`.
- `CAREER`, `WORLD MAP`, and `SETTINGS` are not shown. They exist only inside the game (keys C and V). There is no picker or settings screen in the prototype.

## Hero

- Procedural street stage in the game's road dimensions (`heroLayout.ts`, seeded with mulberry32, seed `20261017`). Kerbs, pavements, lane markings, dashes, lamps, buildings, and a small number of lit windows.
- The hero car is the player's active car in their chosen paint, drawn by the game's own `VehicleVisual` (through `ActiveCar.tsx`). Its origin is shifted so the body centre sits on the stage origin. The garage uses the same component.
- Camera: seven fixed views (`heroViews.ts`, in order around the car: low rear three-quarter, high front three-quarter, front, front three-quarter, side profile, rear three-quarter, rear). The view changes every 15 s (`heroViews.intervalSeconds`) and swings there with an exponential ease. A slow drift runs on top.
- Scene, following the reference's night-city mood with our own assets only (the mood is now set by the shared environment, see below): a near row of buildings, a far skyline (taller, denser lit windows), red and white light trails in the lanes (unlit boxes), and a red point light at the tail that lights the road behind the car. Asphalt roughness is lowered for a wet look.
- Environment: the same time of day and weather as the game (see "Shared environment"). `HeroEnvironment.tsx` sets the sky, fog, hemisphere and key light, tail light, and rain. `heroLightLevels.ts` scales the hero's own rig from the shared values, so day is the rig as configured. The road material is registered with the game's asphalt wetness. Studio reflections from `RoomEnvironment` through PMREM (`attachStudioEnvironment`). No glow, bloom, particles, blur, or post-processing.
- Trails sit in a band ahead of the camera (`trailZMinMeters` to `trailZMaxMeters`), so none sits under the lens.
- Camera: a slow drift at rest, a 3 s move to the back view on ENTER GAME (`handoffMoveSeconds`), the reverse move on return, and narrow framing on small screens. The move to the back view turns the short way from any angle; from the back view it makes a full 360° turn (`cameraMove.ts`, `handoffBackViewRadians` for the tolerance). The return swings back to the angle the page was left at, with the same rule. Tuning is in `src/config/eternixPrototypeConfig.ts`.
- Garage: the same active car, on a studio floor. The key light, fill light, background, and floor follow the shared environment (`src/prototype/eternix/studioLighting.ts`): the key and fill colour and strength follow the time of day, the background and floor take a small share of the sky colour (6% and 5%, so the studio stays dark), and the floor goes glossy in rain. The red rim, the studio reflections, and the layout stay fixed. The studio stays dark at every setting, so the paint and the car stand out. Checked in `tools/browser-garage-env.py` (day clear, evening clear, night rain: 3 of 3 showed the right environment, screenshots in `browser-output/garage-env/`).
- Reduced motion: CSS motion is disabled, and the R3F frameloop runs on demand. Views and the camera moves cut instead of swinging, and the bars and ticks show their state at once. The timings do not change. Rain is drawn but does not animate while on demand.

## Shared environment (home page and game)

- Time of day and weather change by themselves every 5 minutes (`ENVIRONMENT_CHANGE_SECONDS` = 300 in `environmentConfig.ts`). Each change is a random pair, never the same pair as the current one (`pickNextEnvironment`).
- A fresh start (nothing saved, or the saved record has expired) is day and clear, whatever the device clock says (`DEFAULT_ENVIRONMENT` in `environmentClock.ts`). The device clock no longer sets the start.
- The current environment is saved in localStorage under `street-racer.environment.v1`, separate from the game save. The home page and the game read it, so they match, and each picks up the other's change at once. The save is never written by the home page.
- The clock (`src/state/environmentClock.ts`) runs from `main.tsx` (game) and from the prototype's `main.tsx`. It applies the stored environment at once, then schedules the next change for the end of the 5-minute interval. A fresher record from another page is adopted.
- The game's `Environment` and the hero use the same live blend (`src/render/liveLighting.ts`). A load starts at its environment and does not blend in from day.
- The N and M keys in the game still change the time and weather by hand. The next 5-minute change replaces that.

## Files

- `index.html`: the front page (`noindex`, "DRIVE WITHOUT END" tagline).
- `src/config/eternixPrototypeConfig.ts`: all tuning (camera, road, lighting, scenery, timings, colours).
- `src/prototype/eternix/EternixPrototype.tsx`: the phase machine (landing, entering, loading, revealing, game, leaving, returning), the showroom toggle, and the loading veil.
- `src/prototype/eternix/cameraMove.ts` and `cameraMove.test.ts`: the back view, the sweep rule (full turn only when both ends are the back view), easing, and the pose along a move.
- `src/prototype/eternix/CanvasProbe.tsx`: calls `onReady` once a canvas is drawn in its nearest `scope` ancestor. Used by the game layer and by the front page on return.
- `src/prototype/eternix/HeroStage.tsx`: the hero scene (R3F).
- `src/prototype/eternix/heroLayout.ts`: pure street layout as box specs.
- `src/prototype/eternix/ActiveCar.tsx`: the player's active car (`VehicleVisual`), shifted so the body centre is at the origin. Used by the hero and the garage.
- `src/prototype/eternix/heroViews.ts` and `heroViews.test.ts`: the seven camera views, the view cycle, and the body-centre offset.
- `src/prototype/eternix/HeroEnvironment.tsx`: the hero's sky, fog, lights, rain, and road wetness, from the shared environment.
- `src/prototype/eternix/heroLightLevels.ts` and `heroLightLevels.test.ts`: maps the shared values onto the hero's light rig.
- The earlier hatchback-only hero (`HeroCar.tsx`, `heroCar.ts`, `heroLoft.ts`) was removed when the hero switched to the active car.
- `src/prototype/eternix/Wordmark.tsx`: original SVG wordmark.
- `src/prototype/eternix/readiness.ts`: the pure step runner.
- `src/prototype/eternix/entryTiming.ts` and `entryTiming.test.ts`: `canReveal()` (the gate that lets the game replace the loading page) and `canReturn()` (the gate that lets the front page take over on the way back).
- `src/prototype/eternix/GameLayer.tsx`: the game (`App`), lazy-loaded and mounted behind the landing when ENTER GAME is pressed. Its HUD's Leave goes to `onLeave` (in-page), so `play.html` still leaves to the front page.
- `src/prototype/eternix/readinessSteps.ts`: the real loading steps, and `loadGameModules` (memoised `import('../../App')`, shared by the preload and the code step).
- `src/prototype/eternix/once.ts`: `createRetryableOnce`. Failures are not cached, so Retry works.
- `src/prototype/eternix/saveSnapshot.ts`: a read-only save snapshot. It uses the game's load rule with a storage object that refuses writes.
- `src/prototype/eternix/eternix.css`: styles, scoped to `.ex-`. System font stack. The loading veil, bars and ticks, the layers, and the mobile rules at 720 px and below. Reduced-motion override.
- Tests: `readiness.test.ts`, `heroLayout.test.ts`, `heroViews.test.ts`, `heroLightLevels.test.ts`, `showroomOrbit.test.ts`, `once.test.ts`, `copy.test.ts`. Run `vitest run src/prototype/eternix` for the current count.

## Loading steps (real work, no timers)

1. Checking graphics: WebGL probe. Failure stops the run and shows the reason.
2. Reading your save: read-only save load.
3. Loading your car: selected car and paint from the save.
4. Loading game code: `import('../../App')`. This is the real module download and evaluation.
5. Preparing the road: `getWorldDefinition('loop')`.

- The game modules are preloaded 900 ms after mount, so a warm entry can skip the loader.
- ENTER GAME shows the loading page at once, and the game mounts behind it (no page navigation).
- Layout: the loading veil is centred on the screen, over a translucent dark panel. One bar per real step, plus a bar for the game's canvas. The bars complete one at a time: each bar runs for its own random time between 0.3 s and 0.7 s (`loadingBarMinSeconds`, `loadingBarMaxSeconds`, `loadingBars.ts`), and it ticks only once its real step is also done. The next bar then starts. The count reads "n of 6 ready".
- Failure shows the failed step and its message, with Retry and a link to `./play.html`. The game layer is unmounted.
- Cancel unmounts the game layer, resets the state, and restarts the landing camera (any move still running is stopped).
- The in-page handoff timeline (forward, ENTER GAME):
  1. 0 s: the camera swings from its current angle to the back view over 3 s (`handoffMoveSeconds`). A camera already at the back view turns a full 360° instead. Nothing else starts during the swing: the game and the loading steps wait for the veil, so the swing has the main thread to itself.
  2. 3 s: the translucent loading page appears (`.ex-veil`), the game mounts behind it, and the loading steps start. The bars then complete one at a time, each in a random 0.3 to 0.7 s, and each ticks once its real step is done. The reveal waits for all six bars, the game's canvas, the steps, and the 3 s hold (`handoffLoadSeconds`). The front-page canvas is not rendered while the veil is up.
  3. Reveal: when the steps are ready, the game's canvas is drawn (`CanvasProbe`), and the 3 s hold has passed (`canReveal`), the veil fades over `revealFadeMs` (450 ms), and the game is shown on its own and takes input.
- The reverse trip (Leave, then Leave in the confirm):
  1. The loading page appears over the game with "Back to the front page", and bars for "Leaving the road" and "Drawing the front page". It holds for at least 3 s.
  2. The front page is drawn behind the veil (`CanvasProbe`), then the camera swings from the back view to the angle the page was left at (saved from the camera's pose when ENTER GAME was pressed), with the same full-turn rule.
  3. The veil fades over 450 ms. The game is removed 3 s after the return starts, and the front page is the page again. The save is re-read at the return.
- Known limitations: the game's keyboard input is live under the veil (WASD still drives the car behind it). From the garage view, ENTER GAME only returns to the landing view; the camera moves start from the landing. The first frames of the game may still be filling in at reveal, and the bars are not tied to the game's world build.

## Verified (see the report for exact commands and results)

- Type check, lint, prototype unit tests, and full `npm run check`.
- Browser (earlier): desktop and mobile landing, showroom toggle, reduced motion, console errors, the loader's real steps, the WebGL-disabled error panel, and save-file integrity across a full entry (these were run against the old navigation handoff).
- Browser (in-page handoff, 3 s move and 3 s veil): `tools/browser-handoff.py` 9/9 PASS. The veil first shows 6.1 s after the click (the 3 s swing plus render delay under software GL), held 9.97 s before it fades, 6 of 6 ticks and the game canvas at the reveal, the front page stage visible during the swing, the return veil held 10.8 s, the game layer gone 5.5 s after the return starts, the front page back at the end, and no page or console errors. Software GL runs at about 1 fps, so these are not real-GPU timings. Screenshots take 5 to 10 s here and the veil lasts only 3 to 10 s, so no screenshot of the veil was captured; the veil is verified through the page-side state log (`browser-output/handoff/handoff_report.json`) and the front-page and game frames (`handoff-return.png`, `handoff-final.png`).

## Not done / limitations

- No career or world-select UI. Career and the in-game garage are reached from inside the game (C and V).
- No settings screen. Time of day and weather change by themselves every 5 minutes, shared with the game. The game's N and M keys still cycle them by hand.
- The hero is not the in-game city. It is a procedural road stand-in that uses the real car.
- The hero and the garage show the player's active car, in their chosen paint, using the game's car model. The car name and class are shown in the status text.
- The hero is a procedural model. It reads as a rounded, bubble-like hatch, not a sleek or aggressive car. It has no door seams, no interior, and no fine detail such as a diffuser or badging.
- Quality gap: the reference image is a photoreal render. Procedural geometry with standard materials and the studio environment does not reach that. The route is still open. Options are a generated original still, a licensed or original 3D model, or a sustained procedural rebuild. Each needs your decision.
- The showroom uses the existing `GaragePreview`, which is unchanged. At this size it crops the car at the canvas edge in the turn view.
- The light trails are flat boxes. They read as lane lines more than as motion streaks. Real motion blur would need post-processing, which this prototype avoids.
- The far skyline is still faint. The near walls take up much of the upper frame at desktop size.
- Compared with the reference (a photoreal render): the car and the scene are procedural, so the render is clearly stylised. Matching it closely needs an original hero model or still, which is an open decision.
- Save-corruption and newer-build paths are covered by the existing save tests. They are not browser-tested here.
- Keyboard-only input. No touch controls in the game.
- Not measured on real hardware: frame rate, GPU memory, and the first-paint time of the hero.
