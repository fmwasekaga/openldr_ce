import { test, expect } from '@playwright/test';

test('users page creates and disables a user', async ({ page }) => {
  const username = `E2E${Date.now()}`;

  await page.goto('/users');
  await expect(page.getByText('USERNAME')).toBeVisible();

  await page.getByRole('button', { name: /new user/i }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Full name').fill('E2E User');
  await page.getByLabel('Email').fill(`${username.toLowerCase()}@example.test`);
  await page.getByRole('button', { name: /^Create$/ }).click();

  await expect(page.getByRole('cell', { name: username, exact: true })).toBeVisible();

  await page.getByRole('button', { name: `Actions for ${username}` }).click();
  await page.getByRole('menuitem', { name: 'Disable' }).click();
  await expect(page.getByText('Disabled').first()).toBeVisible();
});
