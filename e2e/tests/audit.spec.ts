import { test, expect } from '@playwright/test';

test('audit page renders and applies a filter', async ({ page }) => {
  await page.goto('/audit');
  await expect(page.getByText('TIMESTAMP')).toBeVisible();

  await page.getByRole('button', { name: /filter/i }).click();
  await page.getByLabel('Action').fill('e2e.nonexistent');
  const response = page.waitForResponse((res) => res.url().includes('/api/audit') && res.url().includes('action=e2e.nonexistent'));
  await page.getByRole('button', { name: /^Apply$/ }).click();
  await response;

  await expect(page.getByText('e2e.nonexistent')).toBeVisible();
  await expect(page.getByText(/No audit events|e2e\.nonexistent/i).first()).toBeVisible();
});
