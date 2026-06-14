import { test, expect } from '@playwright/test';

test('dashboard renders the seeded Overview and edit mode adds a widget', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Total Orders')).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Widget' }).click();
  await expect(page.getByLabel('Source')).toBeVisible();
  await page.getByLabel('Title').fill('E2E KPI');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('E2E KPI')).toBeVisible();

  // Persist + reload.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByText('E2E KPI')).toBeVisible();
});
