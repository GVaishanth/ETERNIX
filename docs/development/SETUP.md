# Development setup

## Requirements

- **Node.js 20 or newer.** The cleanup was checked with Node 20.20.2. The deployment workflow builds with Node 22.
- **npm**, which comes with Node. The repository uses `package-lock.json`, so install with `npm ci`, not `npm install`.
- **A browser with WebGL** to run the game. Hardware acceleration should be on.
- **Python 3.10 or newer and Playwright** only if you want to run the browser scripts in `tools/`.

## First run

```bash
npm ci
npm run dev
```

The dev server listens on port 5173 on all interfaces. Open `http://localhost:5173/` for the front page and
`http://localhost:5173/play.html` for the game directly.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 5173, with the diagnostics panel and development-only hooks. |
| `npm run build` | Type-checks, then builds the static site into `dist/`. |
| `npm run preview` | Serves `dist/` on port 4173. Use this to test the production build. |
| `npm run typecheck` | TypeScript check only (`tsc --noEmit`). |
| `npm run lint` | ESLint over the whole repository. |
| `npm test` | Unit and integration tests (Vitest). |
| `npm run check` | Type check, lint, tests, and the production build, in that order. Run this before you push. |

## Checking a change

1. `npm run check` must pass.
2. For a change that touches the game flow, the HUD, the garage, or the front page, run the production build with
   `npm run build` and `npm run preview`, then open the changed page in a browser.
3. For a change that affects a browser flow, run the matching script in `tools/` against the running server. Each script
   has a comment at the top with its purpose and the server it needs.

## Browser scripts (`tools/`)

The scripts are Python with Playwright. They are not part of `npm test`. Install them once:

```bash
pip install playwright
python -m playwright install chromium
```

Then run a script with the server running, for example `python tools/browser-smoke.py`. Some scripts take a URL argument.
Read the header of a script before you run it.

## Notes

- `vite.config.ts` lists two preview hosts in `allowedHosts`. They exist for the hosted preview used during development.
  They do not affect a normal local run.
- Saves live in the browser, not in the project. Clearing the site's data in the browser resets the game. See the README.
- Development-only tools (the `G`, `O`, `T`, and `Y` keys) are stripped from production builds. The diagnostics panel
  (Shift + `) is in every build.
