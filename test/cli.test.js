import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve('goose_rarity.js');

const baseDataset = {
  fetchedAt: '2024-01-01T00:00:00.000Z',
  shows: [
    {
      show_id: 1,
      showdate: '2023-01-01',
      venuename: 'Madison Square Garden',
      location: 'New York, NY'
    },
    {
      show_id: 2,
      showdate: '2022-12-31',
      venuename: 'Capitol Theatre',
      location: 'Port Chester, NY'
    },
    {
      show_id: 3,
      showdate: '2021-07-04',
      venuename: 'Red Rocks Amphitheatre',
      location: 'Morrison, CO'
    }
  ],
  setlists: [
    {
      show_id: 1,
      showdate: '2023-01-01',
      song_id: 101,
      songname: 'Arcadia',
      isoriginal: 1
    },
    {
      show_id: 1,
      showdate: '2023-01-01',
      song_id: 102,
      songname: 'Take On Me',
      isoriginal: 0,
      original_artist: 'A-ha'
    },
    {
      show_id: 2,
      showdate: '2022-12-31',
      song_id: 101,
      songname: 'Arcadia',
      isoriginal: 1
    },
    {
      show_id: 2,
      showdate: '2022-12-31',
      song_id: 103,
      songname: 'Empress',
      isoriginal: 1
    }
  ]
};

describe('goose-rarity CLI', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goose-rarity-cli-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  async function runCli(args = [], dataset = baseDataset) {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [CLI_PATH, ...args],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          ELGOOSE_DATASET_JSON: JSON.stringify(dataset),
          FORCE_COLOR: '0'
        },
        maxBuffer: 1024 * 500
      }
    );
    return { stdout, stderr };
  }

  it('writes rarity scores CSV using in-memory dataset', async () => {
    const { stdout, stderr } = await runCli();
    expect(stderr).toBe('');
    expect(stdout).toContain('Using dataset provided via ELGOOSE_DATASET_JSON.');
    expect(stdout).toContain('Rarity scores written to show_rarity_scores.csv');

    const csvPath = path.join(tempDir, 'show_rarity_scores.csv');
    const csv = await fs.readFile(csvPath, 'utf8');
    expect(csv).toMatch(/showId,date,venue,rarityScore/);
    expect(csv).toMatch(/1,2023-01-01,Madison Square Garden/);
    expect(csv).toMatch(/2,2022-12-31,Capitol Theatre/);
  });

  it('handles year filtering that produces no results', async () => {
    const { stdout } = await runCli(['--year', '2021', '--outfile', 'scores.csv']);
    expect(stdout).toContain('No shows found for year 2021');
    expect(stdout).toContain('Rarity scores written to scores.csv');

    const csvPath = path.join(tempDir, 'scores.csv');
    const csv = await fs.readFile(csvPath, 'utf8');
    expect(csv.trim()).toBe('');
  });
});
