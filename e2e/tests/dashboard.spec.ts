import { test, expect } from '@playwright/test';

test('dashboard renders the seeded sample board and edit mode adds a widget', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Dashboard' })).toBeVisible();
  // A KPI widget renders its title twice (card header + value label), so scope to the first.
  await expect(page.getByText('Total Orders').first()).toBeVisible();

  // Enter edit mode via the dashboard ⋯ menu.
  await page.getByRole('button', { name: 'Dashboard menu' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();

  // Add a widget via the ⋯ menu (only present in edit mode).
  await page.getByRole('button', { name: 'Dashboard menu' }).click();
  await page.getByRole('menuitem', { name: 'Add widget' }).click();

  // Widget editor dialog: set a title and Save (Save lives in the editor's ⋯ menu).
  const titleInput = page.getByRole('textbox', { name: 'Title' });
  await expect(titleInput).toBeVisible();
  await titleInput.fill('E2E KPI');
  await page.getByRole('button', { name: 'Editor menu' }).click();
  await page.getByRole('menuitem', { name: 'Save' }).click();
  await expect(page.getByText('E2E KPI').first()).toBeVisible();

  // Persist via Done, then reload to confirm it was saved to the backend.
  await page.getByRole('button', { name: 'Dashboard menu' }).click();
  await page.getByRole('menuitem', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByText('E2E KPI').first()).toBeVisible();
});
