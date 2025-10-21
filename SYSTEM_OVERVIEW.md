# System Overview

## Entrypoints
- **CLI**: `node goose_rarity.js` (or `npm start`) launches the Commander-based tool that downloads setlists, updates the local cache, and writes rarity CSVs.
- **CLI update mode**: `node goose_rarity.js --update` recomputes scores after syncing new shows; `--outfile`, `--year`, `--venue`, and `--limit` tune the output.
- **Web dev server**: `npm run web:dev` starts Vite on port 5173 with a middleware that serves `elgoose_setlists.json` from the repository root during development.
- **Static build**: `npm run web:build` emits a GitHub Pages-ready site to `docs/` and inlines JS/CSS into `docs/index.html`.
- **Tests**: `npm test` (Vitest) covers CLI logic; `npm run test:e2e` (Playwright) exercises the UI and captures browser coverage; `npm run coverage:e2e` converts the Playwright output to Istanbul reports.

## Runtime Topology
- **Monorepo layout**: A single Node workspace hosts both the CLI and SPA; they share dependency installation but the web app maintains its own `web/package.json`.
- **CLI runtime**: A monolithic Node.js process runs synchronously, persisting cache files alongside the executable. It depends only on the public API and local filesystem.
- **Web runtime**: A static React application served from GitHub Pages (or any static host). All data is driven by client-side fetches—either from IndexedDB cache, uploaded JSON, or incremental API calls.
- **Testing harness**: Playwright launches Chromium, runs against the Vite dev server (`tests/fixtures/coverage.ts` ensures coverage collection), and writes raw coverage chunks that a teardown script aggregates.

## Configuration & Environment
- **Environment variables**
  - `ELGOOSE_DATASET_JSON`: Optional JSON payload that seeds the CLI with a dataset when filesystem access is restricted (e.g., CI).
  - `CI`: Enables Playwright retries and disables dev server reuse during automated runs.
- **Filesystem locations**
  - `elgoose_setlists.json`: Root-level cache written by the CLI and referenced by the dev-server middleware.
  - `show_rarity_scores.csv`: Default rarity report written by the CLI.
  - `playwright-coverage/`: Coverage chunks (`chunks/*.json`), aggregate `coverage.json`, and converted Istanbul reports (`istanbul/`).
- **Browser storage**: The SPA persists `GooseDataset` objects under the `keyval-store` database/key `goose-dataset` via IndexedDB; “Clear Cache” wipes this storage.
- **Runtime guards**: `import.meta.env.DEV` toggles dev-only features (e.g., Load Local Dataset button) so the production bundle never references the raw dataset.

## Build & Deploy Pipeline
- **Root install**: `npm install` prepares CLI and shared tooling; `npm install --prefix web` handles web-only dependencies.
- **Static site build**
  - Vite builds to `docs/` with `base: './'` ensuring relative asset paths for GitHub Pages.
  - `inline-build-assets` plugin reads the generated HTML, inlines CSS/JS, and deletes the `docs/assets/` directory, resulting in a single self-contained `docs/index.html`.
  - Publishing `docs/` to the `gh-pages` branch (or configuring GitHub Pages to serve `/docs`) deploys the dashboard.
- **CLI distribution**: Because `package.json` exposes the `bin` entry, `npm install -g` (or `npx goose-rarity`) can run the CLI directly once published.
- **Coverage workflow**: Playwright writes CDP coverage data; `npm run coverage:e2e` transforms it into standard reports (`text-summary`, `json-summary`, `html`, `lcovonly`) under `playwright-coverage/istanbul`.

## External Integrations
- **El Goose API**: All show and setlist data comes from `https://elgoose.net/api/v2`. Endpoints `shows.json` and `setlists/show_id/{id}.json` are used extensively, and failures propagate as user-facing errors.
- **Browser APIs**: IndexedDB, `fetch`, and `Intl` formatting APIs power caching and localisation within the SPA.
- **Testing infrastructure**: Playwright (Chromium) is the only browser target currently configured; coverage relies on the Chrome DevTools Protocol (`Profiler.startPreciseCoverage`).

## Operations Notes
- Incremental sync treats cached data as immutable; deleting `elgoose_setlists.json` or browser storage forces a full re-fetch.
- Static builds never embed the dataset; ensure the API is reachable from the deployed environment or provide a JSON upload workflow for offline use.
- When running Playwright locally, ensure the Node binary has necessary permissions to bind to `127.0.0.1:4173` (the repo uses `/Users/will/.nvm/versions/node/v23.5.0/bin/node` in automation).
