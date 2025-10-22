# Goose Rarity CLI

This command-line tool downloads Goose (and related projects) setlists from the official [elgoose.net](https://elgoose.net) API, caches the dataset locally, and computes a rarity score for every show based on global song play counts.

## Requirements

- Node.js v18 or later (for built-in `fetch` and ES module support)
- npm (to install dependencies)

## Installation

```bash
npm install
```

## Usage

Fetch the latest dataset, compute rarity scores, write them to `show_rarity_scores.csv`, and display the 10 rarest shows:

```bash
node goose_rarity.js --update
```

Re-run the rarity calculation using the cached dataset (skip API calls):

```bash
node goose_rarity.js
```

Write the CSV to a custom path:

```bash
node goose_rarity.js --outfile ./reports/rarity.csv
```

Filter results:

```bash
# Shows from 2024 only, venues containing “Capitol”, show the top 20 entries
node goose_rarity.js --year 2024 --venue capitol --limit 20
```

The tool always prints the rarest shows (default top 10) to the console and writes the full set of scores to the CSV file you choose. The downloaded dataset cache lives at `elgoose_setlists.json` in the current working directory.

## How Rarity is Calculated

For every song in the setlist archive we count how many times it appears globally. Each song instance in a show contributes a rarity value:

```
playsPct = 100 * (showsFeaturingSong / showsSinceFirstPerformance)
rarity = min(1 / playsPct, 1 / 3) * (1 - 0.5 * isCover)
```

`showsSinceFirstPerformance` considers only shows that happened after the song debuted (inclusive). Songs that first appeared in 2020 or later receive a small bonus (≈0.1 for originals, ≈0.05 for covers) before rarities are rescaled, and final show scores average song rarities with a mild length multiplier so longer setlists don’t dominate. A show’s rarity score is the sum of these adjusted song contributions.

## Interactive Web Dashboard

A Vite + React dashboard lives in `web/` and exposes the same filters as the CLI:

```bash
npm run web:dev
```

Then open [http://localhost:5173](http://localhost:5173) in a browser. The UI supports:

- Uploading an existing `elgoose_setlists.json` file (or fetching fresh data from the API).
- Caching the dataset in IndexedDB so subsequent visits reuse the local copy.
- Filtering by year, venue substring, and the number of top shows to display.
- Viewing omitted shows (those without setlist data), average rarity, and a sortable leaderboard styled with shadcn-inspired components.

Use `npm run build` (or `npm run web:build`) to produce a production-ready build, and `npm run web:preview` to sanity-check the static output.

## Development Commands

- `npm run test:types` runs the strict TypeScript check (`tsgo --noEmit`).
- `npm run lint` executes Biome in check mode (formatter-only) so CI can verify formatting across the monorepo.
- `npm run fix` applies Biome formatting updates in-place.
- `npm run build` runs the Vite production build from the repository root.
