import { test, expect } from '../fixtures/coverage';

const FAST_TIMEOUT = 4_500;

async function loadDataset(page) {
  await page.goto('/');
  const loadButton = page.getByRole('button', { name: /Load Local Dataset/i });
  await expect(loadButton).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/data/elgoose_setlists.json') && response.ok(), {
      timeout: FAST_TIMEOUT
    }),
    loadButton.click()
  ]);
  const firstRow = page.locator('#top-shows-table tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: FAST_TIMEOUT });
}

async function openCoverArtists(page) {
  await page.getByRole('link', { name: /Browse & search cover artists/i }).click();
  await expect(page).toHaveURL(/\/#\/covers$/);
  await expect(page.getByRole('heading', { name: 'Cover Artists' })).toBeVisible();
  const rows = page.locator('#cover-artists-table tbody tr');
  await expect(rows.first()).toBeVisible();
  return rows;
}

async function waitForTopShowsStable(page) {
  const rows = page.locator('#top-shows-table tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: FAST_TIMEOUT });
}

test('dashboard displays top shows after loading dataset', async ({ page }) => {
  await loadDataset(page);
  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toBeVisible();
});

test('covers index lists available cover artists', async ({ page }) => {
  await loadDataset(page);
  const rows = await openCoverArtists(page);
  const firstRow = rows.first();
  await expect(firstRow).toBeVisible();
});

test('show detail route renders setlist for selected show', async ({ page }) => {
  await loadDataset(page);
  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();
  await expect(page).toHaveURL(/\/#\/shows\/\d+$/);
  await expect(page.getByRole('heading', { name: /Setlist/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/(#\/)?$/);
});

test('song detail route shows statistics for selected song', async ({ page }) => {
  await loadDataset(page);
  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();
  await expect(page).toHaveURL(/\/#\/shows\/\d+$/);
  await page.getByRole('button', { name: 'View song stats' }).first().click();
  await expect(page).toHaveURL(/\/#\/songs\//);
  await expect(page.getByText('Shows Played')).toBeVisible();
});

test('dashboard filters refine top shows data', async ({ page }) => {
  await loadDataset(page);

  await waitForTopShowsStable(page);
  const rows = page.locator('#top-shows-table tbody tr');
  const initialCount = await rows.count();
  expect(initialCount).toBeGreaterThan(0);

  await page.getByLabel('Year').selectOption('2023');
  await waitForTopShowsStable(page);
  const yearFilteredCount = await rows.count();
  expect(yearFilteredCount).toBeLessThanOrEqual(initialCount);
  await expect(rows.first().locator('td').nth(1)).toContainText('2023');

  await page.getByLabel('Venue filter').fill('mission');
  await waitForTopShowsStable(page);
  await expect(rows.first()).toContainText(/Mission Ballroom/i);

  await page.getByLabel('Top N results').fill('20');
  await waitForTopShowsStable(page);
  const limitedCount = await rows.count();
  expect(limitedCount).toBeLessThanOrEqual(20);
  await expect(page.getByText(/Average rarity:/)).toBeVisible();
});

test('clear cache resets dashboard state', async ({ page }) => {
  await loadDataset(page);
  await waitForTopShowsStable(page);
  const datasetSummary = page.getByText(/shows \/ .* setlist entries/i).first();
  await expect(datasetSummary).toBeVisible();

  await page.getByRole('button', { name: 'Clear Cache' }).click();
  await expect(page.locator('text=No dataset loaded')).toBeVisible();
  await expect(page.locator('text=No shows match the selected filters.')).toBeVisible();
  await expect(page.locator('#top-shows-table')).toHaveCount(0);
});

test('cover artists table supports sorting toggles', async ({ page }) => {
  await loadDataset(page);
  const rows = await openCoverArtists(page);
  async function extractTotals() {
    const count = await rows.count();
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const raw = await rows.nth(i).locator('td').nth(5).innerText();
      values.push(Number.parseInt(raw, 10));
    }
    return values;
  }

  async function extractNames() {
    const count = await rows.count();
    const values: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const raw = await rows.nth(i).locator('td').first().innerText();
      values.push(raw.trim());
    }
    return values;
  }

  const totalsInitial = await extractTotals();
  for (let i = 0; i < totalsInitial.length - 1; i += 1) {
    expect(totalsInitial[i]).toBeGreaterThanOrEqual(totalsInitial[i + 1]);
  }

  const totalCoversHeader = page.getByRole('button', { name: 'Total Covers' });
  await totalCoversHeader.click();
  const totalsAscending = await extractTotals();
  for (let i = 0; i < totalsAscending.length - 1; i += 1) {
    expect(totalsAscending[i]).toBeLessThanOrEqual(totalsAscending[i + 1]);
  }

  const artistHeader = page.getByRole('button', { name: 'Artist' });
  await artistHeader.click();
  const namesAscending = await extractNames();
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', ignorePunctuation: true });
  const sortedNames = [...namesAscending].sort((a, b) => collator.compare(a, b));
  expect(namesAscending).toEqual(sortedNames);
});

test('cover artist detail metrics and song sorting', async ({ page }) => {
  await loadDataset(page);
  const rows = await openCoverArtists(page);

  const search = page.getByPlaceholder('Search artists (e.g. Perpetual Groove)');
  await search.fill('Grateful Dead');
  await expect(rows.filter({ hasText: /Grateful Dead/i }).first()).toBeVisible();

  await rows.filter({ hasText: /Grateful Dead/i }).first().click();
  await expect(page.getByRole('heading', { name: /Covers$/ })).toBeVisible();
  await expect(page.getByText(/Total Covers/)).toContainText('Total Covers');
  await expect(page.getByText(/Unique Songs/)).toContainText('Unique Songs');

  const songRows = page.locator('table tbody tr');
  await expect(songRows.first()).toBeVisible();
  const initialSongFirst = await songRows.first().locator('td').first().innerText();
  const songButton = page.getByRole('button', { name: 'Song' });
  await songButton.click();
  const songNameCollator = new Intl.Collator(undefined, { sensitivity: 'base', ignorePunctuation: true });
  await expect
    .poll(async () => {
      const names = await songRows.evaluateAll((elements) => {
        return elements.map((element) => {
          const cell = element.querySelector('td');
          return (cell?.textContent ?? '').trim();
        });
      });
      if (names.length < 2) return names.length > 0;
      for (let i = 0; i < names.length - 1; i += 1) {
        if (songNameCollator.compare(names[i], names[i + 1]) > 0) {
          return false;
        }
      }
      return true;
    })
    .toBeTruthy();
  const songRowCount = await songRows.count();
  if (songRowCount > 1) {
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', ignorePunctuation: true });
    for (let i = 0; i < songRowCount - 1; i += 1) {
      const current = (await songRows.nth(i).locator('td').first().innerText()).trim();
      const next = (await songRows.nth(i + 1).locator('td').first().innerText()).trim();
      expect(collator.compare(current, next)).toBeLessThanOrEqual(0);
    }
  } else {
    expect((await songRows.first().locator('td').first().innerText()).trim()).toEqual(initialSongFirst.trim());
  }

  await page.getByRole('button', { name: 'Covers Logged' }).click();
  await expect
    .poll(async () => {
      const values = await songRows.evaluateAll((elements) => {
        return elements.map((element) => {
          const cell = element.querySelectorAll('td')[1];
          if (!cell) return Number.NaN;
          const parsed = Number.parseInt(cell.textContent ?? '', 10);
          return Number.isNaN(parsed) ? Number.NaN : parsed;
        });
      });
      if (values.length < 2) return values.length > 0 && Number.isFinite(values[0]);
      if (values.some((value) => Number.isNaN(value))) return false;
      for (let i = 0; i < values.length - 1; i += 1) {
        if (values[i] < values[i + 1]) {
          return false;
        }
      }
      return true;
    })
    .toBeTruthy();
  if (songRowCount > 1) {
    for (let i = 0; i < songRowCount - 1; i += 1) {
      const current = Number.parseInt(await songRows.nth(i).locator('td').nth(1).innerText(), 10);
      const next = Number.parseInt(await songRows.nth(i + 1).locator('td').nth(1).innerText(), 10);
      expect(current).toBeGreaterThanOrEqual(next);
    }
  }

  await page.getByRole('button', { name: 'All Cover Artists' }).click();
  await expect(page).toHaveURL(/\/#\/covers$/);
});

test('song index supports filtering and sorting', async ({ page }) => {
  await loadDataset(page);

  await page.getByRole('link', { name: /Browse & search songs/i }).click();
  await expect(page).toHaveURL(/\/#\/songs$/);

  const rows = page.locator('#songs-table tbody tr');
  await expect(rows.first()).toBeVisible();
  const initialRowCount = await rows.count();

  async function extractAverageRarity(count: number) {
    const values: number[] = [];
    const rowCount = await rows.count();
    const sample = Math.min(rowCount, count);
    for (let i = 0; i < sample; i += 1) {
      const text = (await rows.nth(i).locator('td').nth(1).innerText()).trim();
      const parsed = Number.parseFloat(text.replace(/,/g, ''));
      if (!Number.isNaN(parsed)) {
        values.push(parsed);
      }
    }
    return values;
  }

  const initialRarity = await extractAverageRarity(5);
  expect(initialRarity.length).toBeGreaterThan(1);
  for (let i = 0; i < initialRarity.length - 1; i += 1) {
    expect(initialRarity[i]).toBeGreaterThanOrEqual(initialRarity[i + 1]);
  }

  const searchInput = page.getByLabel('Search songs');
  await searchInput.fill('Arcadia');
  await expect(rows.filter({ hasText: /Arcadia/i }).first()).toBeVisible();
  const filteredCount = await rows.count();
  expect(filteredCount).toBeGreaterThan(0);
  const matchingCount = await rows.filter({ hasText: /Arcadia/i }).count();
  expect(matchingCount).toEqual(filteredCount);

  await searchInput.fill('');
  await expect(rows.first()).toBeVisible();

  const headerRow = page.locator('#songs-table thead');
  const songHeader = headerRow.getByRole('button', { name: 'Song' });
  const headerCells = page.locator('#songs-table thead th');

  await songHeader.click();
  const songHeaderCell = headerCells.nth(0);
  await expect(songHeaderCell).toHaveAttribute('aria-sort', 'ascending');

  const names: string[] = [];
  const nameCount = await rows.count();
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', ignorePunctuation: true });
  for (let i = 0; i < Math.min(nameCount, 10); i += 1) {
    const name = (await rows.nth(i).locator('td').first().locator('div').first().innerText()).trim();
    names.push(name);
  }
  const sortedNames = [...names].sort((a, b) => collator.compare(a, b));
  expect(names).toEqual(sortedNames);

  const uniqueHeader = headerRow.getByRole('button', { name: 'Shows' });
  await uniqueHeader.click();
  const uniqueHeaderCell = headerCells.nth(2);
  await expect(uniqueHeaderCell).toHaveAttribute('aria-sort', 'descending');
  const uniqueValues: number[] = [];
  const uniqueCount = await rows.count();
  for (let i = 0; i < Math.min(uniqueCount, 8); i += 1) {
    const text = (await rows.nth(i).locator('td').nth(2).innerText()).replace(/,/g, '').trim();
    const parsed = Number.parseInt(text, 10);
    expect(Number.isNaN(parsed)).toBe(false);
    uniqueValues.push(parsed);
  }
  for (let i = 0; i < uniqueValues.length - 1; i += 1) {
    expect(uniqueValues[i]).toBeGreaterThanOrEqual(uniqueValues[i + 1]);
  }

  const coversSwitch = page.getByRole('switch', { name: /Only covers/i });
  await coversSwitch.click();
  await expect(coversSwitch).toBeChecked();
  await expect.poll(async () => rows.count()).toBeLessThan(initialRowCount);
  await expect
    .poll(async () => {
      const texts = await rows.evaluateAll((elements) =>
        elements.map((element) => element.textContent ?? '')
      );
      return texts.length > 0 && texts.every((text) => text.includes('Cover •'));
    })
    .toBeTruthy();

  await coversSwitch.click();
  await expect(coversSwitch).not.toBeChecked();
  await expect.poll(async () => rows.count()).toBe(initialRowCount);
  await expect
    .poll(async () => {
      const texts = await rows.evaluateAll((elements) =>
        elements.map((element) => element.textContent ?? '')
      );
      return texts.some((text) => !text.includes('Cover •'));
    })
    .toBeTruthy();

  const firstSongName = (await rows.first().locator('td').first().locator('div').first().innerText()).trim();
  await rows.first().click();
  await expect(page).toHaveURL(/\/#\/songs\//);
  await expect(page.getByRole('heading', { name: firstSongName })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appearances' })).toBeVisible();
});

test('song duration sorting orders appearances by length', async ({ page }) => {
  await loadDataset(page);
  await page.goto('/#/songs/id%3A645');

  const loadButton = page.getByRole('button', { name: /Load Local Dataset/i });
  if (await loadButton.isVisible()) {
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes('/data/elgoose_setlists.json') && response.ok(),
        { timeout: FAST_TIMEOUT }
      ),
      loadButton.click()
    ]);
  }

  await expect(page.getByRole('heading', { name: 'Appearances' })).toBeVisible({ timeout: FAST_TIMEOUT });
  const occurrencesTable = page.locator('table').first();
  const occurrencesTbody = occurrencesTable.locator('tbody');
  await expect(occurrencesTbody.locator('tr').first()).toBeVisible({ timeout: FAST_TIMEOUT });

  const rows = occurrencesTbody.locator('tr');
  await expect(rows.first()).toBeVisible();

  const durationHeader = page.getByRole('button', { name: 'Duration' });
  async function extractDurationTexts() {
    const count = await rows.count();
    const values: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const text = (await rows.nth(i).locator('td').nth(3).innerText()).trim();
      values.push(text.length === 0 ? '—' : text);
    }
    return values;
  }

  function parseDuration(text: string): number {
    const parts = text.split(':').map((part) => Number.parseInt(part, 10));
    return parts.reduce((total, part) => total * 60 + (Number.isNaN(part) ? 0 : part), 0);
  }

  function assertDescending(durations: number[]) {
    for (let i = 0; i < durations.length - 1; i += 1) {
      expect(durations[i]).toBeGreaterThanOrEqual(durations[i + 1]);
    }
  }

  function assertAscending(durations: number[]) {
    for (let i = 0; i < durations.length - 1; i += 1) {
      expect(durations[i]).toBeLessThanOrEqual(durations[i + 1]);
    }
  }

  await durationHeader.click();
  await expect(occurrencesTbody.locator('tr').first()).toBeVisible({ timeout: FAST_TIMEOUT });
  const durationTextsDesc = await extractDurationTexts();
  const numericDesc = durationTextsDesc
    .filter((text) => text !== '—')
    .map(parseDuration);
  expect(numericDesc.length).toBeGreaterThan(0);
  assertDescending(numericDesc);
  const missingIndexDesc = durationTextsDesc.findIndex((text) => text === '—');
  if (missingIndexDesc !== -1) {
    expect(missingIndexDesc).toBeGreaterThanOrEqual(numericDesc.length);
  }

  await durationHeader.click();
  await expect(occurrencesTbody.locator('tr').first()).toBeVisible({ timeout: FAST_TIMEOUT });
  const durationTextsAsc = await extractDurationTexts();
  const numericAsc = durationTextsAsc
    .filter((text) => text !== '—')
    .map(parseDuration);
  expect(numericAsc.length).toBeGreaterThan(0);
  assertAscending(numericAsc);
  const missingIndexAsc = durationTextsAsc.findIndex((text) => text === '—');
  if (missingIndexAsc !== -1) {
    expect(missingIndexAsc).toBeGreaterThanOrEqual(numericAsc.length);
  }
});

test('song detail view highlights setlist groups and rarity', async ({ page }) => {
  await loadDataset(page);
  await page.getByLabel('Venue filter').fill('Mission Ballroom');
  await waitForTopShowsStable(page);
  const missionRow = page.locator('#top-shows-table tbody tr').first();
  await expect(missionRow).toContainText(/Mission Ballroom/);
  await missionRow.click();
  await expect(page).toHaveURL(/\/#\/shows\/\d+$/);

  await expect(page.getByRole('heading', { name: /Setlist/ })).toBeVisible();
  const showHeader = page.getByRole('heading', { level: 3, name: / - / });
  await expect(showHeader).toBeVisible();
  const headerRarityLabel = page.locator('span').filter({ hasText: /^Rarity$/ }).first();
  await expect(headerRarityLabel).toBeVisible();
  await expect(page.getByText(/Songs Logged/)).toBeVisible();
  await expect(page.getByText('Set 1')).toBeVisible();
  await expect(page.locator('text=/Cover of/').first()).toBeVisible();

  await page.getByRole('button', { name: 'View song stats' }).first().click();
  await expect(page).toHaveURL(/\/#\/songs\//);
  await expect(page.getByText('Shows Played')).toBeVisible();
  await expect(page.getByText(/^Rarity$/)).toBeVisible();
  const occurrenceRows = page.locator('table tbody tr');
  const missionOccurrences = await occurrenceRows.filter({ hasText: /Mission Ballroom/i }).count();
  expect(missionOccurrences).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Date' }).click();
  const dateHeader = page.locator('table thead tr th').first();
  await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Duration' }).click();
  const durationHeader = page.locator('table thead tr th').nth(3);
  await expect(durationHeader).toHaveAttribute('aria-sort', 'descending');

  await page.goto('/#/shows/1621475790');
  const localButton = page.getByRole('button', { name: /Load Local Dataset/i });
  if (await localButton.isVisible()) {
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes('/data/elgoose_setlists.json') && response.ok(),
        { timeout: FAST_TIMEOUT }
      ),
      localButton.click()
    ]);
  }
  await expect(page).toHaveURL(/\/#\/shows\/1621475790$/);
  await expect(page.getByRole('heading', { name: /Setlist/ })).toBeVisible();
  const firstTimeRows = page.locator('[data-first-time=\"true\"]');
  await expect(page.locator('text=First Time Played').first()).toBeVisible();
  await expect(firstTimeRows.first()).toBeVisible();
});

test('cover artist search narrows results', async ({ page }) => {
  await loadDataset(page);
  const rows = await openCoverArtists(page);
  const search = page.getByPlaceholder('Search artists (e.g. Perpetual Groove)');

  await search.fill('A-ha');
  await expect(rows.filter({ hasText: /A-ha/i }).first()).toBeVisible();
  const filteredCount = await rows.count();
  const matchingCount = await rows.filter({ hasText: /A-ha/i }).count();
  expect(filteredCount).toBeGreaterThan(0);
  expect(matchingCount).toEqual(filteredCount);

  await search.fill('');
  await expect(rows.first()).toBeVisible();
});
