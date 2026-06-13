// Installs Chromium for the e2e package via the npmmirror mirror (the direct
// Playwright CDN -> storage.googleapis.com times out on this machine). Idempotent:
// re-running with the browser already cached is a fast no-op. Override the host by
// exporting PLAYWRIGHT_DOWNLOAD_HOST before invoking.
import { spawnSync } from 'node:child_process';

const MIRROR = 'https://cdn.npmmirror.com/binaries/playwright';
if (!process.env.PLAYWRIGHT_DOWNLOAD_HOST) {
  process.env.PLAYWRIGHT_DOWNLOAD_HOST = MIRROR;
  console.log(`[e2e] PLAYWRIGHT_DOWNLOAD_HOST=${MIRROR}`);
} else {
  console.log(`[e2e] using existing PLAYWRIGHT_DOWNLOAD_HOST=${process.env.PLAYWRIGHT_DOWNLOAD_HOST}`);
}

const res = spawnSync(
  'pnpm',
  ['--filter', '@openldr/e2e', 'exec', 'playwright', 'install', 'chromium'],
  { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' },
);
process.exit(res.status ?? 1);
