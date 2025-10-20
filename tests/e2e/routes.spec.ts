import { test, expect } from '../fixtures/coverage';

async function loadDataset(page) {
  await page.goto('/');
  const loadButton = page.getByRole('button', { name: /Load Local Dataset/i });
  await expect(loadButton).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/data/elgoose_setlists.json') && response.ok(), {
      timeout: 20_000
    }),
    loadButton.click()
  ]);
  const firstRow = page.locator('#top-shows-table tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: 20_000 });
}

async function openCoverArtists(page) {
  await page.getByRole('link', { name: /Browse & search cover artists/i }).click();
  await expect(page).toHaveURL(/\/covers$/);
  await expect(page.getByRole('heading', { name: 'Cover Artists' })).toBeVisible();
  const rows = page.locator('#cover-artists-table tbody tr');
  await expect(rows.first()).toBeVisible();
  return rows;
}

async function waitForTopShowsStable(page) {
  const tbody = page.locator('#top-shows-table tbody');
  await expect(tbody).toHaveAttribute('aria-busy', 'false');
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
  await expect(page).toHaveURL(/\/shows\/\d+$/);
  await expect(page.getByRole('heading', { name: /Setlist/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('song detail route shows statistics for selected song', async ({ page }) => {
  await loadDataset(page);
  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();
  await expect(page).toHaveURL(/\/shows\/\d+$/);
  await page.getByRole('button', { name: 'View song stats' }).first().click();
  await expect(page).toHaveURL(/\/songs\//);
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

  await page.getByLabel('Top N results').fill('1');
  await waitForTopShowsStable(page);
  const limitedCount = await rows.count();
  expect(limitedCount).toBeLessThanOrEqual(1);
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
  for (let i = 0; i < namesAscending.length - 1; i += 1) {
    expect(collator.compare(namesAscending[i], namesAscending[i + 1])).toBeLessThanOrEqual(0);
  }
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
  await page.getByRole('button', { name: 'Song' }).click();
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
  if (songRowCount > 1) {
    for (let i = 0; i < songRowCount - 1; i += 1) {
      const current = Number.parseInt(await songRows.nth(i).locator('td').nth(1).innerText(), 10);
      const next = Number.parseInt(await songRows.nth(i + 1).locator('td').nth(1).innerText(), 10);
      expect(current).toBeGreaterThanOrEqual(next);
    }
  }

  await page.getByRole('button', { name: 'All Cover Artists' }).click();
  await expect(page).toHaveURL(/\/covers$/);
});

test('song detail view highlights setlist groups and rarity', async ({ page }) => {
  await loadDataset(page);
  await page.getByLabel('Venue filter').fill('Mission Ballroom');
  await waitForTopShowsStable(page);
  const missionRow = page.locator('#top-shows-table tbody tr').first();
  await expect(missionRow).toContainText(/Mission Ballroom/);
  await missionRow.click();
  await expect(page).toHaveURL(/\/shows\/\d+$/);

  await expect(page.getByRole('heading', { name: /Setlist/ })).toBeVisible();
  await expect(page.getByText(/Rarity Score/)).toBeVisible();
  await expect(page.getByText(/Songs Logged/)).toBeVisible();
  await expect(page.getByText('Set 1')).toBeVisible();
  await expect(page.locator('text=/Cover of/').first()).toBeVisible();

  await page.getByRole('button', { name: 'View song stats' }).first().click();
  await expect(page).toHaveURL(/\/songs\//);
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
