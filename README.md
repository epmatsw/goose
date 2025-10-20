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

`showsSinceFirstPerformance` considers only shows that happened after the song debuted (inclusive). A show’s rarity score is the sum of the rarity contributions for all songs performed in that show.
