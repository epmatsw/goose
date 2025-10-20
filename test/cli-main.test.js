import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  __runCli,
  __resetEnvDatasetCache,
  __writeCsv
} from '../goose_rarity.js';

const baseDataset = {
  fetchedAt: '2024-01-01T00:00:00.000Z',
  shows: [
    {
      show_id: 1,
      showdate: '2023-02-01',
      venuename: 'Goose House',
      location: 'Denver, CO'
    },
    {
      show_id: 2,
      showdate: '2023-03-15',
      venuename: 'Rare Hall',
      location: 'Boulder, CO'
    },
    {
      show_id: 3,
      showdate: '2023-04-20',
      venuename: 'Missing Setlist Arena',
      location: 'Fort Collins, CO'
    }
  ],
  setlists: [
    {
      show_id: 1,
      song_id: 101,
      songname: 'Arcadia',
      isoriginal: 1
    },
    {
      show_id: 2,
      song_id: 102,
      songname: 'Empress',
      isoriginal: 1
    },
    {
      show_id: 2,
      song_id: 103,
      songname: 'Take On Me',
      isoriginal: 0,
      original_artist: 'A-ha'
    }
  ]
};

describe('goose-rarity CLI runner', () => {
  let tempDir;
  let logSpy;
  let tableSpy;
  let errorSpy;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'goose-cli-main-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    __resetEnvDatasetCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('runs the CLI end-to-end using an in-memory dataset', async () => {
    const env = {
      ...process.env,
      ELGOOSE_DATASET_JSON: JSON.stringify(baseDataset),
      FORCE_COLOR: '0'
    };

    const exitCode = await __runCli({
      argv: ['node', 'goose_rarity.js', '--year', '2023', '--outfile', 'rarity.csv', '--limit', '5'],
      baseDir: tempDir,
      env
    });

    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Using dataset provided via ELGOOSE_DATASET_JSON.'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('show(s) omitted because no setlist data was available.'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Rarity scores written to rarity.csv'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Average rarity score across'));
    expect(tableSpy).toHaveBeenCalledTimes(1);

    const csvPath = path.join(tempDir, 'rarity.csv');
    const csv = await fs.readFile(csvPath, 'utf8');
    expect(csv).toContain('showId,date,venue,rarityScore');
    expect(csv).toMatch(/1,2023-02-01,Goose House/);
  });

  it('logs a warning and writes an empty CSV when filters remove all shows', async () => {
    const env = {
      ...process.env,
      ELGOOSE_DATASET_JSON: JSON.stringify(baseDataset),
      FORCE_COLOR: '0'
    };
    __resetEnvDatasetCache();

    const exitCode = await __runCli({
      argv: ['node', 'goose_rarity.js', '--year', '1999', '--outfile', 'empty.csv'],
      baseDir: tempDir,
      env
    });

    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No shows found for year 1999'));
    const csvPath = path.join(tempDir, 'empty.csv');
    const csv = await fs.readFile(csvPath, 'utf8');
    expect(csv.trim()).toBe('');
  });

  it('returns a non-zero exit code when required dataset fields are missing', async () => {
    const brokenEnv = {
      ...process.env,
      ELGOOSE_DATASET_JSON: JSON.stringify({ shows: [] }),
      FORCE_COLOR: '0'
    };
    __resetEnvDatasetCache();

    const exitCode = await __runCli({
      argv: ['node', 'goose_rarity.js'],
      baseDir: tempDir,
      env: brokenEnv
    });

    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to compute rarity scores'));
  });

  it('exposes utility exports for consistency checks', async () => {
    const pathToCsv = path.join(tempDir, 'test.csv');
    await __writeCsv(pathToCsv, 'a,b,c');
    const contents = await fs.readFile(pathToCsv, 'utf8');
    expect(contents).toBe('a,b,c\n');
  });
});
