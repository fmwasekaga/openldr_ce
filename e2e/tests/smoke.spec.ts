import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('health endpoint is up', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string };
  expect(body.status).not.toBe('down');
});

test('reports page renders report cards from live data', async ({ page }) => {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'AMR Resistance Rate' })).toBeVisible();
});

test('AMR report shows 100% resistance on AMP', async ({ page }) => {
  await page.goto('/reports');
  await page.getByRole('link').filter({ hasText: 'AMR Resistance Rate' }).click();
  await expect(page).toHaveURL(/\/reports\/amr-resistance/);
  const ampRow = page.getByRole('row').filter({ hasText: 'AMP' });
  await expect(ampRow).toContainText('100%');
});

test('CSV export downloads a non-empty file with the expected header', async ({ page }) => {
  await page.goto('/reports/amr-resistance');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export CSV' }).click(),
  ]);
  const file = await download.path();
  expect(file).toBeTruthy();
  const content = readFileSync(file!, 'utf8');
  expect(content.length).toBeGreaterThan(0);
  expect(content.split('\n')[0]).toBe('Antibiotic,Tested,R,I,S,%R');
});

test('unknown route renders the SPA not-found state', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page.getByText('Page not found.')).toBeVisible();
});
