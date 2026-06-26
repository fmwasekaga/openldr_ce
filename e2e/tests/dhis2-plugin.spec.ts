import { test, expect, type FrameLocator, type Page } from '@playwright/test';

/**
 * DHIS2 webview-plugin end-to-end spec (SP-A2 Task 17).
 *
 * After the cutover, DHIS2 is no longer a host page — it is the `dhis2-sink`
 * plugin's sandboxed Preact webview served at /x/dhis2-sink. This spec drives that
 * webview through the real host bridge (sandboxed iframe + MessagePort RPC →
 * plugin-broker → host services), proving the removable plugin works end-to-end.
 *
 * Coverage:
 *   1. The plugin container loads at /x/dhis2-sink and the sandboxed iframe mounts
 *      (title="plugin-dhis2-sink"). The webview is gated to lab_admin — the dev-bypass
 *      actor is lab_admin (AUTH_DEV_ROLES default), so the gate passes.
 *   2. The Dashboard renders (data-openldr-ready=1, no error alert), which means the
 *      SDK handshake completed and the gated host services (connectors.list / storage.*)
 *      resolved through the broker.
 *   3. Top-nav routing works: each tab (Mappings/Schedules/OrgUnits/Pushes) mounts.
 *   4. LIVE: with a configured+enabled connector, "Pull metadata" runs the full
 *      sandbox → broker(connectors.metadata) → createPluginTarget → wasm worker-path
 *      egress → live DHIS2 path and renders non-empty SL-demo metadata counts.
 *
 * The deeper create-mapping → dry-run → real aggregate push flow is covered at the
 * data layer by apps/server/src/dhis2-live.acceptance.test.ts (vitest, DHIS2_LIVE=1) —
 * driving it through the UI additionally requires seeded report rows + org-unit maps.
 *
 * Prerequisites (live stack):
 *   - Full stack up (postgres + minio), server built: node apps/server/dist/index.js
 *     with AUTH_DEV_BYPASS=true (the playwright webServer sets this).
 *   - migration 036 applied (runs on server boot).
 *   - UI-bearing dhis2-sink installed:
 *       pnpm build:dhis2-sink && pnpm make:marketplace-bundle
 *       pnpm openldr plugin install reference-plugins/dhis2-sink/plugin.wasm
 *   - For step 4 (the live metadata pull): docker compose --profile dhis2 up, and a
 *     dhis2-sink connector created + enabled (Settings ▸ Connectors) pointing at the
 *     DHIS2 SL demo. Without it, step 4 is skipped (not a false green).
 */

const PLUGIN_ID = 'dhis2-sink';
const IFRAME = `iframe[title="plugin-${PLUGIN_ID}"]`;

/** Open the webview and return its frame locator once the Dashboard has settled. */
async function openWebview(page: Page): Promise<FrameLocator> {
  await page.goto(`/x/${PLUGIN_ID}`);
  const frame = page.frameLocator(IFRAME);
  // The Dashboard sets data-openldr-ready=1 on its <body> once the first load settles
  // (regardless of connector state), which proves the SDK handshake + host calls returned.
  await expect(frame.locator('body[data-openldr-ready="1"]')).toBeVisible({ timeout: 20_000 });
  return frame;
}

test('DHIS2 webview loads, the sandbox mounts, and gated host services resolve', async ({ page }) => {
  const frame = await openWebview(page);

  // Dashboard rendered without surfacing an SDK/broker error.
  await expect(frame.locator('[data-testid="dhis2-dashboard"]')).toBeVisible();
  await expect(frame.locator('[data-testid="dhis2-dashboard"] .error[role="alert"]')).toHaveCount(0);

  // The active-connector card renders — connectors.list() resolved through the broker.
  await expect(frame.locator('[data-testid="active-connector"]')).toBeVisible();

  // Top-nav present with all five tabs.
  await expect(frame.locator('[data-testid="dhis2-nav"]')).toBeVisible();
  for (const tab of ['dashboard', 'mappings', 'schedules', 'orgUnits', 'pushes']) {
    await expect(frame.locator(`[data-testid="nav-${tab}"]`)).toBeVisible();
  }
});

test('DHIS2 webview top-nav routes between screens', async ({ page }) => {
  const frame = await openWebview(page);

  await frame.locator('[data-testid="nav-mappings"]').click();
  await expect(frame.locator('[data-testid="nav-mappings"]')).toHaveAttribute('aria-current', 'page');

  await frame.locator('[data-testid="nav-orgUnits"]').click();
  await expect(frame.locator('[data-testid="nav-orgUnits"]')).toHaveAttribute('aria-current', 'page');

  await frame.locator('[data-testid="nav-pushes"]').click();
  await expect(frame.locator('[data-testid="nav-pushes"]')).toHaveAttribute('aria-current', 'page');

  await frame.locator('[data-testid="nav-dashboard"]').click();
  await expect(frame.locator('[data-testid="dhis2-dashboard"]')).toBeVisible();
});

test('LIVE: Pull metadata returns non-empty DHIS2 metadata through the webview', async ({ page }) => {
  const frame = await openWebview(page);

  // The "Pull metadata" button is disabled until a connector is configured + enabled.
  // If none exists yet, skip rather than report a misleading pass.
  const pull = frame.locator('[data-testid="dhis2-pull-metadata"]');
  await expect(pull).toBeVisible();
  const disabled = await pull.isDisabled();
  test.skip(disabled, 'No enabled dhis2-sink connector — create one (Settings ▸ Connectors) to exercise the live pull.');

  await pull.click();

  // Live metadata pull hits the wasm worker-path egress → DHIS2; allow generous time.
  const counts = frame.locator('[data-testid="metadata-counts"]');
  await expect(counts).toBeVisible({ timeout: 60_000 });

  // The SL demo always has data elements + org units; assert the dataElements count is > 0.
  const dataElements = await counts.locator('div', { hasText: /data ?elements/i }).locator('dd').first().innerText();
  expect(Number(dataElements.trim())).toBeGreaterThan(0);

  // And no pull error surfaced.
  await expect(frame.locator('[data-testid="metadata-card"] .error-text[role="alert"]')).toHaveCount(0);
});
