# Development Guide

## Prerequisites
- **Node.js ≥ 18** (the project is routinely exercised with `/Users/will/.nvm/versions/node/v23.5.0/bin/node` to ensure Playwright compatibility).
- **npm 9+** (ships with recent Node releases).
- Optional: **nvm** or a similar version manager to swap Node versions easily.
- A modern browser (Chromium-based recommended) for local UI testing.

## Initial Setup
1. Clone the repository and change into its root.
2. Install root dependencies (CLI, tests, tooling):
   ```bash
   npm install
   ```
3. Install web-specific dependencies:
   ```bash
   npm install --prefix web
   ```
4. (Optional) Place a cached dataset at `elgoose_setlists.json` in the repo root to avoid an initial API download.

## Common Scripts
| Command | Description |
| --- | --- |
| `npm start` | Runs the CLI (same as `node goose_rarity.js`). |
| `node goose_rarity.js --update` | Refreshes the cached dataset and recomputes rarity scores. |
| `npm test` | Executes Vitest unit/integration tests located under `test/`. |
| `npm run test:types` | Runs the TypeScript compiler in no-emit mode for strict type safety. |
| `npm run test:e2e` | Launches the Playwright suite in Chromium against the Vite dev server. |
| `npm run coverage:e2e` | Converts Playwright CDP coverage data into Istanbul reports. |
| `npm run lint` | Checks source formatting with Biome (formatter-only). |
| `npm run fix` | Applies Biome formatting updates. |
| `npm run web:dev` | Starts the React dev server with access to the local dataset file. |
| `npm run web:build` | Produces a static build in `docs/` with inline JS/CSS for GitHub Pages. |
| `npm run web:preview` | Serves the contents of `docs/` locally to sanity-check the build. |

## Project Structure
- `goose_rarity.js` – CLI entrypoint and core rarity logic.
- `test/` – Vitest suites covering CLI behaviours.
- `tests/e2e/` – Playwright specs validating UI flows and sorting behaviour.
- `tests/fixtures/` & `tests/utils/` – Playwright fixtures that capture coverage data and lifecycle hooks.
- `scripts/convert-playwright-coverage.mjs` – Tooling that transforms Playwright coverage to Istanbul format.
- `web/` – React application, including:
  - `src/App.tsx` – Primary UI composition and routing.
  - `src/lib/api.ts` – Incremental dataset sync.
  - `src/lib/cache.ts` – IndexedDB helpers.
  - `src/lib/rarity.ts` – Client-side rarity calculations and aggregations.
  - `src/components/ui/` – Tailwind + Radix UI primitives.
  - `vite.config.ts` – Dev middleware and inline-assets build plugin.
- `docs/` – Output directory for the static site (`npm run web:build` overwrites this).

## Running the Web App
- **Development**: `npm run web:dev` (or `npm run web:dev -- --host 127.0.0.1`) serves the SPA at `http://localhost:5173`. When `import.meta.env.DEV` is true, the header shows:
  - `Load Local Dataset`, which fetches `elgoose_setlists.json` from the repo root via the Vite middleware.
  - Upload and API fetch buttons, plus a disabled “Clear Cache” state until a dataset is stored.
- **Production preview**: After `npm run web:build`, run `npm run web:preview` or serve `docs/` with any static host to verify the GitHub Pages bundle.

## Working with the CLI
- Default run (`npm start`) reads `elgoose_setlists.json` if present; otherwise it downloads the dataset and saves it to disk.
- Use `--update` to sync only new shows; the tool performs up to five parallel setlist fetches and reports how many shows/entries were added.
- Set `ELGOOSE_DATASET_JSON` to inject a dataset directly (useful in CI environments where writing to disk is restricted).

## Testing & Coverage
- **Vitest**: Focused on algorithm correctness (rarity scoring, CSV generation, filtering). Coverage output lands in `coverage/vitest`.
- **Playwright**: Exercises end-to-end UI interactions, including dataset loading, filtering, sorting toggles, duration ordering, and caching controls. Chromium-only project is defined in `playwright.config.ts`.
- **Coverage conversion**: After running Playwright tests, execute `npm run coverage:e2e` to populate `playwright-coverage/istanbul` with `text-summary`, `json-summary`, `html`, and `lcov` reports.
- Ensure the custom Node binary has permissions to bind to `127.0.0.1:4173`; if Playwright fails to launch the dev server, prepend the PATH with `/Users/will/.nvm/versions/node/v23.5.0/bin`.

## Common Workflows
- **Refreshing data for the UI**
  1. Run the CLI with `--update` to refresh `elgoose_setlists.json`.
  2. Start the dev server and click “Load Local Dataset” to pull in the updated cache.
  3. Optionally fetch new shows directly from the browser via “Fetch Latest from API” (uses incremental sync and shows progress messages such as “Fetching latest shows…”).
- **Building for GitHub Pages**
  1. `npm run web:build`
  2. Commit the updated `docs/index.html`.
  3. Push to a branch configured for GitHub Pages or deploy the `docs/` directory.
- **Investigating coverage gaps**
  1. `npm run test:e2e`
  2. `npm run coverage:e2e`
  3. Open `playwright-coverage/istanbul/index.html` for a drilldown; combine with Vitest summaries to prioritise new UI scenarios.

## Gotchas & Tips
- The production bundle does not contain `elgoose_setlists.json`; rely on the API or manual uploads in hosted environments.
- API schema drift or outages surface as toast-level error messages (`Fetch Latest from API` transitions the status to `error`).
- Duplicate show IDs are deduplicated using `createSetlistEntryKey`; avoid hand-editing cached JSON unless you regenerate the keys consistently.
- Clearing the dataset removes IndexedDB storage and disables the “Clear Cache” button until data is reloaded.
- Tests expect deterministic fixtures produced from the cached dataset; if you swap datasets, update Playwright assertions accordingly.

## Contributing Safely
- Follow the incremental sync pattern (`syncDatasetFromApi`/`syncDatasetWithApi`) when introducing new data workflows to maintain immutability guarantees.
- Keep `docs/` in sync with UI changes by rebuilding before opening pull requests intended for deployment.
- Run both `npm test` and `npm run test:e2e` before submitting changes; include coverage conversion when touching UI logic.
- Respect the project’s ESM configuration (`"type": "module"`) when adding new scripts or tooling.
