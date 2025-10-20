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
  await page.getByRole('link', { name: /Browse & search cover artists/i }).click();
  await expect(page).toHaveURL(/\/covers$/);
  await expect(page.getByRole('heading', { name: 'Cover Artists' })).toBeVisible();
  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toBeVisible();
});

test('show detail route renders setlist for selected show', async ({ page }) => {
  await loadDataset(page);
  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();
  await expect(page).toHaveURL(/\/shows\/\d+$/);
  await expect(page.getByRole('heading', { name: /Setlist/ })).toBeVisible();
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
