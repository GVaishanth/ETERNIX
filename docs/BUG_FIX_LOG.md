# ETERNIX bug-fix and stabilisation log

This log records what was checked, what was fixed, how each fix was verified, and what remains. A status of **Fixed**
means the change exists and a stated test or browser check passed. **Not done** means the work was not started in this
pass. **Not verified** means it was not checked in this pass.

## Baseline (Phase 1)

- Branch `main`, HEAD `aade3ab` ("Part 3"). The working tree holds a large amount of uncommitted work from earlier
  sessions (Parts 4 to 11, Division 2, night lights, the hillside plan). Git reports 41 modified, 156 untracked, and 87
  staged deletions under `.claude/skills/`. This pass did not change the Git index or history.
- The last full `npm run check` before this pass passed: 139 test files, 1465 tests. The first run of this pass, after
  its edits, passed: 139 files, 1475 tests, with typecheck, lint, and build.
- Browser check: the production build was served at `/ETERNIX/` (a subpath, as on GitHub Pages). This check ran after
  the metadata edits, so it confirms the post-edit state, not the state before them. `index.html` and `play.html` both
  loaded with no console errors and no failed requests. The game page showed its HUD.
- Tooling: dependencies were already installed in `node_modules` (`npm ci` was not run in this pass). Vite 8, Vitest 4,
  Playwright (Python) with Chromium. Browser runs use
  software WebGL and are slow (about 1 fps). No physical device or gamepad was available.

## Verified problems and status

| # | Area | Problem (verified in source or runtime) | Status | Verification |
|---|------|------------------------------------------|--------|--------------|
| 1 | SEO | `index.html` was `noindex`, but `play.html` was `index, follow`. The two pages disagreed. | **Fixed** | Built HTML checked. Both pages `index, follow`. |
| 2 | SEO / social | No canonical, `og:url`, or `og:image`. The social preview image lived in `docs/`, so the site could not serve it. | **Fixed** | Canonical and absolute `og:image` set on both pages. Image copied to `public/social-preview.png` (1280×640). Checked in build output and in the served page. The live site is not checked until deployment. |
| 3 | CI | The Pages workflow ran `npm run build` only. Tests and lint did not gate the deploy. | **Fixed** | Build job now runs `npm run check`. Deploy still depends on it. YAML parses. Not run in GitHub Actions (no push, by design). |
| 4 | Environment | N and M set the environment by hand, but the next 5-minute change replaced it. The hand change was not saved, so it did not reach the other page. | **Fixed** | Per-part manual flags saved in the record. Manual parts hold their value at expiry. L toggles automatic cycling. HUD shows Auto or Manual. Legacy records (no flags) read as automatic. Unit tests (env clock, store, input) and a browser run: L, N, reload. |
| 5 | Police | A ram locked the player's input for 1.5 s, and repeated contact re-locked it with no limit. A stopped car in continuous contact could be held locked. | **Fixed** | 4 s cooldown after each lock (`PURSUIT_CONFIG.ram.cooldownSeconds`). Test: 30 s of continuous ram contact. Longest lock is at most 1.6 s, and gaps are at least the cooldown. Without the cooldown the test fails (longest lock 11.2 s). |
| 6 | Free roam | The default loop world has `opponents: []`. No rival drivers roam free roam. | **Not done** | Source confirmed (`src/world/worlds.ts`). Phase 3. |
| 7 | World size | The loop is 12 nodes × 200 m = 2.4 km per axis, not the requested ~12 km. | **Not done** | Conflicts with the user's earlier decision to keep the loop period for the hillside district. Needs a decision before changing dimensions (Phase 2). |
| 8 | Roads | Roads were flat by design. The validator required `elevation === 0`. | **Partly fixed** (earlier work) | Validator allows height and enforces an 8% grade limit (`src/config/terrainConfig.ts`). Vehicle height and physics are not done (hillside plan, phase 2). |
| 9 | Input | Keyboard only. No touch and no gamepad. | **Not done** | Phase 5. |
| 10 | Career | Divisions 3–5 are not built. Division 1 and 2 exist. | **Not done** | Phase 4. |
| 11 | Saves | Schema migration, corrupt-save backups, and newer-version guards exist, with tests (`src/save/saveFile.test.ts`). Export and import do not exist. | **Partly verified** | Existing tests only. Export and import: not done (Phase 11). |
| 12 | Landing page | Loader imports game modules for readiness checks. Bundle sizes not measured per route. | **Not verified** | Phase 12. |
| 13 | Garage, AI handling, race balance, navigation, diagnostics | Not audited in this pass. | **Not verified** | Phases 6, 7, 10, 13, 16. |
| 14 | Favicon | Existing favicon not reviewed visually. | **Not verified** | Phase 14 follow-up. |

