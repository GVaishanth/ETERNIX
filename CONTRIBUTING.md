# Contributing to ETERNIX

Thank you for looking at ETERNIX. This project is a development preview, so changes that fix problems or finish existing
systems are the most useful. Please read this page before you open an issue or a pull request.

## Before you start

- Read the [architecture overview](docs/architecture/OVERVIEW.md) and the [setup guide](docs/development/SETUP.md).
- For a bug, check the known limitations in the [README](README.md) first.
- For a larger change, open an issue to discuss it before you write the code.

## Development workflow

```bash
npm ci
npm run dev        # develop with the dev server on port 5173
npm run check      # must pass before you open a pull request
```

`npm run check` runs the type checker, the linter, the tests, and the production build.

## Coding rules

These rules are part of the project. A change that breaks one will be asked to change.

- **TypeScript in strict mode.** No `any`. Do not add `@ts-ignore`, `@ts-expect-error`, or lint-disable comments to make a
  check pass. Fix the cause.
- **No empty `catch` blocks.** Handle the error, or let it surface.
- **Tuning values live in `src/config/`.** Do not put a tuning number inside a system.
- **SI units.** Metres, seconds, kilograms, and metres per second. Convert for display only.
- **No circular imports.** Keep module dependencies one way (see the architecture overview).
- **The simulation does not depend on React.** Keep the fixed-step simulation in `src/engine/` and `src/simulation/` free
  of React and the renderer.
- **Dispose what you create.** Geometries, materials, textures, and render targets must be released when they are no
  longer used.
- **Procedural geometry only.** Do not add 3D models, textures, or audio files that come from outside the project. New
  visual assets must be original, or licensed in a way that allows redistribution under the project's license. Say where
  the asset came from in the pull request.
- **Do not change save data format silently.** The save keys (`street-racer.save`, `street-racer.save.backup`,
  `street-racer.settings`) must keep their names. A change to the save format needs a migration and a test.

## Tests

- New behaviour needs tests. Add a `*.test.ts` file next to the code.
- Do not delete or weaken an existing test to make a change pass. If a test is wrong, explain why in the pull request.
- If a change affects a browser flow, say which `tools/` script you ran and what it reported.

## Commits and pull requests

- Keep each pull request to one purpose. Separate refactors from behaviour changes.
- Describe what changed and why, and list the commands you ran with their results.
- Use the pull request template. It lists the checks that a reviewer expects.
- Do not commit generated files: `dist/`, `node_modules/`, screenshots from local runs (`browser-output/`), or local
  environment files.

## Licensing

By contributing, you agree that your contribution is released under the project's [MIT license](LICENSE).
