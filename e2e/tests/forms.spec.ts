import { expect, test } from '@playwright/test';

test('forms page imports a form JSON', async ({ page }) => {
  const run = Date.now();
  const name = `E2E Form ${run}`;
  const schema = {
    id: `e2e-form-${run}`,
    name,
    title: { en: name },
    status: 'active',
    languages: ['en'],
    sections: [
      {
        id: 'main',
        title: { en: 'Main' },
        fields: [{ id: 'q1', type: 'text', label: { en: 'Q1' }, required: false }],
      },
    ],
  };

  await page.goto('/forms');
  await expect(page.getByText('NAME')).toBeVisible();

  await page.getByLabel('Import form JSON').setInputFiles({
    name: `${schema.id}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(schema)),
  });

  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
  await page.getByRole('cell', { name, exact: true }).click();
  await expect(page.getByLabel('Q1')).toBeVisible();
  await page.getByLabel('Q1').fill('Captured from e2e');
  await page.getByRole('button', { name: /^Submit$/ }).click();
  await expect(page.getByText('Response captured.')).toBeVisible();
});