## Changes in this pass

- `index.html`, `play.html`: robots set to `index, follow`. Canonical URL and social metadata added (`og:url`,
  `og:image`, `og:image:width/height/alt`, `twitter:card`).
- `public/social-preview.png`: new. Copy of `docs/assets/social-preview.png`.
- `.github/workflows/deploy-pages.yml`: build job runs `npm run check`.
- `src/state/environmentClock.ts`, `src/state/environmentStore.ts`: per-part manual flags, `toggleAutomatic`,
  `describeCycle`. Records without flags are automatic.
- `src/input/keyBindings.ts`, `src/render/renderLoop.ts`, `src/input/controlHelp.ts`: `L` key (automatic cycle).
- `src/ui/PresentationStatus.tsx`: HUD shows Auto or Manual.
- `src/pursuit/pursuitController.ts`, `src/config/pursuitConfig.ts`: ram cooldown.
- `src/config/terrainConfig.ts`, `src/world/roadValidation.ts`, `src/world/roadTypes.ts`: grade limit (earlier hillside
  work, listed here because it is part of the uncommitted tree).
- Tests: `src/state/environmentClock.test.ts`, `src/state/environmentStore.test.ts`,
  `src/pursuit/pursuitController.test.ts`, `src/world/roadValidation.test.ts`.
- Docs: `README.md` (controls and deployment), `docs/deployment/GITHUB_PAGES.md`, `docs/architecture/DIVISION_2_MAP_PLAN.md`.

## Remaining work (by phase)

- **Phase 2, world size (needs a decision).** The brief asks for ~12 km × 12 km. The loop is 2.4 km and the hillside plan
  keeps that period. The two conflict, and changing the period touches traffic, pursuit, races, and the minimap.
- **Phase 3, free-roam rivals.** Not built. Requires roaming AI on the loop network.
- **Phase 4, career divisions 3 to 5.** Not built.
- **Phase 5, touch and gamepad.** Not built. No mobile or gamepad device was tested.
- **Phase 6, AI handling profiles, Phase 7 race balance.** Not measured.
- **Phase 8, remaining police work.** The ram soft-lock is fixed. Pursuit escape routes, speed multipliers, and
  reset/visibility handling were not re-audited.
- **Phase 9, remaining.** Browser check of fog and road materials under manual settings was not run.
- **Phase 10, garage.** Not audited (32 catalogue cars now: 20 original, 12 ground; showroom framing, selling decision).
- **Phase 11, save export and import.** Not built. Browser storage is not cloud sync and can be cleared by the browser
  or the user.
- **Phase 12, landing and loading.** Not measured.
- **Phase 13, full-screen map and destination selection.** Not built.
- **Phase 14, favicon redesign.** Not done. Current icons are present and load.
- **Phase 16, performance and diagnostics.** Not measured on real hardware. The diagnostics panel is still gated by
  `Shift` + `` ` `` in every build.
- **Phase 17, documentation.** Partly done (controls, deployment, metadata). `PROJECT_CONTEXT.md` still describes the
  older environment behaviour in its history sections. Kept as history.
- **Git hygiene.** The working tree is not committed. Staged deletions under `.claude/skills/` need a decision.


## Garage: ENTER GAME from the garage went to the front page

- **Symptom.** Pressing ENTER GAME inside the garage showed the front page and stopped there. The game did not start until ENTER GAME was pressed a second time.
- **Cause.** `startEntry` in `src/prototype/eternix/EternixPrototype.tsx` switched the view to the front page for the garage and returned. The entry only ran from the front page.
- **Fix.** The press now records a request and switches to the front page. An effect starts the entry once the front page is shown (after two animation frames, so the hero has written its camera pose).
- **Check.** Browser: GARAGE, then ENTER GAME, reaches the running game with the HUD and no page or console errors.

- **Follow-up (user decision): the garage closing animation stays.** The user confirmed the animation before the game is intended. No change was made for it. The fix above (ENTER GAME goes to the game, not the front page) is unchanged.
