import { test, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addCallouts,
  disableAnimations,
  maskLocators,
  preparePage,
  removeCallouts,
  runCaptureSteps,
  waitUntilReady,
} from './capture-helpers';
import { ensureDocsFixtures, type DocsFixtureResult } from './fixtures';
import { loadCaptureManifest, type CaptureManifestShot } from './manifest';
import { BASE_URL } from '../support/config';

// Doc screenshots are COMMITTED into the SPA bundle (unlike e2e/artifacts/, which is
// gitignored). They land beside the versioned markdown so Vite emits them as hashed
// assets and DocMarkdown resolves them by basename.
const OUT = fileURLToPath(new URL('../../apps/studio/src/docs/0.1.0/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const manifest = await loadCaptureManifest();
let fixtureResult: DocsFixtureResult | null = null;

function resolveRoute(route: string): string {
  if (!route.includes('{formId}')) return route;
  if (!fixtureResult?.formId) throw new Error(`cannot resolve form route before fixtures are ready: ${route}`);
  return route.replaceAll('{formId}', fixtureResult.formId);
}

async function capture(browser: Browser, shot: CaptureManifestShot): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: manifest.viewport,
  });
  const page = await context.newPage();
  try {
    await preparePage(page, shot.theme);
    await page.goto(resolveRoute(shot.route), { waitUntil: 'networkidle' });
    await runCaptureSteps(page, shot.steps);
    await waitUntilReady(page, shot.ready);
    await disableAnimations(page);
    await addCallouts(page, shot.callouts ?? []);

    const screenshotOptions = {
      path: join(OUT, shot.name),
      mask: maskLocators(page, shot.mask ?? []),
    };
    if (shot.crop) {
      await page.locator(shot.crop).first().screenshot(screenshotOptions);
    } else {
      await page.screenshot({ ...screenshotOptions, fullPage: false });
    }
  } finally {
    await removeCallouts(page).catch(() => undefined);
    await context.close();
  }
}

test.beforeAll(async ({ request }) => {
  fixtureResult = await ensureDocsFixtures(request);
});

for (const shot of manifest.shots) {
  test(`doc-shot ${shot.name}`, async ({ browser }) => {
    await capture(browser, shot);
  });
}
