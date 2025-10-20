import { describe, it, expect, afterEach } from 'vitest';
import {
  computeRarityScores,
  formatCsvData,
  matchesVenueFilter,
  getDatasetFromEnv,
  __resetEnvDatasetCache as resetEnvDatasetCache,
  decodeHtmlEntities
} from '../goose_rarity.js';

const baseDataset = {
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
      isoriginal: 1,
      settype: 'set',
      setnumber: 1,
      position: 1
    },
    {
      show_id: 1,
      showdate: '2023-01-01',
      song_id: 102,
      songname: 'Take On Me',
      isoriginal: 0,
      original_artist: 'A-ha',
      settype: 'set',
      setnumber: 1,
      position: 2
    },
    {
      show_id: 2,
      showdate: '2022-12-31',
      song_id: 101,
      songname: 'Arcadia',
      isoriginal: 1,
      settype: 'set',
      setnumber: 1,
      position: 1
    },
    {
      show_id: 2,
      showdate: '2022-12-31',
      song_id: 103,
      songname: 'Empress',
      isoriginal: 1,
      settype: 'set',
      setnumber: 1,
      position: 2
    }
  ]
};

afterEach(() => {
  delete process.env.ELGOOSE_DATASET_JSON;
  resetEnvDatasetCache();
});

describe('computeRarityScores', () => {
  it('computes scores and skipped shows with setlists present', () => {
    const { scores, skipped } = computeRarityScores(baseDataset);
    expect(scores).toHaveLength(2);
    expect(skipped).toEqual([
      expect.objectContaining({
        showId: 3,
        venue: 'Red Rocks Amphitheatre'
      })
    ]);

    const capTheatre = scores.find((show) => show.showId === 2);
    expect(capTheatre).toBeDefined();
    expect(capTheatre?.rarityScore).toBeGreaterThan(0);
  });

  it('handles datasets with no setlists gracefully', () => {
    const { scores, skipped } = computeRarityScores({
      shows: baseDataset.shows,
      setlists: []
    });
    expect(scores).toHaveLength(baseDataset.shows.length);
    expect(skipped).toEqual([]);
    expect(scores[0].rarityScore).toBeGreaterThan(0);
  });
});

describe('formatCsvData', () => {
  it('formats rarity scores with six decimal places', () => {
    const csv = formatCsvData([
      {
        showId: 42,
        date: '2023-02-02',
        venue: 'Some Venue',
        rarityScore: 0.123456789
      }
    ]);
    expect(csv).toContain('showId,date,venue,rarityScore');
    expect(csv).toContain('42,2023-02-02,Some Venue,0.123457');
  });
});

describe('matchesVenueFilter', () => {
  const sampleScore = {
    showId: 1,
    date: '2023-01-01',
    venue: 'Madison Square Garden',
    location: 'New York, NY',
    rarityScore: 0.5
  };

  it('returns true when no filter is provided', () => {
    expect(matchesVenueFilter(sampleScore, undefined)).toBe(true);
    expect(matchesVenueFilter(sampleScore, '')).toBe(true);
  });

  it('performs case-insensitive substring matches', () => {
    expect(matchesVenueFilter(sampleScore, 'garden')).toBe(true);
    expect(matchesVenueFilter(sampleScore, 'new york')).toBe(true);
    expect(matchesVenueFilter(sampleScore, 'denver')).toBe(false);
  });
});

describe('getDatasetFromEnv', () => {
  it('returns undefined when no dataset env var is set', () => {
    expect(getDatasetFromEnv()).toBeUndefined();
  });

  it('parses dataset JSON and caches the result', () => {
    process.env.ELGOOSE_DATASET_JSON = JSON.stringify(baseDataset);
    const first = getDatasetFromEnv();
    const second = getDatasetFromEnv();
    expect(first).toEqual(baseDataset);
    expect(second).toBe(first);
  });

  it('throws a descriptive error when JSON parsing fails', () => {
    process.env.ELGOOSE_DATASET_JSON = '{invalid';
    expect(() => getDatasetFromEnv()).toThrow(/Failed to parse dataset/);
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes HTML entities and smart quotes', () => {
    expect(decodeHtmlEntities('Goose &amp; Friends')).toBe('Goose & Friends');
    expect(decodeHtmlEntities('“Quoted” &apos;text&apos;')).toBe('“Quoted” ’text’');
    expect(decodeHtmlEntities('&quot;Fresh&quot; &amp; &#x27;Clean&#x27;')).toBe('”Fresh” & ’Clean’');
  });
});
