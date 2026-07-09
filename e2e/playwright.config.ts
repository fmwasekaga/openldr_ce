import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { BASE_URL } from './support/config';

// Repo root (one level up from e2e/) so the built server finds the root .env via dotenv.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  globalSetup: './global-setup.ts',
  outputDir: 'artifacts/test-results',
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    headless: true,
    // The reports PDF Document tab uses pdfjs-dist@6, which calls
    // `Map.prototype.getOrInsertComputed` (TC39 "upsert" proposal). That method
    // ships natively only in Chromium >= 144, but the newest Chromium the
    // npmmirror mirror hosts is rev 1200 / Chromium 143 (Playwright 1.57 — see
    // README + memory playwright-toolchain). V8 already implements it behind the
    // `--harmony` flag on 143, so enable it here; without this the Document tab
    // throws `getOrInsertComputed is not a function` and never renders. This is
    // TEST-HARNESS-only — production hardens real browsers via the app's own
    // Uint8Array hex/base64 polyfill, which stays.
    launchOptions: { args: ['--js-flags=--harmony'] },
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'smoke', testDir: 'tests' },
    { name: 'capture', testDir: 'capture' },
    { name: 'docs-capture', testDir: 'capture-docs' },
  ],
  webServer: {
    command: 'node apps/server/dist/index.js',
    cwd: repoRoot,
    url: `${BASE_URL}/health`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, AUTH_DEV_BYPASS: 'true' },
  },
});
