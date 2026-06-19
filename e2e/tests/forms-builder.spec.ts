import { expect, test } from '@playwright/test';

test('creates, publishes, edits, and compares a form in the builder', async ({ page }) => {
  await page.goto('/forms');
  await page.getByRole('button', { name: 'Form actions' }).click();
  await page.getByRole('menuitem', { name: 'New' }).click();

  const nameInput = page.getByRole('textbox', { name: 'Form name' });
  await expect(nameInput).toBeVisible();
  await nameInput.fill('Builder smoke form');

  await page.getByRole('button', { name: 'Add string field' }).click();
  await page.getByText('New string field').click();
  await page.getByLabel('Field label').fill('Patient ID');
  await expect(page.getByText('Patient ID')).toBeVisible();

  await page.getByRole('button', { name: 'Builder actions' }).click();
  await page.getByRole('menuitem', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Builder actions' }).click();
  await page.getByRole('menuitem', { name: 'Publish' }).click();

  await page.getByLabel('Field label').fill('Patient identifier');
  await page.getByRole('button', { name: 'Builder actions' }).click();
  await page.getByRole('menuitem', { name: 'Save draft' }).click();

  await page.getByRole('button', { name: 'Builder actions' }).click();
  await page.getByRole('menuitem', { name: 'Compare' }).click();
  await expect(page.getByText(/Field changed|Published version/)).toBeVisible();
});
