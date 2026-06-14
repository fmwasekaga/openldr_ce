import { test, expect } from '@playwright/test';

test('docs index lists pages and search narrows results', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.getByRole('link', { name: 'Getting Started' })).toBeVisible();
  await page.getByLabel('Search documentation').fill('dhis2');
  await expect(page.getByRole('link', { name: /DHIS2/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Getting Started' })).toHaveCount(0);
});

test('a docs page renders its heading', async ({ page }) => {
  await page.goto('/docs/overview');
  await expect(page.getByRole('heading', { level: 1, name: 'OpenLDR Community Edition' })).toBeVisible();
});
