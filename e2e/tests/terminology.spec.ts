import { test, expect } from '@playwright/test';

test('terminology page lists seeded publishers and creates a publisher', async ({ page }) => {
  await page.goto('/terminology');
  await expect(page.getByText('Publishers', { exact: true })).toBeVisible();
  // Seeded publishers are always shown; select one so the Actions menu appears.
  await page.getByRole('button', { name: 'System' }).first().click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Publisher' }).click();
  await page.getByRole('menuitem', { name: 'New' }).first().click();
  await page.getByLabel('Name').fill('E2E Lab');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page.getByRole('button', { name: 'E2E Lab' })).toBeVisible();
});
