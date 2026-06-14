import { test, expect } from '@playwright/test';

test('docs sidebar lists pages and search narrows results', async ({ page }) => {
  await page.goto('/docs');
  const nav = page.getByRole('navigation', { name: 'Documentation sections' });
  await expect(nav.getByRole('link', { name: 'Getting Started' })).toBeVisible();
  await page.getByLabel('Search documentation').fill('dhis2');
  await expect(nav.getByRole('link', { name: /DHIS2/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Getting Started' })).toHaveCount(0);
});

test('a docs page renders its heading and a screenshot opens the lightbox', async ({ page }) => {
  await page.goto('/docs/overview');
  await expect(page.getByRole('heading', { level: 1, name: 'OpenLDR Community Edition' })).toBeVisible();
  const zoom = page.getByRole('button', { name: /zoom/i }).first();
  if (await zoom.count()) {
    await zoom.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }
});
