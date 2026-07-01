import { test, expect } from '@playwright/test';

/**
 * Reference plugin UI end-to-end spec.
 *
 * Verifies:
 *   1. The plugin container page loads at /x/ui-reference
 *   2. The sandboxed iframe is mounted (title="plugin-ui-reference")
 *   3. The gated host:reports service resolves (reports list rendered, not pending/error)
 *   4. Storage round-trip: clicking #ping writes a note via the plugin datastore and the
 *      [data-testid="note"] element reflects the echoed value.
 *
 * Prerequisites (manual, deferred to CI/acceptance):
 *   - Full stack up (postgres + minio, AUTH_DEV_BYPASS=true)
 *   - Reference plugin installed:
 *       pnpm openldr plugin install reference-plugins/ui-reference/plugin.wasm
 *   - Server built: pnpm turbo build --filter=@openldr/server --filter=@openldr/studio
 */
test('reference plugin UI loads, calls a gated host service, and round-trips storage', async ({ page }) => {
  await page.goto('/x/ui-reference');

  // The PluginFrame renders an <iframe title="plugin-ui-reference">
  const frame = page.frameLocator('iframe[title="plugin-ui-reference"]');

  // Host:reports service should resolve — the reference plugin populates
  // [data-testid="reports"] once the SDK call returns. It must not still show
  // the loading placeholder ("…") and must not contain "error:".
  await expect(frame.locator('[data-testid="reports"]')).not.toHaveText('…', { timeout: 15_000 });
  await expect(frame.locator('[data-testid="reports"]')).not.toContainText('error:');

  // Storage round-trip: clicking #ping sends a store.set("note","hello") call
  // via the host bridge, then renders the echoed value in [data-testid="note"].
  await frame.locator('#ping').click();
  await expect(frame.locator('[data-testid="note"]')).toContainText('hello');
});
