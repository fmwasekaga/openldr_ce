import { test, expect } from '@playwright/test';

test('docs home shows grouped navigation and start-here content', async ({ page }) => {
  await page.goto('/docs');

  const nav = page.getByRole('navigation', { name: 'Documentation sections' });
  await expect(nav.locator('p', { hasText: 'Start here' })).toBeVisible();
  await expect(nav.locator('p', { hasText: 'Daily work' })).toBeVisible();
  await expect(nav.locator('p', { hasText: 'Data and design' })).toBeVisible();
  await expect(nav.locator('p', { hasText: 'Administration' })).toBeVisible();
  await expect(nav.locator('p', { hasText: 'More' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Start Here' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Start Here' })).toBeVisible();
});

test('docs search finds workflow guidance and excludes retired DHIS2 docs', async ({ page }) => {
  await page.goto('/docs');

  const nav = page.getByRole('navigation', { name: 'Documentation sections' });
  await page.getByLabel('Search documentation').fill('create workflow');
  await expect(nav.getByText('Search results')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Workflows' })).toBeVisible();

  await page.getByLabel('Search documentation').fill('dhis2');
  await expect(nav.getByText('No results.')).toBeVisible();
  await expect(nav.getByRole('link', { name: /dhis2/i })).toHaveCount(0);
});

test('workflows guide shows metadata, procedure steps, advanced usage, and lightbox images', async ({
  page,
}) => {
  await page.goto('/docs/workflows');

  await expect(page.getByRole('heading', { level: 1, name: 'Workflows' })).toBeVisible();
  await expect(page.getByLabel('Guide metadata')).toContainText('Lab managers');
  await expect(page.getByLabel('Guide metadata')).toContainText('lab_admin');
  await expect(page.getByLabel('Guide metadata')).toContainText('About 20 minutes');
  await expect(page.getByLabel('Guide metadata')).toContainText('Intermediate');
  await expect(page.locator('.doc-content ol li').first()).toContainText('Open Workflows');
  await expect(page.getByRole('heading', { level: 2, name: 'Advanced web usage' })).toBeVisible();

  await page
    .getByRole('button', {
      name: 'Zoom: Workflow builder with nodes, canvas, configuration, and run controls',
    })
    .click();
  await expect(
    page.getByRole('dialog', {
      name: 'Workflow builder with nodes, canvas, configuration, and run controls',
    }),
  ).toBeVisible();
});

test('advanced docs placeholder is explicit about the future app', async ({ page }) => {
  await page.goto('/docs/advanced-docs');

  await expect(page.getByRole('heading', { level: 1, name: /Advanced Docs/ })).toBeVisible();
  await expect(page.getByText('The separate advanced documentation app does not exist yet.')).toBeVisible();
  await expect(
    page.getByText('this in-app manual stays focused on web-interface tasks'),
  ).toBeVisible();
});

test('retired DHIS2 docs route is not found', async ({ page }) => {
  await page.goto('/docs/dhis2');

  await expect(page.getByText('Documentation page not found.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'All docs' })).toBeVisible();
});

test('French app language shows the English fallback notice for current guides', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('openldr.lang', 'fr');
  });

  await page.goto('/docs/workflows');

  await expect(page.getByText(/Shown in English/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Workflows' })).toBeVisible();
});

test('documentation download menu remains reachable', async ({ page }) => {
  await page.goto('/docs/workflows');

  await page.getByRole('button', { name: 'Download documentation' }).click();
  await expect(page.getByRole('menuitem', { name: 'This page' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'All docs' })).toBeVisible();
});
