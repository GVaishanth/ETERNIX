# Deploying to GitHub Pages

The game is a static site. It has no server code, no environment variables, and no secrets. GitHub Pages can host it.

## What is in the repository

- `.github/workflows/deploy-pages.yml` builds the site and publishes it with GitHub Actions. It runs on a push to `main`
  and when started by hand (`workflow_dispatch`).
- The workflow's permissions are the minimum it needs: `contents: read`, `pages: write`, and `id-token: write`.
- `vite.config.ts` sets `base: './'` for builds. Every asset and link is relative, so the same `dist/` works at a domain
  root and at a project subpath such as `https://<user>.github.io/<repository>/`.
- `public/.nojekyll` tells GitHub Pages to serve the files as they are, without Jekyll processing.

## One-time setup (manual)

These steps happen in the GitHub web interface. The repository cannot do them for you.

1. Open the repository's **Settings > Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow by hand from the **Actions** tab). The first run creates the Pages site.
4. Open the URL that the deploy job reports. For a project repository, it has the form
   `https://<user>.github.io/<repository>/`.

Nothing is deployed by the cleanup itself. Deployment happens only when the changes are pushed.

## What the workflow does

1. Checks out the repository.
2. Sets up Node 22 with the npm cache.
3. Runs `npm ci` and `npm run check` (typecheck, lint, tests, and the production build). A failing check stops the deploy.
4. Uploads `dist/` as the Pages artifact.
5. Deploys the artifact.

The deploy job runs only after the build job passes, so a failing test or lint error blocks publishing.

## Routes and direct links

The site has two static pages: `index.html` (the front page) and `play.html` (the game). There is no client-side router, so
direct links and page refreshes work without any rewrite rules. The front page's `ENTER GAME` button links to `./play.html`.

## Manual steps for a public launch

These are decisions for the repository owner.

- **Social preview:** under **Settings > General > Social preview**, upload `docs/assets/social-preview.png` (1280 by 640).
- **Canonical URL and Open Graph image:** set in `index.html` and `play.html` for the production URL
  `https://gvaishanth.github.io/ETERNIX/`. The image is `public/social-preview.png`, served from the same site.
- **Search indexing:** both `index.html` (the front page) and `play.html` (the game) are `index, follow`. Their canonical
  URLs are set. Change both together if that changes.
- **Repository description and topics:** see the README for suggested values.

## Checking a deployment

After the Pages site is live:

- The icons and manifest load: `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, and `site.webmanifest`.
- `ENTER GAME` opens `play.html`, and the game's HUD appears.
- Refreshing `play.html` on the live URL loads the game again.

The cleanup checked these against a local copy of `dist/` served from a repository-style subpath. The live site has not
been checked, because it is not published yet.
