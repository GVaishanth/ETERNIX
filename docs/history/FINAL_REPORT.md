# Part 6: Racing events. Final report

**Status: not closed.** Sprint works end to end in the browser on the final code. The Circuit passed 5 of its last 6
browser runs. The sixth missed a checkpoint, and the cause is still unknown. Step F (three opponents) was not attempted.
Across nine Circuit runs on the restarted server (J3 to J11), J3 is the only miss. Reliability (explicit step R) passes 10/10: repeated start and cancel, pause and resume, abort and retry, and no input
lock after exit. Rapid crossings in the browser and separate HUD reviews for Steps G, H, and I are not done (see "Not
run"). Part 6 should not be marked complete until those are done or explicitly waived.

## What changed in this round

1. **Relocation can no longer skip a gate.** A recovery or reset that would move the progress estimate past the next
   expected gate now holds the estimate at that gate. It emits `relocation-held`, counts it in `relocationsHeld`, and
   shows the notice "Relocated past Checkpoint N: drive back through it". The gate counts only after a real forward
   crossing. Covered by three new unit tests and one updated test in `src/race/raceProgress.test.ts`. Before this
   change, a teleport past an unpassed gate re-anchored silently, and the gate could never be counted.
2. **R clears AI traffic (reverses a Part 5 decision).** The browser road check found that an AI car already on the road
   drove into the player after R. Measured: a `player-traffic` contact within 300 ms of R. R now calls
   `GameSimulation.resetTraffic()` after placing the car. The spawner's rules keep new traffic away from the player.
   R stays refused for the whole race, so race opponents are unaffected. Part 5's "R resets the player only" is revised
   in `PROJECT_CONTEXT.md` section 18.
3. **Minimap race marks.** A ring for each event marker that is not in progress, and a diamond for the next gate. The
   store is `src/ui/minimapRaceMarks.ts`, written by `src/render/raceVisuals.ts`. The rings are seen in a screenshot
   (free roam). The diamond is only code-checked.
4. **`playerTrace` is DEV-only** (`import.meta.env.DEV`). The production bundle contains only `playerTrace:null` as the
   store default. The trace now includes `relocationsHeld`.
5. **Environment:** headless Chromium needed system libraries after the snapshot restore. They were installed with
   `playwright install-deps chromium`.

## Features (Part 6, cumulative)

- **Race data model and state machine** (`src/race/raceTypes.ts`, `raceStateMachine.ts`, `raceSession.ts`,
  `raceDirector.ts`). Transitions are a table. An unexpected transition is recorded as a diagnostic and not applied.
- **Route building and validation** (`raceRoute.ts`). Routes sit on the connected road graph. Invalid routes are refused
  with `RouteIssue` codes. Nothing is repaired silently.
- **Events as data** (`raceEvents.ts`). `SPRINT_EASTSIDE` (Sprint, 2 rivals, 240 s limit, base reward 300) and
  `CIRCUIT_BLOCK` (Circuit, 2 laps, 2 rivals, no time limit, base reward 400).
- **Sprint:** marker, approach card, E to start, Q to cancel, 3-2-1-GO countdown on a grid, timer from GO, ordered
  checkpoints, finish only after all gates, results once, retry, leave to free roam.
- **Circuit:** two laps of one shared framework. Per-lap gates A, B, then Start/Finish. A lap counts only after all
  gates. Retry resets the lap counter and gates.
- **Opponents** (`src/ai/aiOpponents.ts`, `aiController.ts`). Two rivals drive through the shared vehicle controller
  (`throttle`, `brake`, `steer`), the same fields as the player. No separate physics, no racing logic beyond following
  the route, no rubber-banding, and no teleporting. Finished rivals are retired from the track.
- **Progress and standings** (`raceProgress.ts`, `standings.ts`). Progress is measured along the route polyline from real
  positions. Gates are swept per step and count only in sequence. Standings use route distance, not straight-line distance.
- **Rewards** (`rewards.ts`). Provisional and session-only, since no profile exists. Granted at most once per attempt.
  Not granted on cancel or abort. Not duplicated on retry.
- **HUD and markers** (`RaceHud.tsx`, `render/raceVisuals.ts`). Compact HUD with countdown, lap, place, time, next
  checkpoint, abort, result card, and toast. Beacons mark each event, and a shared bar marks the next gate.
- **DEV diagnostics.** The debug panel, route debug, `RaceDebug` access, and `playerTrace` are DEV-only. The production
  bundle contains no debug API.

## Files changed (Part 6, including this round)

Created (Part 6):
- `src/config/raceConfig.ts`
- `src/race/`: `gates.ts`, `grid.ts`, `raceController.ts`, `raceDebug.ts`, `raceDirector.ts`, `raceEvents.ts`,
  `raceFormat.ts`, `raceProgress.ts`, `raceRoute.ts`, `raceSession.ts`, `raceStateMachine.ts`, `raceTypes.ts`,
  `rewards.ts`, `standings.ts`, and their `*.test.ts` files
- `src/state/raceStore.ts`
- `src/ui/RaceHud.tsx`, `src/ui/minimapRaceMarks.ts`
- `src/render/RaceLayer.tsx`, `src/render/raceVisuals.ts`
- `src/ai/raceRelease.test.ts`
- `tools/browser-race.py`

Changed (Part 6):
- `src/race/raceProgress.ts` and `raceProgress.test.ts` (relocation hold, this round)
- `src/race/raceDirector.ts` (notice for a held relocation, this round)
- `src/race/raceController.ts`, `src/state/raceStore.ts` (DEV `playerTrace` with `relocationsHeld`, this round)
- `src/render/renderLoop.ts` (R clears traffic, this round)
- `src/engine/gameSimulation.ts` (`resetTraffic` doc comment, this round)
- `src/ui/Minimap.tsx` (race marks, this round)
- `src/ai/aiOpponents.ts` (`lastInput` and `lastSource` for DEV diagnostics), `src/diagnostics/trafficDiagnostics.ts`
- `src/App.tsx`, `src/input/keyBindings.ts` (E and Q), `src/ui/Hud.tsx` (hint text)
- `tools/browser-road.py` (reset diagnostics: speed, pressed keys, traffic count and contacts in the trail, this round)
- `PROJECT_CONTEXT.md` sections 17.x, 18, 19

Parts 2 to 6 are still uncommitted. Many `.claude/skills/*.py` files show as modified in git status. These are not from
this work.

## Tests and results

Automated (Vitest), not browser:
- `npx vitest run`: **482/482 passed across 49 files**, after the final code change.
- `npx tsc --noEmit -p .`: exit 0. `./node_modules/.bin/eslint src`: exit 0.

Browser (`tools/browser-race.py` and related suites). These are automated driver runs, not manual play.

| Check | Result | Notes |
|---|---|---|
| E, Sprint (final relocation code) | 11/11 | 3rd of 3, +105 provisional, granted once. Retry with no duplicate reward. |
| J, Circuit (after relocation hold, J8) | 11/11 | FINISHED, 3rd of 3, +140 provisional. Relocations 0, held 0. |
| J, Circuit, earlier restarted-server runs | J4 to J7: 11/11 each | |
| J, Circuit, after relocation hold (J8 to J11) | 11/11 each | Relocations 0 in all four. |
| R, reliability (explicit step, this round) | 10/10 | Repeated start and cancel, pause and resume, abort and retry, input after exit. |
| J3 | **failed** | Missed Checkpoint B on lap 2. The run did not log relocations. Cause unknown. |
| Road (Part 3, latest) | **24/25** | Reset check now passes. Lane tracking fails at 3.05 m against 3.0 m (see below). |
| Traffic (Part 4, after R change) | 20/20 | |
| City (Part 5) | 24/24 | |
| Production preview (Part 5) | 7/7 | `vite preview` on the production build. |
| Smoke (Parts 1 and 2, legacy world, this round) | 60/60 | Rerun after the R change. |
| Errors (E, J) | no page or console errors | |

Not rerun after the R change: E and J. R is refused during a race, so the change does not touch race code paths, but
this is an inference, not a browser run.

**Road check, two open items:**
- **Reset (fixed):** the trail showed the player being hit by an AI car after R. R now clears traffic (see "What changed").
- **Lane tracking (open):** the keyboard-style pure-pursuit driver peaked at 3.05 m against the 3.0 m limit. Its earlier
  peaks were 2.55, 3.03, 3.60, and 4.66 m, so it depends on the run. This is a limit on the test driver, not a measured
  product fault. Options: tune the driver's speed envelope on arcs, or change the limit with a stated reason. The limit
  was not changed to force a pass.
- **Junction speed:** passes at 4.5 to 7.0 m/s (limit 5 m/s). Also borderline, and it depends on the driver.

Manual checks: none recorded as formal manual passes. Visual observations come from the screenshots below.

Screenshots: `/home/user/verification/part6/` (`C01`–`C05`, `E01_result.png`, `J01_circuit_card.png`,
`J02_circuit_result.png`, `minimap_free_roam.png`).

## Decisions

- **Relocation hold:** a relocation cannot skip a gate. Recovery that places a car past a gate costs that gate, and the
  player is told to drive back through it. This is deliberate.
- **R clears traffic:** revises the Part 5 rule. Traffic is cleared and respawns through the normal spawner. The city's
  ambient traffic will visibly reset on R.
- **Step F stays at two opponents.** The rule says to rise to three only if stable. Two is stable in the runs above, but
  the Circuit has one unexplained miss, so stability is not proven. Three was not run.

## Known bugs and limitations

1. **Open: intermittent missed checkpoint on the Circuit.** One failure in nine runs on the restarted server (J3). Every later run passed with
   relocations at 0. The cause is unknown. The J3 run did not log relocations. A fix must not silently skip gates.
2. **Open: road lane tracking at 3.05 m** against the 3.0 m limit, for a binary-steering test driver (see above).
3. **Three opponents not attempted** (Step F).
4. **The browser driver is a pure-pursuit bot, not `AiDriver`.** It rubs guardrails on the Circuit. This is a harness
   limitation.
5. **Finished rivals disappear from the track** (retirement). This is a presentation choice, with no animated exit.
6. **Sprint layout:** the last lane is a dead end about 90 m past the finish gate. This is not a failure cause in any run,
   but it limits future routes.
7. **Result text** was checked only for the two-rival case.
8. **DEV panel overlap:** in the DEV build the diagnostics panel covers part of the minimap. The production build has no panel.
9. **Mobile or touch:** not applicable. The project has no touch controls, and none were added.
10. **Rewards** are provisional and session-only. No profile exists, so nothing is persisted.
11. **Timing:** the headless browser runs at about half real time on two cores. Harness waits were lengthened for this. The
    race clock is the spec, so runs are not cut short.

## Not run (open)

- Step F: three-opponent runs. Not attempted.
- Steps G, H, I: separate manual HUD reviews. A mid-race screenshot (R01) shows the HUD, but this is not a full review.
- Rapid crossings in the browser. Covered by unit tests only.
- Opponent count after retry: checked by the E standings, not by a dedicated step.

## Production build

- `npm run build`: **exit 0** on the final code. The chunk-size warning remains.
- The debug API (`StreetRacerDebugApi`, `__STREET_RACER_DEBUG__`) is absent from `dist`. `playerTrace` is DEV-only. The
  production bundle contains only `playerTrace:null` as the store default.
- `tools/browser-prod.py` against `vite preview` of this build: 7/7.

## PROJECT_CONTEXT.md

Updated in this round: section 19 (relocation hold, latest browser results, open items), section 18 (R now clears traffic,
road results, open lane-tracking item), and section 17.x (the reset-versus-traffic decision).

---

# Part 9: Career mode. Final report

Status: built and verified for the scope below. Not committed. Part 10 was not started. Waiting for your review before any commit.

## Features

- Career profile in the existing save: started flag, reputation, completed and unlocked events, completed challenges, target, defeated rivals, milestones, granted rewards, processed attempts, and a data version. Stable ids only.
- Reputation, separate from credits, awarded only through one configured award path. Never negative.
- Ranks from config: Newcomer 0, Street Regular 40, Road Name 120, Night Contender 240, City Legend 380. Rank is derived, not stored.
- Unlocks from structured prerequisites (career started, prior event, rival defeat, reputation, vehicle ownership). A locked event returns each unmet reason.
- Career hub (C): rank and progress, reputation, counts, next rival, target, Events, Leaderboard, Milestones, Garage, Free roam.
- Four rivals in one chain: Mara Quill, Teo Varga, Juno Ashdown, Kai Mensah. Each has a stable id, original name, bio, style, vehicle, difficulty, prerequisites, and rewards. Defeat status lives only in progress.
- Challenges go through the existing race pipeline. The official result decides. A win defeats a rival once and pays its reward once. A loss defeats nothing and allows a retry.
- Milestones: five, one-time, credits only, one shared evaluator. The event milestone counts distinct completed events, so replays cannot farm it.
- Career outcome card after a career result, with the rewards and the next rival. A failed save shows the error with "Nothing was charged."
- Save schema 2 migration. Garage and balance are kept. Damaged and duplicate ids are repaired and reported. A newer career is kept read-only.

## Rank rules

Reputation thresholds and rank credit rewards are in `src/career/careerCatalogue.ts`. Rank rewards are paid once, at the first crossing. Boundaries are tested at each threshold and one below it.

## Rival functionality

- Leaderboard: standing rivals above the player in ladder order, then beaten rivals. Selecting a rival opens the challenge card with its requirements, its defeat reward, Accept (sets the target), and Cancel.
- Accept sets the target and closes the hub. The player drives to the marker and presses E. The hub never starts a race and never teleports the car.
- The race uses named per-race opponents through the existing director. A free-roam race keeps its generic labels.

## Files

Created: `src/config/careerConfig.ts`, `src/career/careerTypes.ts`, `careerCatalogue.ts`, `careerRaces.ts`, `careerModel.ts`, `careerService.ts`, `careerHubGate.ts`, `src/state/careerUiStore.ts`, `src/ui/CareerHub.tsx`, `src/ui/CareerLauncher.tsx`, `tools/browser-career.py`, and the test files `careerCatalogue.test.ts`, `careerModel.test.ts`, `careerService.test.ts`, `careerRaceIntegration.test.ts`.

Changed: `src/garage/garageService.ts` (one commit path, `commitProfile`), `src/garage/garageService.test.ts`, `src/save/saveFile.ts` and `saveFile.test.ts` (schema 2), `src/race/raceTypes.ts`, `raceDirector.ts`, `raceController.ts`, `src/App.tsx`, `src/input/keyBindings.ts` (`career` on KeyC), `src/render/renderLoop.ts` (pause and gate, `toggleCareer`), `src/styles.css`.

## Tests and results

Automated, run in this part:
- `tsc --noEmit`: exit 0.
- `eslint .`: exit 0.
- `vitest run`: 71 files, 787 tests, all passing. Before Part 9: 67 files, 680 tests.
- Per file: catalogue 15, careerModel 64, careerService 11, careerRaceIntegration 6, saveFile 21, garageService 16.

Browser, run in this part (`tools/browser-career.py`, DEV server, real input, headless Chromium):
- `hub`: 10/10.
- `hub race rival retry reload errors`: 33/33. The warm-up is completed through the race and its reward is paid once. The Mara race ends in a loss, with no defeat and no reward. The abort and retry grant nothing. A reload keeps everything. No page or console errors (known warnings excluded).
- Logs and screenshots: `/home/user/verification/part9/`.

Not run or not verified:
- A browser win against any rival. The win path is covered by automated tests on the real commit path only.
- Browser checks for Teo, Juno, and Kai.
- The locked refusal at E in the browser.
- The Garage button path from the hub in the browser.
- Mobile and touch: not applicable, the project has no touch controls.

## Bugs found and fixed in this part

- Attempt keys collided across sessions after a reload, because attempt ids restart at 1. Fixed by keying on a session id too.
- The saveFile test failed because its fixture used schema 1. The writer was not changed. The fixture now uses the current schema.
- A reloaded-reputation expectation was wrong (50). It is 55 (warm-up 10, objective 5, Mara 40). Later corrected to the browser's values.
- Free-roam race ids would have been paid twice if routed to the career service. App now routes only career ids.
- Browser harness, not product: the approach check accepted the previous race's card. It now waits for the challenge's own card. Found in run 2 and fixed in run 4.
- Browser harness, not product: hub expectations were wrong for a new career (events are locked before the start; the rival order puts Mara fourth, with you fifth). Expectations corrected to the rules.
- The result card's credit amount is now checked against the real balance change in the browser run.

## Decisions

- Career race beacons are always drawn. A locked career race refuses E with its reason.
- Opening the hub grants nothing. It is refused during a race or pursuit.
- Reputation is separate from credits. Milestones pay credits only.
- Career credits are paid in the same commit as the progress. The free-roam ledger skips career race ids.
- A finished result stays on screen until Q (the Part 6 rule).

## Known bugs and limitations

- Four rivals exist, not eight to twelve. The roster is deferred.
- Mara's pace is 20 m/s, not the planned 15 m/s. Not changed. Decision needed.
- Career race beacons have no locked visual style. Not built.
- The DEV diagnostics panel covers the career launcher and the race card when open. DEV-only. Not fixed.
- The career hub works only in the city world.
- Earlier open items: selling (21.13), the BUSTED fairness rule, and the Step F difficulty for three rivals.
- The Part 6 audit reads (`RaceHud.tsx`, the rest of `GarageLauncher.tsx`, the `toggleGarage` tail) were not re-read in this part.
- This report file did not have a Part 8 entry before this part. The Part 8 report was delivered in chat only.

## Production build

`npm run build`: success. `index.js` 1,380.05 kB (gzip 387.36 kB). Part 8 was 1,345.94 kB (gzip 377.31 kB). The build log is at `/home/user/verification/part9/build-final.txt`.

## PROJECT_CONTEXT.md

Section 22 is added, covering 22.1 to 22.13. It was written from the code and the test output. Items that are not verified are listed as such in 22.1, 22.11, and 22.12.

## Process note

The code was written before the docs. This is a process deviation from the plan. The docs were written afterward and checked against the code and the runs.

---

# Part 10: Presentation polish. Final report

## Summary
Part 10 added lighting (day, evening, night), rain, wet asphalt, pooled tire smoke, WebAudio synthesis (engine, tyre noise,
rain, siren, race and UI cues), a CSS motion system with reduced motion, and three quality presets. Effects and audio read
the vehicle state and never change it. No physics, road, race, police, garage, or career rule was changed. No commit was
made. The working tree is still uncommitted (commit scope is the user's decision).

## Definition of done (14 items)
| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Visual direction coherent across gameplay and menus | Partly | Shared motion tokens and one status line. The existing menu palette was kept, not redesigned. Judged from screenshots only. |
| 2 | Lighting and materials improved | Partly | Lighting is done (three time-of-day presets, fog, background). Materials: only the asphalt changed (wetness). Headlight and other materials are unchanged. |
| 3 | Vehicle animation and camera respond to real driving | Not met as new work | The existing camera (speed FOV, lag, shake) was kept. No vehicle animation was added. |
| 4 | Day, evening, night work | Met | Browser: N cycles through day, evening and night. Night is darker (luminance 0.110 vs 0.740 day). Car readability at night is poor (see Known bugs). |
| 5 | Rain works without destabilising the game | Met | Browser: 499 streaks, wet asphalt, no errors, the rain run is stable. Visual only, no grip change. |
| 6 | Audio responds to driving, races, pursuits, and menus | Partly | Driving, race cues, and siren verified by state read-outs. Menu click is queued but was not verified by ear or browser. Nothing was listened to. |
| 7 | UI transitions consistent and non-blocking | Met | Overlay fade and panel slide use the shared tokens. Reduced motion verified (`none`). The hub still pauses the game, as before. |
| 8 | Quality settings work | Met | Pixel ratio 1.5, 2, 1 at device scale 2. Streak and smoke budgets by preset. Persists under `street-racer.settings`. |
| 9 | Performance checked against a documented baseline where measurable | Partly | Draw calls and triangles measured. No pre-Part-10 baseline (the tree was never committed in between). FPS only under software GL (about 4 fps), so not representative. |
| 10 | Existing driving, race, police, garage, career still work | Met | Career 33/33, garage 24/24, race 35/35, pursuit 33/33 on the final code. |
| 11 | Cleanup and repeated transitions leak nothing | Met for the test | Five cycles of hub, garage, N, M: geometries, textures, programs, loops unchanged. Not a full memory profile. |
| 12 | Tests run and recorded | Met | Vitest 79 files, 876 tests. Browser presentation 55/55. |
| 13 | Production build run and recorded | Met | `npm run build` exit 0. Bundle 1,399.79 kB (gzip 394.06 kB). |
| 14 | `PROJECT_CONTEXT.md` updated | Met | Section 23. |

Items 2, 3, 6, 9 and 1 are not fully met. They are reported as partly met or not met, not as passes.

## Lighting, weather, and audio
- Lighting: `Environment` owns the one set of lights, fog, and background. Day, evening, and night transition with a delta-time step (6 s and 4 s, see `environmentConfig.ts`).
- Weather: rain (clear and rain only). A bounded, world-anchored line field. Asphalt roughness 0.9 dry, 0.4 wet. No grip change.
- Tire smoke: a pooled instanced field. Emitted only from real slip, handbrake, or wheelspin (decision in the Part 10 brief).
- Audio: WebAudio synthesis only, no audio files. Engine pitch and gain follow speed and throttle (measured: 48 Hz idle, 92 Hz at 57.9 km/h). Rain gain follows wetness. The siren follows the pursuit state. One-shot cues: countdown, GO, checkpoint, finish, UI click. Pause suspends the audio context; `audioManager` also listens for `visibilitychange`.

## UI and camera changes
- UI: N, M, U keys. A one-line status readout (`PresentationStatus`). Motion tokens in `styles.css`. Career overlay fade and panel slide. Focus rings on the career controls. Reduced motion sets the overlay animation to `none` (checked in the browser).
- Camera: no change in this phase. The existing camera was kept.
- Controls hint: N, M, and U added.

## Measurements and test results
- Vitest: 79 files and 876 tests pass (Part 9 baseline: 71 files and 787).
- `tsc --noEmit`: exit 0. `eslint .`: exit 0.
- Browser presentation harness (`tools/browser-presentation.py`): 55/55 on the final code. Report: `/home/user/verification/part10/presentation-report.json`.
- Regression harnesses on the final code: career 33/33, garage 24/24, race (C D E errors) 35/35, pursuit 33/33. Logs in `/home/user/verification/part10_regress/`.
- Draw calls and triangles, median over a 3 s sampling window (headless, software GL): medium with rain 50 calls and 129,196 triangles, 500 streaks; high with rain 50 and 130,492, 1,100 streaks; low with rain 62 and 128,264, 180 streaks; medium clear 49 and 129,196, 0 streaks. Low has more draw calls than medium. The cause was not investigated.
- Frame rate: 4.2 to 4.4 fps in every preset under software GL. Not a GPU measurement and not representative of real hardware.
- Bundle: 1,380.05 kB (Part 9) to 1,399.79 kB (gzip 387.36 to 394.06 kB).

## Files
Created: `src/config/environmentConfig.ts`, `src/config/qualityConfig.ts`, `src/config/audioConfig.ts`,
`src/environment/environmentModel.ts` (+ test), `src/quality/qualityModel.ts` (+ test),
`src/state/environmentStore.ts` (+ test), `src/state/qualityStore.ts` (+ test),
`src/audio/audioModel.ts` (+ test), `src/audio/audioManager.ts` (+ test), `src/audio/audioSession.ts`,
`src/render/Environment.tsx`, `src/render/rainField.ts`, `src/render/TireSmoke.tsx`, `src/render/tireSmokeField.ts`,
`src/render/tireSmokeModel.ts` (+ test), `src/render/surfaceRegistry.ts`, `src/render/effectFeed.ts`,
`src/render/PresentationProbe.tsx`, `src/render/surfaceAndEffects.test.ts`,
`src/diagnostics/presentationDebug.ts`, `src/ui/PresentationStatus.tsx`, `tools/browser-presentation.py`.

Modified: `src/App.tsx`, `src/render/RenderLayer.tsx`, `src/render/renderLoop.ts`, `src/render/RoadNetworkScene.tsx`,
`src/input/keyBindings.ts`, `src/ui/Hud.tsx`, `src/styles.css`, `src/diagnostics/devHooks.ts`,
`tools/browser-garage.py` (one stale expectation: schema 1 changed to 2, see below), `PROJECT_CONTEXT.md` (section 23),
`FINAL_REPORT.md` (this section).

## Bugs found and fixed in this part
- Lint errors from the React compiler in `Environment` and the particle components. Fixed by declarative fog and background,
  and by moving the rain and smoke buffers into plain classes (`RainField`, `TireSmokeField`).
- The smoke read-out reported zero live particles because the field never published its live count. Found by the browser
  check. Fixed.
- `browser-garage.py` asserted schema version 1. Since Part 9 the save has been version 2. The harness expectation was
  updated (harness-only change; the game was not changed).

## Known bugs and limitations
- Night readability: the car's body is almost the colour of the road at night.
- A large blue shape was visible in the foreground of one rain screenshot. Not identified (probably a traffic vehicle).
- Collision feedback, camera changes, and vehicle animation were not built in this phase.
- Audio is verified by state read-outs and unit tests only. Nobody has listened to it.
- Menu click audio: wired in code (`MENU_ACTIONS`), but not verified by ear or in the browser.
- Time of day and weather reset on reload (`environmentStore` has no storage). Quality and volume persist under `street-racer.settings`.
- Volume: the store holds a default of 0.7 and the audio follows it, but no key or UI control calls `setVolume`. The user cannot change it yet.
- Not run in this phase: `browser-race.py J` and `R`, `browser-road.py`, `browser-smoke.py`.

## Deferred features
- Shadow maps (deferred). Blob or contact shadow (not planned).
- Rain grip modifier (not planned: rain is visual only).
- Volume control UI.
- Collision feedback, camera, and vehicle animation work.
- Mobile controls: not applicable. No touch or mobile controls exist and none were invented.

## Production build
`npm run build` exit 0. `dist/assets/index-ConeoTxy.js` 1,399.79 kB (gzip 394.06 kB), CSS `index-DLfJjhq1.css`.

## PROJECT_CONTEXT.md
Updated: section 23 (Part 10) with scope, decisions, files, architecture, controls, quality table, measurements, tests,
bugs, limitations, and regression results (23.12).

## Process note
Part 10 was stopped at its end. Part 11 was not started. The dev server (`website-f84dca7b`) is still running for review.

# Part 11: Final integration, regression, and release readiness. Final report

Scope: audit, regression, save and lifecycle review, static hosting, measurement, fixes only for verified problems,
documentation, and the release decision. No features, vehicles, districts, rivals, or architecture changes were added.
Evidence is in `PROJECT_CONTEXT.md` section 24 and `verification/part11/`. Nothing is committed (HEAD `aade3ab`; the
commit scope is the developer's decision).

## A. Commands and results (final code)

| Command | Result |
|---|---|
| `npm ci` | pass, 205 packages, 0 vulnerabilities (earlier in Part 11; no dependency change since) |
| `npm run typecheck` | pass, exit 0 |
| `npm run lint` | pass, exit 0 |
| `npm test` | pass, 79 files, 880 tests |
| `npm run build` | pass. JS 1,400.58 kB (gzip 394.47 kB), CSS 16.23 kB. Vite chunk-size warning |
| `npm run check` | pass, exit 0 |
| `npm audit`, `npm audit --omit=dev` | 0 vulnerabilities each |
| `npm run dev` | dev server on 5173, used for the browser checks |
| `npm run preview` | serves on 4173. `browser-prod.py` 7/7 (boot, drive, reset, no page or console errors, no failed assets). Static subpath checks used a plain static server on 8091 and 8092 |

## B. Regression

Automated (browser, real keyboard input, headless Chromium, software WebGL):

| Area | Harness | Result |
|---|---|---|
| Driving, focus, listeners, held keys | `browser-smoke.py` (legacy) | 60/60 (before fix: 58/60) |
| Circuit lap | `browser-road.py` | 24/25. Lap lane 5.64 m (see F) |
| Traffic | `browser-traffic.py` | 20/20 |
| City and minimap | `browser-city.py` | 24/24 |
| Garage | `browser-garage.py` | 24/24 |
| Career | `browser-career.py` | 33/33 (loss branch; baseline 34/34 win branch) |
| Races C, D, E, errors | `browser-race.py` | 35/35 |
| Race R | `browser-race.py R` | 10/10 |
| Race J | `browser-race.py J` | 11/11 |
| Pursuit | `browser-pursuit.py` | 34/34 on two consecutive runs (after harness fix) |
| Presentation and audio state | `browser-presentation.py` | 55/55 |
| Boot, drive, focus, pause, corrupt save, newer save, full storage, blocked storage, resize (4 viewports), errors | `browser-release.py` | 54/55. Failure: garage memory (F) |
| No WebGL start-up message | `browser-release.py nowebgl` | 2/2 |
| Static hosting, root and subpath, plus `file://` | `probe_static.py` | root and subpath pass; `file://` fails (expected, documented) |
| Production preview (4173) | `browser-prod.py` | 7/7: boot, drive, reset, no page or console errors, no failed assets |

Manual or unverified:
- Audio was checked through the audio state and parameters, not by listening.
- Minimap labels were checked from one screenshot. Pixel-exact clipping was not tested.
- Real GPU, Firefox, Safari, Edge, high-DPI, real phones: not tested. No touch controls exist.
- GitHub Pages deployment and any live URL: not tested.
- Accessibility: no formal audit.

## C. Fixes (verified), with files

1. Vite `base` set to `'./'` for build (`vite.config.ts`). Before, built asset paths were root-absolute, so a subpath deploy would break.
2. Page title in `index.html`.
3. Audio listeners removed from `AudioManager`. The window and document keydown, keyup, blur, and visibilitychange counts were 2 each. Now 1 each (`src/audio/audioManager.ts`, `audioSession.ts`, `src/input/inputController.ts`, `src/App.tsx`, and their tests). Unlock now runs per frame from `renderLoop`. Visibility goes through `InputController`.
4. Audio dispose cleanup effect in `src/App.tsx`.
5. Race and pursuit cue ordering while paused (`src/render/renderLoop.ts` `tickAudio`).
6. Minimap label flip for labels that would be clipped (`src/ui/Minimap.tsx`).
7. Start-up failure message instead of a blank page (`src/ui/StartupBoundary.tsx`, `src/main.tsx`, `.startup-error` in `src/styles.css`).
8. Visible save notice outside the garage overlay (`src/ui/GarageLauncher.tsx`, CSS).
9. Save: a garage section that is missing or not an object is copied to the backup key before the default replaces it. Writes stay on only if the copy worked. Tests added (`src/save/saveFile.ts`, `saveFile.test.ts`). The next write used to erase the garage with no copy.
10. Deployment workflow (`.github/workflows/deploy-pages.yml`). New, not run.
11. Harnesses: `browser-road.py`, `browser-city.py`, `browser-pursuit.py` now exit non-zero on failure (the road harness reported 2 failures with exit 0). `browser-smoke.py` brake check corrected (standstill reverse was flagged; the physics is correct). `browser-pursuit.py` reset step reloads and re-stages (a stale cooldown or moved patrol made staging timing-dependent). `browser-release.py` is new; its focus check was corrected after a probe showed the pedal releases over about 0.2 s and the car coasts.
12. `.gitignore`: Python cache folders (`__pycache__/`, `*.pyc`) ignored. A cache folder had appeared in the untracked list.

No game physics, race rules, or garage rules were changed.

## D. Deployment

- The build uses relative asset paths. The same `dist/` works at a root (verified) and at `/street-racer/` (verified with a plain Python static server, not with `npm run preview`).
- No client-side routing, server code, secrets, or environment variables.
- `file://` does not work (Chromium blocks the module script). Documented in README.
- The DEV-only names remain in the bundle as inert strings (`toggleRoadDebug`, `trafficReset`, `devReset`, and key codes). The debug hooks and other DEV names are absent.
- GitHub Pages: the workflow is written and not run. The repo has no remote. README states this.

## E. Performance

- No FPS, frame time, or load time is claimed. Headless software rendering runs at about 4 fps and is not representative.
- Heap was measured with forced GC (`probe_heap.py`, `probe_dom.py`). The garage preview growth is in F. These numbers are from this headless run only.
- Unmeasured items, with manual procedures, are in `PROJECT_CONTEXT.md` section 24.5: FPS and frame time on a real GPU, memory after garage cycles on a real GPU, audio at each quality setting, load time on a real network.

## F. Known issues

Blocking: none found.

Not blocking for limited testing, recorded:
1. **Garage preview memory.** Each garage open mounts a new R3F canvas. Forced-GC heap grew about 3.5 MB after five garage and career cycles, and it keeps growing per cycle. A bisect that removed the preview canvas removed the growth. The retained reference is not identified. Left failing (`browser-release` cycles). Fix needs a design decision (one canvas for the session, or find the reference). Not fixed in Part 11.
2. **Circuit lap lane.** The keyboard test driver measured 3.05 m (Part 3), 3.77 m (baseline), and 5.64 m (final). The limit was not changed. This depends on frame rate and is a test-driver limit, not a measured product fault. Not verified as a product defect.
3. **Save backup overwrite.** A second unreadable save replaces the earlier backup copy.
4. **Schema-0 object.** An unversioned object is read as a garage with repairs and no backup. Read from code only.
5. **Volume.** Stored and applied, no on-screen control.
6. **THREE.Clock warning.** Upstream, from `@react-three/fiber` 9.8.2 and `three` 0.186.1. Not patched.
7. **Rain.** Visual only, no grip effect (documented in Part 10).
8. **Pursuit staging.** The reset step needed a fresh session to stage reliably. The root cause is the timing of the earlier steps. The game reset path was not changed.
9. **Browser coverage.** Chromium only. Safari and Firefox are untested.

Assumed, not verified: that the GitHub Pages workflow deploys as written; that audio sounds right; that real GPUs do not show the garage growth differently.

## G. Recommendation

**Ready for limited testing.**

Evidence:
- Build, typecheck, lint, 880 tests, and both audits pass on the final code.
- Browser regression: every harness passes except the two known items (road lap lane, garage memory). The release harness passes 54/55.
- Listener counts, pause, held-key release on focus loss, save recovery (corrupt, newer, full, blocked), and static-hosting paths behave as documented.
- The open issues are documented with measurements, and none blocks play.

Why not "Ready for release": the garage memory growth is unresolved, the GitHub Pages deployment is unrun, and there is no real-hardware performance or audio evidence.

## H. Developer next actions

1. Decide the commit scope and commit Parts 4 to 11 (the working tree has about 134 entries).
2. Fix the garage preview lifecycle: keep one preview canvas for the session, or find the retained reference (`src/ui/GaragePreview.tsx`). Then re-run `browser-release.py` cycles.
3. Run the GitHub Pages workflow on a real remote and check the live URL with a subpath.
4. Measure FPS, frame time, and memory on a real GPU using the procedure in `PROJECT_CONTEXT.md` section 24.5.
5. Listen to the audio cues and siren at each quality setting.
6. Run the smoke set in Firefox and Safari.
7. Decide whether a volume control is needed for release.
8. Keep multiple unreadable-save backups, if the save history matters.
9. Improve the circuit lap driver (frame-rate independent) or accept the current tolerance.
10. Update `README.md` after the decisions above.
