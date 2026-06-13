import { test, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Screenshots land in e2e/artifacts/screenshots/ (gitignored). An agent reads these
// PNGs and judges them against rubric.md. No pixel baselines.
const OUT = fileURLToPath(new URL('../artifacts/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

type Shot = {
  name: string;
  path: string;
  theme: 'dark' | 'light';
  width: number;
  height: number;
  fullPage: boolean;
  chart: boolean;
};

const SHOTS: Shot[] = [
  { name: 'dashboard-dark', path: '/', theme: 'dark', width: 1440, height: 900, fullPage: true, chart: true },
  { name: 'dashboard-light', path: '/', theme: 'light', width: 1440, height: 900, fullPage: true, chart: true },
  { name: 'dashboard-narrow', path: '/', theme: 'dark', width: 768, height: 1024, fullPage: true, chart: true },
  { name: 'report-amr-dark', path: '/reports/amr-resistance', theme: 'dark', width: 1440, height: 900, fullPage: false, chart: true },
  { name: 'report-amr-light', path: '/reports/amr-resistance', theme: 'light', width: 1440, height: 900, fullPage: false, chart: true },
  { name: 'notfound-dark', path: '/nope', theme: 'dark', width: 1440, height: 900, fullPage: false, chart: false },
];

async function capture(browser: Browser, shot: Shot): Promise<void> {
  const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height } });
  // Seed the theme before any app code runs.
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

for (const shot of SHOTS) {
  test(`capture ${shot.name}`, async ({ browser }) => {
    await capture(browser, shot);
  });
}
