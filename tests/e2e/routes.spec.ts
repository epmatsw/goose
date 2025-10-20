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
  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: 20_000 });
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
