import { test, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Doc screenshots are COMMITTED into the SPA bundle (unlike e2e/artifacts/, which is
// gitignored). They land beside the versioned markdown so Vite emits them as hashed
// assets and DocMarkdown resolves them by basename.
const OUT = fileURLToPath(new URL('../../apps/web/src/docs/0.1.0/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

type Shot = { name: string; path: string; theme: 'dark' | 'light'; width: number; height: number; fullPage: boolean; chart: boolean };

// All shots are viewport-only (fullPage:false) so they stay landscape ~16:10 — like
// corlix's app-window screenshots — instead of tall full-page captures that dominate
// the doc page and force scrolling. The thumbnail (max-w-2xl) then renders ~420px tall.
const DOC_SHOTS: Shot[] = [
  { name: 'dashboard', path: '/', theme: 'dark', width: 1440, height: 900, fullPage: false, chart: true },
  { name: 'report-amr', path: '/reports/amr-resistance', theme: 'dark', width: 1440, height: 900, fullPage: false, chart: true },
  { name: 'docs', path: '/docs', theme: 'dark', width: 1440, height: 900, fullPage: false, chart: false },
  { name: 'doc-dhis2', path: '/docs/dhis2', theme: 'dark', width: 1440, height: 900, fullPage: false, chart: false },
];

async function capture(browser: Browser, shot: Shot): Promise<void> {
  const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height } });
  await context.addInitScript((theme) => {
    try { localStorage.setItem('openldr-theme', theme); } catch { /* ignore */ }
    document.documentElement.setAttribute('data-theme', theme);
  }, shot.theme);
  const page = await context.newPage();
  await page.goto(shot.path, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  if (shot.chart) {
    await page.locator('.recharts-surface').first().waitFor({ state: 'visible', timeout: 15_000 });
  }
  await page.screenshot({ path: `${OUT}${shot.name}.png`, fullPage: shot.fullPage });
  await context.close();
}

for (const shot of DOC_SHOTS) {
  test(`doc-shot ${shot.name}`, async ({ browser }) => {
    await capture(browser, shot);
  });
}
